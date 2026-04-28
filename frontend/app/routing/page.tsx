"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMe, getRoutingState, setRoutingStrategy, setCanary, setCircuit,
  type User, type RoutingNode,
} from "@/lib/api";

type Strategy = { id: "rr" | "least" | "sticky" | "weight"; name: string; desc: string };

const STRATEGIES: Strategy[] = [
  { id: "rr",     name: "Round Robin",    desc: "Distribute requests evenly across nodes." },
  { id: "least",  name: "Least Conn",     desc: "Send to the node with the fewest active connections." },
  { id: "sticky", name: "Sticky Session", desc: "Pin each client to a node by IP hash." },
  { id: "weight", name: "Weighted",       desc: "Distribute proportional to node weights." },
];

function BreakerBadge({ state }: { state: "closed" | "half" | "open" }) {
  const cfg = {
    closed: { label: "closed", cls: "bg-green-500/20 text-green-400 border-green-500/30" },
    half:   { label: "half-open", cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    open:   { label: "open", cls: "bg-red-500/20 text-red-400 border-red-500/30" },
  }[state];
  return <span className={`text-xs px-2 py-0.5 rounded border font-mono ${cfg.cls}`}>{cfg.label}</span>;
}

export default function RoutingPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [strategy, setStrategy] = useState<"rr" | "least" | "sticky" | "weight">("rr");
  const [nodes, setNodes] = useState<RoutingNode[]>([]);
  const [canaryActive, setCanaryActive] = useState(false);
  const [canaryPct, setCanaryPct] = useState(10);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMe().then(setUser).catch(() => router.push("/login"));
  }, [router]);

  async function loadData() {
    setLoading(true);
    try {
      const state = await getRoutingState();
      setStrategy(state.strategy);
      setCanaryActive(state.canary_active);
      setCanaryPct(state.canary_percent);
      setNodes(state.nodes);
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  async function saveStrategy(next: "rr" | "least" | "sticky" | "weight") {
    setSaving(true);
    setStrategy(next);
    await setRoutingStrategy(next).catch(() => undefined);
    await loadData();
    setSaving(false);
  }

  async function saveCanary(active: boolean, pct: number) {
    setCanaryActive(active);
    setCanaryPct(pct);
    await setCanary(active, pct).catch(() => undefined);
    await loadData();
  }

  async function updateBreaker(nodeId: string, breaker: "closed" | "half" | "open") {
    await setCircuit(nodeId, breaker).catch(() => undefined);
    await loadData();
  }

  const totalReqs = nodes.reduce((s, n) => s + n.reqs, 0) || 1;

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
            DockCampus <span className="text-orange-500">Routing</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="text-xs px-3 py-1.5 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors disabled:opacity-40"
          >
            {loading ? "..." : "Refresh"}
          </button>
          <button
            onClick={() => saveCanary(canaryActive, canaryPct)}
            disabled={saving}
            className="text-xs px-3 py-1.5 bg-orange-500 hover:bg-orange-600 rounded text-white transition-colors disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Deployment / Routing</div>
          <h2 style={{ fontFamily: "'Syne', sans-serif" }} className="text-2xl font-bold">Load Balancer</h2>
          <p className="text-sm text-zinc-500 mt-1">Routing configuration backed by live backend state.</p>
        </div>

        {/* Strategy picker */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <h3 style={{ fontFamily: "'Syne', sans-serif" }} className="font-semibold">Load balancing strategy</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => saveStrategy(s.id)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  strategy === s.id
                    ? "border-orange-500 bg-orange-500/10"
                    : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-zinc-100">{s.name}</span>
                  {strategy === s.id && <span className="text-orange-400 text-xs">✓</span>}
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">{s.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Live traffic */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 style={{ fontFamily: "'Syne', sans-serif" }} className="font-semibold">Live traffic</h3>
            <span className="font-mono text-xs text-zinc-400">{Math.round(totalReqs)} req/min</span>
          </div>

          {loading ? (
            <p className="text-zinc-500 text-sm">Loading routing data...</p>
          ) : nodes.length === 0 ? (
            <p className="text-zinc-500 text-sm">No routing telemetry available yet.</p>
          ) : (
            <div className="space-y-5">
              {nodes.map((n) => {
                const pct = (n.reqs / totalReqs) * 100;
                const barColor = n.breaker === "open" ? "#ef4444" : n.breaker === "half" ? "#eab308" : "#f97316";
                return (
                  <div key={n.id} className="space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-zinc-100">{n.id}</span>
                        <BreakerBadge state={n.breaker} />
                        {!n.online && <span className="text-xs text-zinc-600">offline</span>}
                      </div>
                      <div className="flex items-center gap-4 font-mono text-xs text-zinc-400">
                        <span>req <span className="text-zinc-200">{Math.round(n.reqs)}</span></span>
                        <span>rt <span className="text-zinc-200">{Math.round(n.rt)}ms</span></span>
                        <span>err <span className={n.err > 1 ? "text-red-400" : "text-zinc-200"}>{n.err.toFixed(1)}%</span></span>
                        <span className="text-zinc-500">{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                    </div>
                    <div className="flex items-center gap-2">
                      {n.breaker === "closed" && (
                        <button
                          type="button"
                          onClick={() => updateBreaker(n.id, "open")}
                          className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-2 py-1 rounded transition-colors"
                        >
                          simulate failure
                        </button>
                      )}
                      {n.breaker === "open" && (
                        <button
                          type="button"
                          onClick={() => updateBreaker(n.id, "half")}
                          className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-2 py-1 rounded transition-colors"
                        >
                          half-open
                        </button>
                      )}
                      {n.breaker !== "closed" && (
                        <button
                          type="button"
                          onClick={() => updateBreaker(n.id, "closed")}
                          className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-2 py-1 rounded transition-colors"
                        >
                          close
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Canary */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 style={{ fontFamily: "'Syne', sans-serif" }} className="font-semibold">Canary deployment</h3>
              <p className="text-xs text-zinc-500 mt-1">
                {canaryActive
                  ? `Routing ${canaryPct}% of traffic to canary.`
                  : "Gradually roll out a new version alongside stable replicas."}
              </p>
            </div>
            {!canaryActive ? (
              <button
                type="button"
                onClick={() => saveCanary(true, canaryPct)}
                className="text-xs px-4 py-2 bg-orange-500 hover:bg-orange-600 rounded text-white transition-colors"
              >
                ⚡ Deploy canary
              </button>
            ) : (
              <button
                type="button"
                onClick={() => saveCanary(false, canaryPct)}
                className="text-xs px-4 py-2 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
              >
                Rollback
              </button>
            )}
          </div>

          {canaryActive && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-zinc-500 uppercase tracking-wider">Traffic share</span>
                  <span className="font-mono text-sm text-orange-400">{canaryPct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={canaryPct}
                  onChange={(e) => {
                    const next = parseInt(e.target.value, 10);
                    setCanaryPct(next);
                    void saveCanary(true, next);
                  }}
                  className="w-full accent-orange-500"
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
