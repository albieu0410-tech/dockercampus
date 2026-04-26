"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Crown } from "lucide-react";
import Navbar from "@/components/Navbar";
import { getHiveJoinInfo, getMe, listHiveNodes, type HiveNode, type User } from "@/lib/api";

type HiveNodeView = HiveNode;

export default function HivePage() {
  const [user, setUser] = useState<User | null>(null);
  const [nodes, setNodes] = useState<HiveNodeView[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [joinCommand, setJoinCommand] = useState("");
  const [joinToken, setJoinToken] = useState("");

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
      setJoinCommand(join?.join_command || "");
      setJoinToken(join?.join_token || "");
    } catch {
      setNodes([]);
      setJoinCommand("");
      setJoinToken("");
    } finally {
      setLoadingNodes(false);
    }
  }

  useEffect(() => {
    loadHiveData();
  }, []);

  const online = useMemo(() => nodes.length, [nodes]);

  if (!user) {
    return <div className="page-shell" style={{ display: "grid", placeItems: "center" }}>Loading...</div>;
  }

  return (
    <div className="page-shell">
      <Navbar user={user} />
      <main className="page stack-y-6">
        <div className="flex-between" style={{ flexWrap: "wrap" }}>
          <div>
            <div className="label-ups">Hive</div>
            <h2 style={{ marginTop: 6 }}>{nodes.length} nodes</h2>
            <p>{online} online in WireGuard mesh</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary btn-sm" type="button" onClick={loadHiveData}><RefreshCw size={12} /> Refresh</button>
            <button className="btn btn-primary btn-sm" type="button"><Plus size={12} /> Add node</button>
          </div>
        </div>

        {loadingNodes ? (
          <div className="card card-pad">Loading hive nodes...</div>
        ) : nodes.length === 0 ? (
          <div className="card card-pad">No hive nodes available yet. Connect the new backend to populate this view.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
          {nodes.map((n) => {
            const ramPct = (n.ram_used / n.ram_total) * 100;
            const cpuPct = n.cpu;
            const diskPct = (n.disk_used / n.disk_total) * 100;
            return (
              <div key={n.id} className="card card-pad stack-y-3">
                <div className="flex-between">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {n.role === "queen" && <Crown size={14} color="var(--accent)" />}
                    <span className="mono" style={{ color: "var(--text)" }}>{n.id}</span>
                  </div>
                  <span className="status-dot status-running"><span className="status-dot-circle" />online</span>
                </div>
                <p className="mono" style={{ fontSize: 11 }}>{n.host} · {n.ip}</p>

                <div>
                  <div className="flex-between" style={{ marginBottom: 6 }}><span className="label-ups">RAM</span><span className="mono" style={{ fontSize: 11 }}>{n.ram_used.toFixed(1)}/{n.ram_total} GB</span></div>
                  <div className="meter"><div className="meter-fill" style={{ width: `${ramPct}%` }} /></div>
                </div>
                <div>
                  <div className="flex-between" style={{ marginBottom: 6 }}><span className="label-ups">CPU</span><span className="mono" style={{ fontSize: 11 }}>{Math.round(cpuPct)}%</span></div>
                  <div className="meter"><div className="meter-fill" style={{ width: `${cpuPct}%` }} /></div>
                </div>
                <div>
                  <div className="flex-between" style={{ marginBottom: 6 }}><span className="label-ups">Disk</span><span className="mono" style={{ fontSize: 11 }}>{n.disk_used}/{n.disk_total} GB</span></div>
                  <div className="meter"><div className="meter-fill" style={{ width: `${diskPct}%` }} /></div>
                </div>

                <p className="mono" style={{ fontSize: 11 }}>{n.deployments} deployments · heartbeat {n.last}</p>
              </div>
            );
          })}
          </div>
        )}

        <div className="card card-pad stack-y-3">
          <h3>Add a node</h3>
          <pre className="terminal">$ {joinCommand || "No join command from backend yet."}</pre>
          <div className="flex-between" style={{ flexWrap: "wrap" }}>
            <p className="mono" style={{ fontSize: 12 }}>Join token: {joinToken || "Pending backend"}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
