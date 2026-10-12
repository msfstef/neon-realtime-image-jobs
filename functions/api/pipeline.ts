import sharp from "sharp";

import type { JobStage } from "../../shared/types.js";
import { classifyImage, type PartialClassification } from "./classify.js";
import { pool, transaction } from "./db.js";
import { env } from "./env.js";
import { deletePrefix, jobPrefix, putObject } from "./storage.js";

export interface JobInput {
  id: string;
  userId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

// Columns the pipeline may set alongside a stage transition. Keys are fixed
// here, so building the SET list from them is safe.
interface JobPatch {
  status?: "processing" | "completed" | "failed";
  original_key?: string;
  thumb_key?: string;
  display_key?: string;
  width?: number;
  height?: number;
  format?: string;
  dominant_color?: string;
  category?: string | null;
  confidence?: number | null;
  caption?: string | null;
  tags?: string[] | null;
  classification?: unknown;
  model?: string;
  error?: string;
  started_at?: Date;
  completed_at?: Date;
}

/** The user deleted the job while it was running; stop and clean up. */
class JobDeleted extends Error {}

function setClause(patch: JobPatch, firstParam: number) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  return {
    sql: entries.map(([column], index) => `, ${column} = $${firstParam + index}`).join(""),
    values: entries.map(([column, value]) => (column === "classification" ? JSON.stringify(value) : value)),
  };
}

/**
 * Moves a job to a new stage. The row update and the activity event commit in
 * one transaction, so every subscribed live query sees them in the same batch.
 */
async function advance(job: JobInput, stage: JobStage, progress: number, message: string, patch: JobPatch = {}) {
  const extra = setClause(patch, 5);
  await transaction(async (client) => {
    const { rowCount } = await client.query(
      `update image_jobs
          set stage = $2, progress = $3, message = $4, updated_at = now()${extra.sql}
        where id = $1`,
      [job.id, stage, progress, message, ...extra.values],
    );
    if (rowCount === 0) throw new JobDeleted();
    await client.query(
      `insert into image_job_events (job_id, user_id, stage, progress, message)
       values ($1, $2, $3, $4, $5)`,
      [job.id, job.userId, stage, progress, message],
    );
  });
}

/** Updates only the job row (no event): used for high-frequency streaming updates. */
async function patchJob(job: JobInput, progress: number, patch: JobPatch) {
  const extra = setClause(patch, 3);
  const { rowCount } = await pool.query(
    `update image_jobs set progress = greatest(progress, $2), updated_at = now()${extra.sql} where id = $1`,
    [job.id, progress, ...extra.values],
  );
  if (rowCount === 0) throw new JobDeleted();
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
function ms(start: number) {
  const elapsed = performance.now() - start;
  return elapsed < 1000 ? `${Math.round(elapsed)} ms` : `${(elapsed / 1000).toFixed(1)} s`;
}

export async function runJob(job: JobInput): Promise<void> {
  const started = performance.now();
  const prefix = jobPrefix(job.userId, job.id);
  try {
    // 1. Persist the untouched upload first so nothing is lost if a later step fails.
    await advance(job, "storing_original", 5, "Saving the original to object storage", {
      status: "processing",
      started_at: new Date(),
    });
    let t = performance.now();
    const originalKey = `${prefix}original`;
    await putObject(originalKey, job.bytes, job.contentType);

    // 2. Decode and inspect.
    await advance(job, "analyzing", 20, `Stored original (${ms(t)}); decoding image`, { original_key: originalKey });
    t = performance.now();
    const image = sharp(job.bytes, { failOn: "error" }).rotate();
    const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
    const width = metadata.autoOrient?.width ?? metadata.width;
    const height = metadata.autoOrient?.height ?? metadata.height;
    const { r, g, b } = stats.dominant;
    const dominantColor = `#${hex(r)}${hex(g)}${hex(b)}`;

    // 3. Render web-friendly variants (EXIF is stripped on output).
    await advance(job, "rendering", 35, `Decoded ${width}×${height} ${metadata.format} (${ms(t)}); rendering variants`, {
      width,
      height,
      format: metadata.format,
      dominant_color: dominantColor,
    });
    t = performance.now();
    const [thumb, display, aiInput] = await Promise.all([
      image.clone().resize(320, 320, { fit: "cover", position: "attention" }).webp({ quality: 80 }).toBuffer(),
      image.clone().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(),
      image.clone().resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),
    ]);

    // 4. Upload variants.
    await advance(job, "uploading_variants", 50, `Rendered thumbnail and display variants (${ms(t)}); uploading`);
    t = performance.now();
    const thumbKey = `${prefix}thumb.webp`;
    const displayKey = `${prefix}display.webp`;
    await Promise.all([putObject(thumbKey, thumb, "image/webp"), putObject(displayKey, display, "image/webp")]);

    // 5. Classify with the AI Gateway, streaming partial results into the row.
    await advance(job, "classifying", 60, `Uploaded variants (${ms(t)}); asking ${env.classifierModel} to classify`, {
      thumb_key: thumbKey,
      display_key: displayKey,
      model: env.classifierModel,
    });
    t = performance.now();
    let lastWrite = 0;
    const classification = await classifyImage(aiInput, "image/jpeg", async (partial) => {
      const now = performance.now();
      if (now - lastWrite < 100) return;
      lastWrite = now;
      await patchJob(job, 60 + Math.round(30 * filledFraction(partial)), {
        category: partial.category ?? null,
        caption: partial.caption ?? null,
        tags: partial.tags?.filter((tag): tag is string => typeof tag === "string" && tag.length > 0) ?? null,
      });
    });

    // 6. Store the final answer and finish.
    await advance(job, "finalizing", 95, `Classified as ${classification.category} (${ms(t)}); saving results`, {
      category: classification.category,
      confidence: classification.confidence,
      caption: classification.caption,
      tags: classification.tags.map((tag) => tag.toLowerCase()),
      classification,
    });
    await advance(job, "done", 100, `Done in ${ms(started)}`, { status: "completed", completed_at: new Date() });
  } catch (error) {
    if (error instanceof JobDeleted) {
      // Objects uploaded after the DELETE request cleaned up would be orphaned.
      await deletePrefix(prefix).catch((cleanupError) => console.error(`[job ${job.id}] cleanup failed:`, cleanupError));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[job ${job.id}] failed:`, error);
    // The row keeps the stage it failed in so the UI can show where it stopped.
    await transaction(async (client) => {
      const { rows } = await client.query<{ progress: number }>(
        `update image_jobs set status = 'failed', error = $2, message = 'Failed', updated_at = now()
          where id = $1 returning progress`,
        [job.id, message],
      );
      await client.query(
        `insert into image_job_events (job_id, user_id, stage, progress, message)
         values ($1, $2, 'failed', $3, $4)`,
        [job.id, job.userId, rows[0]?.progress ?? 0, `Failed: ${message}`],
      );
    }).catch((dbError) => console.error(`[job ${job.id}] could not record failure:`, dbError));
  }
}

function filledFraction(partial: PartialClassification) {
  const filled = [partial.category, partial.confidence, partial.caption, partial.tags?.length, partial.containsText]
    .filter((value) => value !== undefined).length;
  return filled / 5;
}
