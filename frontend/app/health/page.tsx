"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";

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

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const [interval, setIntervalValue] = useState(10);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      const resp = await fetch(apiUrl("/health"));
      const json = await resp.json();
      setData(json);
      setError(false);
      setLastChecked(new Date());
    } catch {
      setError(true);
      setLastChecked(new Date());
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    check();
    const id = setInterval(check, interval * 1000);
    return () => clearInterval(id);
  }, [interval]);

  const overallOk = !error && data?.status === "ok";

  return (
    <div className="page-shell">
      <main className="page stack-y-4">
        <div className="flex-between" style={{ flexWrap: "wrap" }}>
          <div>
            <div className="label-ups">Status</div>
            <h2 style={{ marginTop: 6 }}>DockCampus health</h2>
          </div>
          <span className={`status-dot ${overallOk ? "status-running" : "status-error"}`}>
            <span className="status-dot-circle" /> {overallOk ? "All systems operational" : "Degraded"}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
          <div className="card card-pad stack-y-2">
            <div className="label-ups">API</div>
            <h3>{error ? "unreachable" : "operational"}</h3>
            <p className="mono" style={{ fontSize: 12 }}>api.sudelca.com</p>
            {data && <p>Uptime: {formatUptime(data.uptime_seconds)}</p>}
          </div>
          <div className="card card-pad stack-y-2">
            <div className="label-ups">Database</div>
            <h3>{data?.services.database.status ?? "unknown"}</h3>
            {data?.services.database.latency_ms !== undefined && (
              <p className="mono" style={{ fontSize: 12 }}>Latency: {data.services.database.latency_ms}ms</p>
            )}
          </div>
        </div>

        <div className="card card-pad stack-y-3">
          <div className="flex-between" style={{ flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {[5, 10, 30, 60].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn btn-sm ${interval === s ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setIntervalValue(s)}
                >
                  {s}s
                </button>
              ))}
            </div>
            <button type="button" onClick={check} disabled={checking} className="btn btn-secondary btn-sm">
              {checking ? "Checking..." : "Check now"}
            </button>
          </div>
          {lastChecked && <p className="mono" style={{ fontSize: 12 }}>Last checked: {lastChecked.toLocaleTimeString()}</p>}
          <a href="/dashboard" className="mono" style={{ fontSize: 12 }}>Back to dashboard</a>
        </div>
      </main>
    </div>
  );
}
