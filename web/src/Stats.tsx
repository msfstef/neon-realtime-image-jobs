import { useLiveQuery } from "@neon/realtime-react";
import { useCallback } from "react";

import type { JobStatus } from "../../shared/types";
import { api, type LiveBootstrap } from "./api";

const STATUSES: JobStatus[] = ["queued", "processing", "completed", "failed"];

// Two aggregate live queries: Realtime keeps the GROUP BY results current.
export function Stats({ live }: { live: LiveBootstrap }) {
  const refreshStatuses = useCallback(() => api.renew("statuses"), []);
  const refreshCategories = useCallback(() => api.renew("categories"), []);
  const statuses = useLiveQuery(live.queries.statuses, { refreshQuery: refreshStatuses });
  const categories = useLiveQuery(live.queries.categories, { refreshQuery: refreshCategories });

  const countByStatus = new Map(statuses.data?.map((row) => [row.status, row.count]));
  const sortedCategories = [...(categories.data ?? [])].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return (
    <section className="stats">
      <div className="card">
        <h3>By status</h3>
        <div className="counts" data-testid="status-counts">
          {STATUSES.map((status) => (
            <div className={`count ${status}`} key={status}>
              <strong>{countByStatus.get(status) ?? 0}</strong>
              <span className="muted small">{status}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>By category</h3>
        {sortedCategories.length === 0 ? (
          <p className="muted small">Completed jobs will be grouped here.</p>
        ) : (
          <p className="tags" data-testid="category-counts">
            {sortedCategories.map((row) => (
              <span key={row.category}>
                {row.category} <strong>{row.count}</strong>
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}
