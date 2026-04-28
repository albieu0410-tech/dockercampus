"use client";

import { useEffect, useState } from "react";
import { MoonStar, RefreshCw } from "lucide-react";
import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";
import {
  getMe,
  getSleepStatus,
  listSleepCandidates,
  runSleepManagerOnce,
  type SleepCandidate,
  type SleepReport,
  type SleepStatus,
  type User,
} from "@/lib/api";

export default function SleepPage() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SleepStatus | null>(null);
  const [candidates, setCandidates] = useState<SleepCandidate[]>([]);
  const [lastRun, setLastRun] = useState<SleepReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getMe().then(setUser).catch(() => {
      window.location.href = "/login";
    });
  }, []);

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

  useEffect(() => {
    loadData();
  }, []);

  async function runNow() {
    if (user?.role !== "admin") return;
    const report = await runSleepManagerOnce().catch(() => null);
    if (report) setLastRun(report);
    await loadData();
  }

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
            <div className="label-ups">Container Sleep</div>
            <h2 style={{ marginTop: 6 }}>Idle manager</h2>
            <p>Automatic sleep for inactive running containers.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary btn-sm" type="button" onClick={loadData}><RefreshCw size={12} /> Refresh</button>
            {user.role === "admin" && (
              <button className="btn btn-primary btn-sm" type="button" onClick={runNow}><MoonStar size={12} /> Run now</button>
            )}
          </div>
        </div>

        <div className="card card-pad stack-y-3">
          <h3>Status</h3>
          {!status ? (
            <p>{loading ? "Loading status..." : "No sleep manager status available."}</p>
          ) : (
            <>
              <p>
                manager {status.config.enabled ? "enabled" : "disabled"} · idle {status.config.idle_sleep_minutes}m · scan every {status.config.scan_interval_seconds}s
              </p>
              <p className="mono" style={{ fontSize: 12 }}>
                running {status.running} · sleeping {status.sleeping} · stopped {status.stopped} · idle candidates {status.idle_candidates}
              </p>
            </>
          )}
          {lastRun && (
            <p className="mono" style={{ fontSize: 12 }}>
              last run: scanned {lastRun.scanned}, slept {lastRun.slept}, failed {lastRun.failed}, skipped {lastRun.skipped}
            </p>
          )}
        </div>

        <div className="card card-pad stack-y-3">
          <h3>Idle candidates</h3>
          {loading ? (
            <p>Loading candidates...</p>
          ) : candidates.length === 0 ? (
            <p>No idle running containers at the moment.</p>
          ) : (
            candidates.map((candidate) => (
              <div key={candidate.user_id} className="card" style={{ padding: 12 }}>
                <p className="mono" style={{ color: "var(--text)", fontSize: 12 }}>
                  user {candidate.user_id}
                </p>
                <p className="mono" style={{ fontSize: 11 }}>
                  container {candidate.docker_container_id || "(missing docker id)"}
                </p>
                <p className="mono" style={{ fontSize: 11 }}>
                  last activity {new Date(candidate.last_activity).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
        </main>
      </div>
    </div>
  );
}
