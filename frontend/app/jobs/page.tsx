"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus } from "lucide-react";
import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";
import {
  cancelJob,
  createJob,
  getMe,
  listJobs,
  retryJob,
  type Job,
  type User,
} from "@/lib/api";

export default function JobsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [jobType, setJobType] = useState("cleanup");

  useEffect(() => {
    getMe().then(setUser).catch(() => {
      window.location.href = "/login";
    });
  }, []);

  async function loadJobs() {
    setLoading(true);
    try {
      const data = await listJobs({ limit: 200 });
      setJobs(data);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  async function enqueue() {
    if (user?.role !== "admin") return;
    await createJob({ job_type: jobType, payload: { source: "ui" }, max_retries: 3 }).catch(() => undefined);
    await loadJobs();
  }

  async function onRetry(id: string) {
    if (user?.role !== "admin") return;
    await retryJob(id).catch(() => undefined);
    await loadJobs();
  }

  async function onCancel(id: string) {
    if (user?.role !== "admin") return;
    await cancelJob(id).catch(() => undefined);
    await loadJobs();
  }

  const counters = useMemo(() => {
    return jobs.reduce(
      (acc, job) => {
        acc.total += 1;
        if (job.status === "pending") acc.pending += 1;
        if (job.status === "running") acc.running += 1;
        if (job.status === "failed") acc.failed += 1;
        return acc;
      },
      { total: 0, pending: 0, running: 0, failed: 0 }
    );
  }, [jobs]);

  if (!user) {
    return <div className="page-shell" style={{ display: "grid", placeItems: "center" }}>Loading...</div>;
  }

  return (
    <div className="page-shell">
      <Navbar user={user} />
      <div className="flex">
        <Sidebar user={user} />
        <main className="page stack-y-6 flex-1">
        <div className="flex-between" style={{ flexWrap: "wrap" }}>
          <div>
            <div className="label-ups">Queue</div>
            <h2 style={{ marginTop: 6 }}>Persistent jobs</h2>
            <p className="mono" style={{ fontSize: 12 }}>
              total {counters.total} · pending {counters.pending} · running {counters.running} · failed {counters.failed}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary btn-sm" type="button" onClick={loadJobs}><RefreshCw size={12} /> Refresh</button>
            {user.role === "admin" && (
              <button className="btn btn-primary btn-sm" type="button" onClick={enqueue}><Plus size={12} /> Enqueue</button>
            )}
          </div>
        </div>

        {user.role === "admin" && (
          <div className="card card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label className="label-ups" htmlFor="job-type">New job type</label>
            <input
              id="job-type"
              className="input"
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              style={{ maxWidth: 260 }}
            />
          </div>
        )}

        <div className="card card-pad stack-y-3">
          <h3>Recent jobs</h3>
          {loading ? (
            <p>Loading jobs...</p>
          ) : jobs.length === 0 ? (
            <p>No jobs found.</p>
          ) : (
            jobs.map((job) => (
              <div key={job.id} className="card" style={{ padding: 12 }}>
                <div className="flex-between" style={{ flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <p className="mono" style={{ color: "var(--text)", fontSize: 12 }}>{job.job_type}</p>
                    <p className="mono" style={{ fontSize: 11 }}>#{job.id}</p>
                  </div>
                  <span className="mono" style={{ fontSize: 11 }}>{job.status}</span>
                </div>
                <p className="mono" style={{ fontSize: 11, marginTop: 8 }}>
                  retries {job.retries}/{job.max_retries} · created {new Date(job.created_at).toLocaleString()}
                </p>
                {job.error && <p style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>{job.error}</p>}

                {user.role === "admin" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => onRetry(job.id)}>retry</button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => onCancel(job.id)}>cancel</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        </main>
      </div>
    </div>
  );
}
