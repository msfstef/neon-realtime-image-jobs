import { useLiveQuery } from "@neon/realtime-react";
import { useCallback } from "react";

import { api, type LiveBootstrap } from "./api";

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function ActivityFeed({ live }: { live: LiveBootstrap }) {
  const refresh = useCallback(() => api.renew("events"), []);
  const { data, status } = useLiveQuery(live.queries.events, { refreshQuery: refresh });

  return (
    <section className="activity">
      <h2>
        Activity <span className={`pill ${status}`}>{status}</span>
      </h2>
      <ol className="events card" data-testid="activity">
        {data?.map((event) => (
          <li className={event.stage === "failed" ? "error" : undefined} key={event.id}>
            <time className="muted">{time.format(event.created_at)}</time>
            <span className="filename">{event.filename}</span>
            <span>{event.message}</span>
          </li>
        ))}
        {data?.length === 0 && <li className="muted">Nothing yet.</li>}
      </ol>
    </section>
  );
}
