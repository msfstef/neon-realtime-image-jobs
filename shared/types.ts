// Row shapes shared by the function (which seals the live queries) and the
// browser (which renders them). Types follow the @neon/realtime parsers:
// timestamptz -> Date, int2/int4/float4 -> number, text[] -> string[].

export const CATEGORIES = [
  "animal",
  "architecture",
  "document",
  "food",
  "landscape",
  "people",
  "plant",
  "vehicle",
  "artwork",
  "object",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export const STAGES = [
  "queued",
  "storing_original",
  "analyzing",
  "rendering",
  "uploading_variants",
  "classifying",
  "finalizing",
  "done",
  "failed",
] as const;
export type JobStage = (typeof STAGES)[number];

export interface JobRow {
  id: string;
  filename: string;
  size_bytes: number;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  message: string | null;
  error: string | null;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  dominant_color: string | null;
  category: Category | null;
  confidence: number | null;
  caption: string | null;
  tags: string[] | null;
  model: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface JobEventRow {
  id: string;
  job_id: string;
  filename: string;
  stage: JobStage;
  progress: number;
  message: string;
  created_at: Date;
}

export interface CategoryStatRow {
  category: string;
  count: number;
}

export interface StatusStatRow {
  status: JobStatus;
  count: number;
}
