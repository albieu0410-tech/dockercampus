"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Zap } from "lucide-react";
import Navbar from "@/components/Navbar";
import { getMe, type User } from "@/lib/api";

type Strategy = { id: string; name: string; desc: string };
type RouteNode = { id: string; reqs: number; rt: number; err: number; breaker: "closed" | "half" | "open"; failures: number };

const STRATEGIES: Strategy[] = [
  { id: "rr", name: "Round Robin", desc: "Distribute requests evenly across nodes." },
  { id: "least", name: "Least Conn", desc: "Send to the node with the fewest active connections." },
  { id: "sticky", name: "Sticky Session", desc: "Pin each client to a node by IP hash." },
  { id: "weight", name: "Weighted", desc: "Distribute proportional to node weights." },
];

export default function RoutingPage() {
  const [user, setUser] = useState<User | null>(null);
  const [strategy, setStrategy] = useState("rr");
  const [nodes, setNodes] = useState<RouteNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [canaryActive, setCanaryActive] = useState(false);
  const [canaryPct, setCanaryPct] = useState(10);

  useEffect(() => {
    getMe().then(setUser).catch(() => {
      window.location.href = "/login";
    });
  }, []);

  async function loadRoutingData() {
    setLoadingNodes(true);
    try {
      setNodes([]);
      setCanaryActive(false);
      setCanaryPct(10);
    } finally {
      setLoadingNodes(false);
    }
  }

  useEffect(() => {
    loadRoutingData();
  }, []);

  const totalReqs = useMemo(() => nodes.reduce((s, n) => s + n.reqs, 0), [nodes]);

  if (!user) {
    return <div className="page-shell" style={{ display: "grid", placeItems: "center" }}>Loading...</div>;
  }

  return (
    <div className="page-shell">
      <Navbar user={user} />
      <main className="page stack-y-6">
        <div className="flex-between" style={{ flexWrap: "wrap" }}>
          <div>
            <div className="label-ups">Deployment / Routing</div>
            <h2 style={{ marginTop: 6 }}><span className="mono">Deployment</span></h2>
            <p>Routing configuration view ready for backend data.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary btn-sm" type="button">Discard</button>
            <button className="btn btn-primary btn-sm" type="button"><Check size={12} /> Save changes</button>
          </div>
        </div>

        <div className="card card-pad stack-y-3">
          <h3>Load balancing strategy</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="card"
                onClick={() => setStrategy(s.id)}
                style={{ padding: 12, textAlign: "left", borderColor: strategy === s.id ? "var(--accent)" : undefined }}
              >
                <div className="flex-between"><strong style={{ color: "var(--text)", fontSize: 13 }}>{s.name}</strong>{strategy === s.id && <Check size={13} color="var(--accent)" />}</div>
                <p style={{ fontSize: 12, marginTop: 6 }}>{s.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="card card-pad stack-y-4">
          <div className="flex-between"><h3>Live traffic</h3><p className="mono" style={{ fontSize: 11 }}>{Math.round(totalReqs)} req/min</p></div>
          {loadingNodes ? (
            <div>Loading routing data...</div>
          ) : nodes.length === 0 ? (
            <div>No routing telemetry available yet. Connect the new backend to populate this view.</div>
          ) : (
            nodes.map((n, i) => {
              const pct = totalReqs > 0 ? (n.reqs / totalReqs) * 100 : 0;
              return (
                <div key={n.id} className="stack-y-2">
                  <div className="flex-between" style={{ flexWrap: "wrap" }}>
                    <p className="mono" style={{ color: "var(--text)", fontSize: 12 }}>{n.id}</p>
                    <p className="mono" style={{ fontSize: 11 }}>req {Math.round(n.reqs)} · rt {Math.round(n.rt)}ms · err {n.err.toFixed(1)}%</p>
                  </div>
                  <div className="meter" style={{ height: 6 }}><div className="meter-fill" style={{ width: `${pct}%` }} /></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {n.breaker === "closed" && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNodes((prev) => prev.map((x, idx) => idx === i ? { ...x, breaker: "open", failures: x.failures + 5 } : x))}>simulate failure</button>
                    )}
                    {n.breaker === "open" && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNodes((prev) => prev.map((x, idx) => idx === i ? { ...x, breaker: "half" } : x))}>half-open</button>
                    )}
                    {n.breaker !== "closed" && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNodes((prev) => prev.map((x, idx) => idx === i ? { ...x, breaker: "closed", failures: 0 } : x))}>close</button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="card card-pad stack-y-3">
          <div className="flex-between" style={{ flexWrap: "wrap" }}>
            <h3>Canary deployment</h3>
            {!canaryActive ? (
              <button className="btn btn-primary btn-sm" type="button" onClick={() => setCanaryActive(true)}><Zap size={12} /> Deploy canary</button>
            ) : (
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setCanaryActive(false)}>Rollback</button>
            )}
          </div>
          {canaryActive && (
            <>
              <p>Routing <span className="mono">{canaryPct}%</span> traffic to canary.</p>
              <input type="range" min={0} max={100} value={canaryPct} onChange={(e) => setCanaryPct(parseInt(e.target.value, 10))} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
