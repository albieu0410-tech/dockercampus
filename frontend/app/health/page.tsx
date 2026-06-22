"use client";
import { useEffect, useState } from "react";
import { API_URL, apiUrl, getMe, type User } from "@/lib/api";
import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";

type ServiceStatus = {
  status: string;
  latency_ms?: number;
};

type HealthData = {
  status: string;
  uptime_seconds: number;
  services: {
    api: ServiceStatus;
    database: ServiceStatus;
  };
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatusDot({ status }: { status: string }) {
  const ok = status === "ok";
  return (
    <span className={`inline-flex w-2.5 h-2.5 rounded-full ${ok ? "bg-green-500" : "bg-red-500"} shrink-0`} />
  );
}

export default function HealthPage() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<HealthData | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const [interval, setIntervalValue] = useState(10);
  const [checking, setChecking] = useState(false);
  const [history, setHistory] = useState<{ time: Date; status: string }[]>([]);

  async function check() {
    setChecking(true);
    try {
      const resp = await fetch(apiUrl("/health"));
      const json = await resp.json();
      setData(json);
      setError(false);
      setLastChecked(new Date());
      setHistory((prev) => [{ time: new Date(), status: json.status }, ...prev.slice(0, 19)]);
    } catch {
      setError(true);
      setLastChecked(new Date());
      setHistory((prev) => [{ time: new Date(), status: "error" }, ...prev.slice(0, 19)]);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    getMe().then(setUser).catch(() => {
      window.location.href = "/login";
    });
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, interval * 1000);
    return () => clearInterval(id);
  }, [interval]);

  const overallOk = !error && data?.status === "ok";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');`}</style>
      {user && <Navbar user={user} />}
      <div className="flex">
        {user && <Sidebar user={user} />}
        <div className="flex-1 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif" }} className="text-2xl font-bold">
              DockCampus <span className="text-orange-500">Status</span>
            </div>
            <p className="text-zinc-500 text-xs mt-1">System health monitor</p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${
                overallOk
                  ? "bg-green-500/10 border-green-500/30 text-green-400"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${overallOk ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              {overallOk ? "All systems operational" : error ? "API unreachable" : "Degraded"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={error ? "error" : "ok"} />
                <span className="text-sm font-medium">API Server</span>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  error ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"
                }`}
              >
                {error ? "down" : "operational"}
              </span>
            </div>
            <div className="text-xs text-zinc-500">{API_URL}</div>
            {data && (
              <div className="text-xs text-zinc-400">
                Uptime: <span className="text-zinc-200">{formatUptime(data.uptime_seconds)}</span>
              </div>
            )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={data?.services.database.status ?? "error"} />
                <span className="text-sm font-medium">Database</span>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  data?.services.database.status === "ok"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                {data?.services.database.status ?? "unknown"}
              </span>
            </div>
            <div className="text-xs text-zinc-500">PostgreSQL</div>
            {data?.services.database.latency_ms !== undefined && (
              <div className="text-xs text-zinc-400">
                Latency: <span className="text-zinc-200">{data.services.database.latency_ms}ms</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-400">Check interval</p>
              <div className="flex gap-2">
                {[5, 10, 30, 60].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setIntervalValue(s)}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                      interval === s
                        ? "bg-orange-500 border-orange-500 text-white"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>
            <div className="text-right">
              <button
                type="button"
                onClick={check}
                disabled={checking}
                className="text-xs px-4 py-2 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors disabled:opacity-40"
              >
                {checking ? "Checking..." : "Check now"}
              </button>
              {lastChecked && <p className="text-xs text-zinc-600 mt-1">Last: {lastChecked.toLocaleTimeString()}</p>}
            </div>
          </div>
        </div>

        {history.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <p className="text-xs font-medium text-zinc-400">Check history</p>
            <div className="flex gap-1 flex-wrap">
              {history.map((h, i) => (
                <div
                  key={i}
                  title={`${h.time.toLocaleTimeString()} - ${h.status}`}
                  className={`w-5 h-5 rounded-sm ${
                    h.status === "ok" ? "bg-green-500" : h.status === "degraded" ? "bg-yellow-500" : "bg-red-500"
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-zinc-600">Last {history.length} checks - hover for details</p>
          </div>
        )}

        <div className="text-center text-xs text-zinc-700">
          Auto-refreshing every {interval}s -{" "}
          <a href="/dashboard" className="hover:text-zinc-500">
            Back to dashboard
          </a>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}
