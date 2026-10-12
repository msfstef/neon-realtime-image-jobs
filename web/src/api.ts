import type { SealedLiveQuery } from "@neon/realtime/client";

import type { CategoryStatRow, JobEventRow, JobRow, StatusStatRow } from "../../shared/types";
import { getToken } from "./auth";

export interface LiveQueries {
  jobs: SealedLiveQuery<JobRow>;
  events: SealedLiveQuery<JobEventRow>;
  categories: SealedLiveQuery<CategoryStatRow>;
  statuses: SealedLiveQuery<StatusStatRow>;
}

export interface LiveBootstrap {
  websocketUrl: string;
  queries: LiveQueries;
}

export interface JobImages {
  thumb: string | null;
  display: string | null;
  original: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const response = await fetch(new URL(path, __API_URL__), {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  /** Sealed live queries for the signed-in user, plus the Realtime WebSocket URL. */
  live: () => request<LiveBootstrap>("/api/live"),
  /** A fresh capability for one live query, used by useLiveQuery before expiry. */
  renew: <Name extends keyof LiveQueries>(name: Name) => request<LiveQueries[Name]>(`/api/live/${name}`),
  upload(file: File) {
    const body = new FormData();
    body.set("file", file);
    return request<{ id: string; txid: string }>("/api/jobs", { method: "POST", body });
  },
  images: (id: string) => request<JobImages>(`/api/jobs/${id}/images`),
  remove: (id: string) => request<{ txid: string }>(`/api/jobs/${id}`, { method: "DELETE" }),
};
