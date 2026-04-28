"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelJob, createJob, getMe, listJobs, retryJob, type Job, type User } from "@/lib/api";

const STATUS_STYLE: Record<string, string> = {
  pending:   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  running:   "bg-blue-500/20 text-blue-400 border-blue-500/30",
  done:      "bg-green-500/20 text-green-400 border-green-500/30",
  failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  cancelled: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

export default function JobsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [jobType, setJobType] = useState("cleanup");

  useEffect(() => {
    getMe().then(setUser).catch(() => router.push("/login"));
  }, [router]);

  async function loadJobs() {
    setLoading(true);
    try {
      setJobs(await listJobs({ limit: 200 }));
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadJobs(); }, []);

  async function enqueue() {
    await createJob({ job_type: jobType, payload: { source: "ui" }, max_retries: 3 }).catch(() => undefined);
    await loadJobs();
  }

  const counters = useMemo(() => jobs.reduce(
    (acc, j) => { acc.total++; acc[j.status as keyof typeof acc]++; return acc; },
    { total: 0, pending: 0, running: 0, failed: 0, done: 0, cancelled: 0 } as Record<string, number>
  ), [jobs]);

  if (!user) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');`}</style>

      <div className="border-b border-zinc-800 px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/admin" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">← Admin</a>
          <div className="w-px h-4 bg-zinc-800" />
          <div style={{ fontFamily: "'Syne', sans-serif" }} className="text-base font-bold tracking-tight">
            DockCampus <span className="text-orange-500">Jobs</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadJobs} disabled={loading} className="text-xs px-3 py-1.5 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors disabled:opacity-40">
            {loading ? "..." : "Refresh"}
          </button>
          {user.role === "admin" && (
            <button onClick={enqueue} className="text-xs px-3 py-1.5 bg-orange-500 hover:bg-orange-600 rounded text-white transition-colors">
              + Enqueue
            </button>
          )}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Queue</div>
          <h2 style={{ fontFamily: "'Syne', sans-serif" }} className="text-2xl font-bold">Persistent jobs</h2>
          <p className="font-mono text-xs text-zinc-500 mt-2">
            total {counters.total} · pending {counters.pending} · running {counters.running} · failed {counters.failed}
          </p>
        </div>

        {user.role === "admin" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3 flex-wrap">
            <label className="text-xs text-zinc-500 uppercase tracking-wider shrink-0">Job type</label>
            <input
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-orange-500"
              style={{ maxWidth: 280 }}
            />
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800">
            <h3 style={{ fontFamily: "'Syne', sans-serif" }} className="text-sm font-semibold">Recent jobs</h3>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-zinc-500 text-sm">
              <div className="w-4 h-4 border border-orange-500 border-t-transparent rounded-full animate-spin" />
              Loading jobs...
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-8 text-center text-zinc-600 text-sm">No jobs found.</div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {jobs.map((job) => (
                <div key={job.id} className="p-4 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <p className="font-mono text-sm text-zinc-100">{job.job_type}</p>
                      <p className="font-mono text-xs text-zinc-600">#{job.id.slice(0, 16)}...</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded border font-mono ${STATUS_STYLE[job.status] ?? "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"}`}>
                      {job.status}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-zinc-600 mt-2">
                    retries {job.retries}/{job.max_retries} · {new Date(job.created_at).toLocaleString()}
                  </p>
                  {job.error && <p className="text-xs text-red-400 mt-2">{job.error}</p>}
                  {user.role === "admin" && (
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={async () => { await retryJob(job.id).catch(() => undefined); loadJobs(); }}
                        className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-2 py-1 rounded transition-colors"
                      >
                        retry
                      </button>
                      <button
                        type="button"
                        onClick={async () => { await cancelJob(job.id).catch(() => undefined); loadJobs(); }}
                        className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-2 py-1 rounded transition-colors"
                      >
                        cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
