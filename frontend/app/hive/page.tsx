"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crown, Plus, RefreshCw } from "lucide-react";
import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";
import {
  getHiveJoinInfo,
  getMe,
  listHiveNodes,
  type HiveNode,
  type User,
} from "@/lib/api";

// ── helpers ──────────────────────────────────────────────────────────────────

function nodeColor(n: HiveNode): string {
  const ramPct = (n.ram_used / n.ram_total) * 100;
  const load = Math.max(n.cpu, ramPct);
  if (load > 80) return "#ef4444";
  if (load > 60) return "#eab308";
  return "#22c55e";
}

function initials(s: string): string {
  return s.split("-").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
}

function useNodePositions(nodes: HiveNode[]) {
  return useMemo(() => {
    const W = 800, H = 320;
    const cx = W / 2, cy = H / 2;
    const pos: Record<string, { x: number; y: number }> = {};
    if (nodes.length === 0) return pos;

    const queen = nodes.find((n) => n.role === "queen");
    if (queen) pos[queen.id] = { x: cx, y: cy };

    const workers = nodes.filter((n) => n.role !== "queen");
    const r = workers.length <= 2 ? 150 : workers.length <= 4 ? 120 : 130;
    workers.forEach((n, i) => {
      const a = (i / workers.length) * Math.PI * 2 - Math.PI / 2;
      pos[n.id] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });

    if (!queen && workers.length > 0) pos[workers[0].id] = { x: cx, y: cy };
    return pos;
  }, [nodes]);
}

// ── NodeTooltip ───────────────────────────────────────────────────────────────

function NodeTooltip({ node, xPct, yPct }: { node: HiveNode; xPct: number; yPct: number }) {
  return (
    <div
      className="node-tooltip"
      style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%, -120%)" }}
    >
      <div className="mono" style={{ fontSize: 13, color: "var(--text)", marginBottom: 6 }}>
        {node.id}
      </div>
      <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {node.host} · {node.ip}
      </div>
      <div
        style={{
          marginTop: 8,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          fontSize: 11,
        }}
        className="mono"
      >
        <div>
          RAM{" "}
          <span style={{ color: "var(--text)" }}>
            {node.ram_used.toFixed(1)}/{node.ram_total}G
          </span>
        </div>
        <div>
          CPU <span style={{ color: "var(--text)" }}>{Math.round(node.cpu)}%</span>
        </div>
        <div>
          Disk{" "}
          <span style={{ color: "var(--text)" }}>
            {node.disk_used}/{node.disk_total}G
          </span>
        </div>
        <div>
          Deps <span style={{ color: "var(--text)" }}>{node.deployments}</span>
        </div>
      </div>
    </div>
  );
}

// ── NodeMap SVG ───────────────────────────────────────────────────────────────

