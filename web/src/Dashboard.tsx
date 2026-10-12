import { createRealtimeClient, type RealtimeClient } from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ActivityFeed } from "./ActivityFeed";
import { api, type LiveBootstrap } from "./api";
import { authClient } from "./auth";
import { JobCard } from "./JobCard";
import { Stats } from "./Stats";
import { Uploader } from "./Uploader";

export function Dashboard({ email }: { email: string }) {
  const [live, setLive] = useState<LiveBootstrap>();
  const [client, setClient] = useState<RealtimeClient>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.live().then(setLive, (cause: Error) => setError(cause.message));
  }, []);

  // One multiplexed WebSocket for every live query on the page.
  const websocketUrl = live?.websocketUrl;
  useEffect(() => {
    if (!websocketUrl) return;
    const realtime = createRealtimeClient({ url: websocketUrl, logLevel: "warn" });
    setClient(realtime);
    return () => realtime.close();
  }, [websocketUrl]);

  async function signOut() {
    await authClient.signOut();
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Neon Realtime demo</p>
          <h1>Image jobs</h1>
        </div>
        <div className="account">
          <span className="muted">{email}</span>
          <button className="ghost" onClick={signOut} type="button">
            Sign out
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {live && client ? (
        <RealtimeProvider client={client}>
          <Workspace live={live} />
        </RealtimeProvider>
      ) : (
        !error && <p className="muted">Connecting…</p>
      )}
    </div>
  );
}

function Workspace({ live }: { live: LiveBootstrap }) {
  const refreshJobs = useCallback(() => api.renew("jobs"), []);
  const jobs = useLiveQuery(live.queries.jobs, { refreshQuery: refreshJobs });
  const [batches, setBatches] = useState(0);
  // Local object URLs let the uploading tab show its image before the thumbnail exists.
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => jobs.utils.onBatch(() => setBatches((count) => count + 1)), [jobs.utils]);
  const sortedJobs = useMemo(
    () => [...(jobs.data ?? [])].sort((a, b) => b.created_at.getTime() - a.created_at.getTime()),
    [jobs.data],
  );

  const onUploaded = useCallback(
    async (id: string, txid: string, preview: string) => {
      setPreviews((current) => ({ ...current, [id]: preview }));
      // Resolves once the insert has reached this subscription over Realtime. A
      // timeout only ends the "Uploading" indicator early; the upload succeeded.
      await jobs.utils.awaitTxId(txid, 15_000).catch(() => {});
    },
    [jobs.utils],
  );

  return (
    <>
      <section className="status-row">
        <span className={`pill ${jobs.status}`}>Realtime: {jobs.status}</span>
        <span className="muted small">{batches} live batches applied</span>
      </section>
      <Uploader onUploaded={onUploaded} />
      <Stats live={live} />
      <div className="columns">
        <section>
          <h2>Jobs</h2>
          {jobs.error && <p className="error">{jobs.error.message}</p>}
          {jobs.data?.length === 0 && <p className="muted">No uploads yet. Drop an image above.</p>}
          <ul className="jobs">
            {sortedJobs.map((job) => (
              <JobCard job={job} key={job.id} preview={previews[job.id]} />
            ))}
          </ul>
        </section>
        <ActivityFeed live={live} />
      </div>
    </>
  );
}
