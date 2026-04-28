"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMe, getSleepStatus, listSleepCandidates, runSleepManagerOnce,
  type SleepCandidate, type SleepReport, type SleepStatus, type User,
} from "@/lib/api";

export default function SleepPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SleepStatus | null>(null);
  const [candidates, setCandidates] = useState<SleepCandidate[]>([]);
  const [lastRun, setLastRun] = useState<SleepReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    getMe().then(setUser).catch(() => router.push("/login"));
  }, [router]);

  async function loadData() {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([getSleepStatus(), listSleepCandidates(200)]);
      setStatus(s);
      setCandidates(c);
    } catch {
      setStatus(null);
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  async function runNow() {
    setRunning(true);
    try {
      const report = await runSleepManagerOnce().catch(() => null);
      if (report) setLastRun(report);
      await loadData();
    } finally {
      setRunning(false);
    }
  }

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
            DockCampus <span className="text-orange-500">Sleep</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="text-xs px-3 py-1.5 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors disabled:opacity-40">
            {loading ? "..." : "Refresh"}
          </button>
          {user.role === "admin" && (
            <button onClick={runNow} disabled={running} className="text-xs px-3 py-1.5 bg-orange-500 hover:bg-orange-600 rounded text-white transition-colors disabled:opacity-40">
              {running ? "Running..." : "🌙 Run now"}
            </button>
          )}
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Container Sleep</div>
          <h2 style={{ fontFamily: "'Syne', sans-serif" }} className="text-2xl font-bold">Idle manager</h2>
          <p className="text-sm text-zinc-500 mt-1">Automatic sleep for inactive running containers.</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <h3 style={{ fontFamily: "'Syne', sans-serif" }} className="font-semibold">Status</h3>
          {!status ? (
            <p className="text-zinc-500 text-sm">{loading ? "Loading status..." : "No sleep manager status available."}</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${status.config.enabled ? "bg-green-500 animate-pulse" : "bg-zinc-600"}`} />
                <span className="text-sm text-zinc-300">Manager {status.config.enabled ? "enabled" : "disabled"}</span>
              </div>
              <p className="font-mono text-xs text-zinc-500">
                idle threshold: {status.config.idle_sleep_minutes}m · scan every {status.config.scan_interval_seconds}s
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                {[
                  { label: "Running", value: status.running, color: "text-green-400" },
                  { label: "Sleeping", value: status.sleeping, color: "text-blue-400" },
                  { label: "Stopped", value: status.stopped, color: "text-zinc-400" },
                  { label: "Idle candidates", value: status.idle_candidates, color: "text-yellow-400" },
                ].map((s) => (
                  <div key={s.label} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                    <div className={`text-2xl font-bold ${s.color}`} style={{ fontFamily: "'Syne', sans-serif" }}>{s.value}</div>
                    <div className="text-xs text-zinc-600 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {lastRun && (
            <p className="font-mono text-xs text-zinc-500 pt-2 border-t border-zinc-800">
              last run: scanned {lastRun.scanned} · slept {lastRun.slept} · failed {lastRun.failed} · skipped {lastRun.skipped}
            </p>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800">
            <h3 style={{ fontFamily: "'Syne', sans-serif" }} className="text-sm font-semibold">Idle candidates</h3>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-zinc-500 text-sm">
              <div className="w-4 h-4 border border-orange-500 border-t-transparent rounded-full animate-spin" />
              Loading candidates...
            </div>
          ) : candidates.length === 0 ? (
            <div className="p-8 text-center text-zinc-600 text-sm">No idle running containers at the moment.</div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {candidates.map((c) => (
                <div key={c.user_id} className="p-4">
                  <p className="font-mono text-sm text-zinc-200">user {c.user_id}</p>
                  <p className="font-mono text-xs text-zinc-500 mt-1">container {c.docker_container_id || "(no docker id)"}</p>
                  <p className="font-mono text-xs text-zinc-600 mt-1">last activity {new Date(c.last_activity).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
