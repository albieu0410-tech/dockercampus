"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe, listHiveNodes, getHiveJoinInfo, type HiveNode, type User } from "@/lib/api";

function nodeColor(cpu: number, ramPct: number) {
  const load = Math.max(cpu, ramPct);
  if (load > 80) return "#ef4444";
  if (load > 60) return "#eab308";
  return "#22c55e";
}

function MeterBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

function NodeCard({ n }: { n: HiveNode }) {
  const ramPct = n.ram_total > 0 ? (n.ram_used / n.ram_total) * 100 : 0;
  const diskPct = n.disk_total > 0 ? (n.disk_used / n.disk_total) * 100 : 0;
  const color = nodeColor(n.cpu, ramPct);
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {n.role === "queen" && <span className="text-orange-400 text-xs">♛</span>}
          <span className="font-mono text-sm text-zinc-100">{n.id}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${n.online ? "bg-green-500 animate-pulse" : "bg-zinc-600"}`} />
          <span className="text-xs text-zinc-400">{n.online ? "online" : "offline"}</span>
        </div>
      </div>
      <p className="font-mono text-xs text-zinc-500">{n.host} · {n.ip}</p>
      <div className="space-y-3">
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">RAM</span>
            <span className="font-mono text-xs text-zinc-300">{n.ram_used.toFixed(1)} / {n.ram_total} GB</span>
          </div>
          <MeterBar pct={ramPct} color={color} />
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">CPU</span>
            <span className="font-mono text-xs text-zinc-300">{Math.round(n.cpu)}%</span>
          </div>
          <MeterBar pct={n.cpu} color={nodeColor(n.cpu, 0)} />
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Disk</span>
            <span className="font-mono text-xs text-zinc-300">{n.disk_used} / {n.disk_total} GB</span>
          </div>
          <MeterBar pct={diskPct} color="#f97316" />
        </div>
      </div>
      <p className="font-mono text-xs text-zinc-600">{n.deployments} deployments · heartbeat {n.last}</p>
    </div>
  );
}

type Position = { x: number; y: number };

function NodeMap({ nodes }: { nodes: HiveNode[] }) {
  const positions = useMemo<Record<string, Position>>(() => {
    const w = 800, h = 300;
    const cx = w / 2, cy = h / 2;
    const pos: Record<string, Position> = {};
    const queen = nodes.find((n) => n.role === "queen");
    if (queen) pos[queen.id] = { x: cx, y: cy };
    const workers = nodes.filter((n) => n.role === "worker");
    workers.forEach((n, i) => {
      const a = (i / workers.length) * Math.PI * 2 - Math.PI / 2;
      const r = workers.length <= 2 ? 150 : workers.length <= 4 ? 120 : 130;
      pos[n.id] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });
    return pos;
  }, [nodes]);

  const queen = nodes.find((n) => n.role === "queen");
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">WireGuard mesh</span>
        <div className="flex items-center gap-4 font-mono text-xs text-zinc-500">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />healthy</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />loaded</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />critical</span>
        </div>
      </div>
      <svg viewBox="0 0 800 300" className="w-full" style={{ height: 300 }}>
        {nodes.filter((n) => n.role === "worker").map((w) => {
          if (!queen) return null;
          const a = positions[queen.id], b = positions[w.id];
          if (!a || !b) return null;
          const ramPct = w.ram_total > 0 ? (w.ram_used / w.ram_total) * 100 : 0;
          const color = nodeColor(w.cpu, ramPct);
          return (
            <g key={w.id + "-edge"}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#27272a" strokeWidth="1" />
              <circle r="2.5" fill={color}>
                <animateMotion dur="2.5s" repeatCount="indefinite" path={`M${a.x},${a.y} L${b.x},${b.y}`} />
              </circle>
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = positions[n.id];
          if (!p) return null;
          const isQueen = n.role === "queen";
          const ramPct = n.ram_total > 0 ? (n.ram_used / n.ram_total) * 100 : 0;
          const color = nodeColor(n.cpu, ramPct);
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={isQueen ? 22 : 16} fill="#18181b" stroke={color} strokeWidth="2" />
              {isQueen && (
                <text x={p.x} y={p.y - 28} textAnchor="middle" fontSize="10" fill="#f97316" fontFamily="monospace">♛ queen</text>
              )}
              <text x={p.x} y={p.y + (isQueen ? 36 : 30)} textAnchor="middle" fontSize="10" fill="#a1a1aa" fontFamily="monospace">{n.id}</text>
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="9" fill="#71717a" fontFamily="monospace">{Math.round(n.cpu)}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function HivePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [nodes, setNodes] = useState<HiveNode[]>([]);
  const [joinCommand, setJoinCommand] = useState("");
  const [joinToken, setJoinToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<"cmd" | "token" | null>(null);

  useEffect(() => {
    getMe().then(setUser).catch(() => router.push("/login"));
  }, [router]);

  async function loadData() {
    setLoading(true);
    try {
      const [fetchedNodes, join] = await Promise.all([
        listHiveNodes(),
        getHiveJoinInfo().catch(() => null),
      ]);
      setNodes(fetchedNodes);
      setJoinCommand(join?.join_command ?? "");
      setJoinToken(join?.join_token ?? "");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  function copy(text: string, which: "cmd" | "token") {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
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
            DockCampus <span className="text-orange-500">Hive</span>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="text-xs px-3 py-1.5 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors disabled:opacity-40"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Hive</div>
            <h2 style={{ fontFamily: "'Syne', sans-serif" }} className="text-2xl font-bold">
              {nodes.length} nodes
              <span className="text-zinc-500 font-normal text-base ml-3">· {nodes.filter((n) => n.online).length} online</span>
            </h2>
          </div>
        </div>

        {nodes.length > 0 && <NodeMap nodes={nodes} />}

        {loading && nodes.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <div className="w-5 h-5 border border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">Loading hive nodes...</p>
          </div>
        ) : nodes.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500 text-sm">
            No hive nodes available yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {nodes.map((n) => <NodeCard key={n.id} n={n} />)}
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div>
            <h3 style={{ fontFamily: "'Syne', sans-serif" }} className="text-base font-bold">Add a node</h3>
            <p className="text-xs text-zinc-500 mt-1">Run this on any machine with Docker. It joins via WireGuard automatically.</p>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 flex items-center justify-between gap-4">
            <code className="text-xs text-orange-400 font-mono break-all">
              {joinCommand || "$ Waiting for backend..."}
            </code>
            {joinCommand && (
              <button
                onClick={() => copy(joinCommand, "cmd")}
                className="shrink-0 text-xs px-3 py-1.5 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
              >
                {copied === "cmd" ? "✓ Copied" : "Copy"}
              </button>
            )}
          </div>
          {joinToken && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="text-xs text-zinc-500 uppercase tracking-wider">Join token</span>
                <p className="font-mono text-sm text-zinc-200 mt-1">{joinToken}</p>
              </div>
              <button
                onClick={() => copy(joinToken, "token")}
                className="shrink-0 text-xs px-3 py-1.5 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
              >
                {copied === "token" ? "✓ Copied" : "Copy token"}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
