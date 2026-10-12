import { useEffect, useState } from "react";

import type { JobRow, JobStage } from "../../shared/types";
import { api, type JobImages } from "./api";

const STEPS: { stage: JobStage; label: string }[] = [
  { stage: "storing_original", label: "Store" },
  { stage: "analyzing", label: "Decode" },
  { stage: "rendering", label: "Resize" },
  { stage: "uploading_variants", label: "Upload" },
  { stage: "classifying", label: "Classify" },
  { stage: "done", label: "Done" },
];
const ORDER: JobStage[] = ["queued", ...STEPS.map((step) => step.stage)];

// Signed URLs are fetched once per job and shared between re-renders.
const imageRequests = new Map<string, Promise<JobImages>>();

function useJobImages(job: JobRow) {
  const [images, setImages] = useState<JobImages>();
  const ready = job.thumb_key !== null;
  useEffect(() => {
    if (!ready) return;
    let request = imageRequests.get(job.id);
    if (!request) {
      request = api.images(job.id);
      imageRequests.set(job.id, request);
      request.catch(() => imageRequests.delete(job.id));
    }
    let active = true;
    request.then((result) => active && setImages(result), () => {});
    return () => {
      active = false;
    };
  }, [job.id, ready]);
  return images;
}

function duration(job: JobRow) {
  if (!job.started_at || !job.completed_at) return null;
  return `${((job.completed_at.getTime() - job.started_at.getTime()) / 1000).toFixed(1)} s`;
}

export function JobCard({ job, preview }: { job: JobRow; preview?: string }) {
  const images = useJobImages(job);
  const [deleting, setDeleting] = useState(false);
  const current = ORDER.indexOf(job.stage);
  const failed = job.status === "failed";
  const src = images?.thumb ?? preview;

  async function remove() {
    setDeleting(true);
    try {
      await api.remove(job.id);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <li className={`job card ${job.status}`} data-testid="job" data-status={job.status} data-stage={job.stage}>
      <a
        className="thumb"
        href={images?.display ?? undefined}
        rel="noreferrer"
        style={{ background: job.dominant_color ?? undefined }}
        target="_blank"
      >
        {src ? <img alt={job.caption ?? job.filename} src={src} /> : <span className="muted small">…</span>}
      </a>
      <div className="job-body">
        <div className="job-head">
          <strong className="filename" title={job.filename}>
            {job.filename}
          </strong>
          <span className={`badge ${job.status}`}>{job.status}</span>
          <button aria-label={`Delete ${job.filename}`} className="ghost small" disabled={deleting} onClick={remove} type="button">
            Delete
          </button>
        </div>

        <ol className="steps">
          {STEPS.map((step) => {
            const index = ORDER.indexOf(step.stage);
            const state =
              index < current || job.stage === "done" ? "done" : index === current ? (failed ? "failed" : "active") : "";
            return (
              <li className={state} key={step.stage}>
                {step.label}
              </li>
            );
          })}
        </ol>
        <div className="progress" aria-valuenow={job.progress} role="progressbar">
          <div style={{ width: `${job.progress}%` }} />
        </div>
        <p className={`small ${failed ? "error" : "muted"}`} data-testid="job-message">
          {failed ? job.error : job.message}
        </p>

        <dl className="facts small">
          {job.width && (
            <>
              <dt>Size</dt>
              <dd>
                {job.width}×{job.height} {job.format} · {Math.round(job.size_bytes / 1024)} KB
              </dd>
            </>
          )}
          {job.dominant_color && (
            <>
              <dt>Color</dt>
              <dd>
                <span className="swatch" style={{ background: job.dominant_color }} /> {job.dominant_color}
              </dd>
            </>
          )}
          {job.category && (
            <>
              <dt>Category</dt>
              <dd data-testid="job-category">
                <strong>{job.category}</strong>
                {job.confidence !== null && ` · ${Math.round(job.confidence * 100)}%`}
              </dd>
            </>
          )}
          {job.caption && (
            <>
              <dt>Caption</dt>
              <dd>{job.caption}</dd>
            </>
          )}
          {duration(job) && (
            <>
              <dt>Took</dt>
              <dd>
                {duration(job)} · {job.model}
              </dd>
            </>
          )}
        </dl>
        {job.tags && job.tags.length > 0 && (
          <p className="tags">
            {job.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}