function NodeMap({ nodes }: { nodes: HiveNode[] }) {
  const positions = useNodePositions(nodes);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const queen = nodes.find((n) => n.role === "queen");
  const workers = nodes.filter((n) => n.role !== "queen");

  return (
    <div className="node-map-wrap" style={{ minHeight: 340 }}>
      {/* Header */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div className="label-ups">WireGuard mesh</div>
        <div className="mono" style={{ display: "flex", gap: 16, fontSize: 11 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            healthy
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#eab308", display: "inline-block" }} />
            loaded
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
            critical
          </span>
        </div>
      </div>

      {/* SVG + tooltip */}
      <div style={{ position: "relative" }}>
        <svg
          className="node-map-svg"
          viewBox="0 0 800 320"
          preserveAspectRatio="xMidYMid meet"
          style={{ height: 300, width: "100%" }}
        >
          <defs>
            <radialGradient id="nodeGlow">
              <stop offset="0%" stopColor="rgba(249,115,22,0.3)" />
              <stop offset="100%" stopColor="rgba(249,115,22,0)" />
            </radialGradient>
          </defs>

          {/* Edges queen → workers */}
          {queen &&
            workers.map((w) => {
              const a = positions[queen.id];
              const b = positions[w.id];
              if (!a || !b) return null;
              return (
                <g key={w.id + "-edge"}>
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="var(--border-bright)"
                    strokeWidth="1"
                  />
                  {/* animated data packet */}
                  <circle r="2.5" fill="var(--accent)" opacity="0.9">
                    <animateMotion
                      dur="2.5s"
                      repeatCount="indefinite"
                      path={`M${a.x},${a.y} L${b.x},${b.y}`}
                    />
                  </circle>
                  {/* reverse packet */}
                  <circle r="2" fill="var(--accent)" opacity="0.5">
                    <animateMotion
                      dur="3.1s"
                      repeatCount="indefinite"
                      path={`M${b.x},${b.y} L${a.x},${a.y}`}
                    />
                  </circle>
                </g>
              );
            })}

          {/* Nodes */}
          {nodes.map((n) => {
            const p = positions[n.id];
            if (!p) return null;
            const c = nodeColor(n);
            const isQueen = n.role === "queen";
            const isFocused = focused === n.id;
            const baseR = isQueen ? 22 : 16;
            const glowR = isQueen ? 30 : 22;

            return (
              <g
                key={n.id}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setFocused((f) => (f === n.id ? null : n.id))}
                style={{ cursor: "pointer" }}
              >
                {/* glow halo */}
                <circle
                  cx={p.x} cy={p.y} r={glowR}
                  fill="url(#nodeGlow)"
                  opacity={isFocused ? 1 : 0.35}
                />
                {/* main circle with pulse animation */}
                <circle
                  cx={p.x} cy={p.y} r={baseR}
                  fill="var(--surface)"
                  stroke={c}
                  strokeWidth="2"
                >
                  <animate
                    attributeName="r"
                    values={`${baseR};${baseR + 3};${baseR}`}
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                </circle>

                {/* queen crown label */}
                {isQueen && (
                  <text
                    x={p.x} y={p.y - 30}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--accent)"
                    fontFamily="'Geist Mono', monospace"
                  >
                    ♛ queen
                  </text>
                )}

                {/* node id label */}
                <text
                  x={p.x} y={p.y + (isQueen ? 40 : 32)}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text)"
                  fontFamily="'Geist Mono', monospace"
                >
                  {initials(n.id)}
                </text>

                {/* cpu % inside node */}
                <text
                  x={p.x} y={p.y + 4}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--text-muted)"
                  fontFamily="'Geist Mono', monospace"
                >
                  {Math.round(n.cpu)}%
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hovered && positions[hovered] && (() => {
          const n = nodes.find((x) => x.id === hovered);
          if (!n) return null;
          const p = positions[hovered];
          return (
            <NodeTooltip
              node={n}
              xPct={(p.x / 800) * 100}
              yPct={(p.y / 320) * 100}
            />
          );
        })()}
      </div>
    </div>
  );
}

// ── NodeCard ──────────────────────────────────────────────────────────────────

function NodeCard({ node, focused, onFocus }: { node: HiveNode; focused: boolean; onFocus: () => void }) {
  const ramPct = (node.ram_used / node.ram_total) * 100;
  const diskPct = (node.disk_used / node.disk_total) * 100;

  return (
    <div
      className="card card-pad stack-y-3"
      style={{
        borderColor: focused ? "var(--accent)" : undefined,
        cursor: "pointer",
        transition: "border-color 200ms",
      }}
      onClick={onFocus}
    >
      <div className="flex-between">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {node.role === "queen" && <Crown size={14} color="var(--accent)" />}
          <span className="mono" style={{ color: "var(--text)", fontSize: 14 }}>
            {node.id}
          </span>
        </div>
        <span
          className={`status-dot ${node.online !== false ? "status-running" : "status-error"}`}
        >
          <span className="status-dot-circle" />
          {node.online !== false ? "online" : "offline"}
        </span>
      </div>

      <p className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {node.host} · {node.ip}
      </p>

      <div>
        <div className="flex-between" style={{ marginBottom: 5 }}>
          <span className="label-ups">RAM</span>
          <span className="mono" style={{ fontSize: 11 }}>
            {node.ram_used.toFixed(1)} / {node.ram_total} GB
          </span>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${ramPct}%` }} />
        </div>
      </div>

      <div>
        <div className="flex-between" style={{ marginBottom: 5 }}>
          <span className="label-ups">CPU</span>
          <span className="mono" style={{ fontSize: 11 }}>
            {Math.round(node.cpu)}%
          </span>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${node.cpu}%` }} />
        </div>
      </div>

      <div>
        <div className="flex-between" style={{ marginBottom: 5 }}>
          <span className="label-ups">Disk</span>
          <span className="mono" style={{ fontSize: 11 }}>
            {node.disk_used} / {node.disk_total} GB
          </span>
        </div>
        <div className="meter">
          <div className="meter-fill" style={{ width: `${diskPct}%` }} />
        </div>
      </div>

      <p className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {node.deployments} deployments · heartbeat {node.last}
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HivePage() {
  const [user, setUser] = useState<User | null>(null);
  const [nodes, setNodes] = useState<HiveNode[]>([]);
  const [liveNodes, setLiveNodes] = useState<HiveNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [joinCommand, setJoinCommand] = useState("");
  const [joinToken, setJoinToken] = useState("");
  const [focused, setFocused] = useState<string | null>(null);

  useEffect(() => {
    getMe().then(setUser).catch(() => {
      window.location.href = "/login";
    });
  }, []);

  async function loadHiveData() {
    setLoadingNodes(true);
    try {
      const [fetchedNodes, join] = await Promise.all([
        listHiveNodes(),
        getHiveJoinInfo().catch(() => null),
      ]);
      setNodes(fetchedNodes);
      setLiveNodes(fetchedNodes);
      setJoinCommand(join?.join_command || "");
      setJoinToken(join?.join_token || "");
    } catch {
      setNodes([]);
      setLiveNodes([]);
      setJoinCommand("");
      setJoinToken("");
    } finally {
      setLoadingNodes(false);
    }
  }

  useEffect(() => {
    loadHiveData();
  }, []);

  // Simulate live metric fluctuations (cpu/ram drift) between API polls
  useEffect(() => {
    if (nodes.length === 0) return;
    const id = setInterval(() => {
      setLiveNodes((prev) =>
        prev.map((n) => ({
          ...n,
          cpu: Math.max(2, Math.min(98, n.cpu + (Math.random() - 0.5) * 8)),
          ram_used: Math.max(
            0.1,
            Math.min(n.ram_total - 0.2, n.ram_used + (Math.random() - 0.5) * 0.25)
          ),
        }))
      );
    }, 2000);
    return () => clearInterval(id);
  }, [nodes]);

  const online = useMemo(() => liveNodes.length, [liveNodes]);

  if (!user) {
    return (
      <div className="page-shell" style={{ display: "grid", placeItems: "center" }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="page-shell">
      <Navbar user={user} />
      <div className="flex">
        <Sidebar user={user} />
        <main className="page stack-y-6 flex-1">
          {/* Header */}
          <div className="flex-between" style={{ flexWrap: "wrap" }}>
            <div>
              <div className="label-ups">Hive</div>
              <h2 style={{ marginTop: 6 }}>
                {liveNodes.length} {liveNodes.length === 1 ? "node" : "nodes"}
                <span
                  style={{
                    fontWeight: 400,
                    marginLeft: 10,
                    color: "var(--text-muted)",
                    fontSize: 18,
                  }}
                >
                  · {online} online
                </span>
              </h2>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={loadHiveData}
              >
                <RefreshCw size={12} /> Refresh
              </button>
              <button className="btn btn-primary btn-sm" type="button">
                <Plus size={12} /> Add node
              </button>
            </div>
          </div>

          {/* Node map */}
          {loadingNodes ? (
            <div className="card card-pad">Loading hive nodes...</div>
          ) : liveNodes.length === 0 ? (
            <div className="card card-pad">
              No hive nodes available yet. Connect the backend to populate this
              view.
            </div>
          ) : (
            <NodeMap nodes={liveNodes} />
          )}

          {/* Node cards grid */}
          {liveNodes.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
                gap: 14,
              }}
            >
              {liveNodes.map((n) => (
                <NodeCard
                  key={n.id}
                  node={n}
                  focused={focused === n.id}
                  onFocus={() => setFocused((f) => (f === n.id ? null : n.id))}
                />
              ))}
            </div>
          )}

          {/* Add a node */}
          <div className="card card-pad stack-y-3">
            <div>
              <h3>Add a node</h3>
              <p style={{ fontSize: 13, marginTop: 4 }}>
                Run this on any machine with Docker. It joins your Hive via
                WireGuard automatically.
              </p>
            </div>
            <pre className="terminal">
              $ {joinCommand || "No join command from backend yet."}
            </pre>
            <div className="flex-between" style={{ flexWrap: "wrap" }}>
              <p className="mono" style={{ fontSize: 12 }}>
                Join token:{" "}
                <span style={{ color: "var(--text)" }}>
                  {joinToken || "Pending backend"}
                </span>
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
