"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";
import {
  getMe,
  getWireGuardStatus,
  listWireGuardPeers,
  type User,
  type WireGuardPeer,
  type WireGuardStatus,
} from "@/lib/api";

export default function WireGuardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<WireGuardStatus | null>(null);
  const [peers, setPeers] = useState<WireGuardPeer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getMe().then(setUser).catch(() => {
      window.location.href = "/login";
    });
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [wgStatus, wgPeers] = await Promise.all([getWireGuardStatus(), listWireGuardPeers()]);
      setStatus(wgStatus);
      setPeers(wgPeers);
    } catch {
      setStatus(null);
      setPeers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const activePeers = useMemo(() => peers.filter((p) => p.is_active).length, [peers]);

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
            <div className="label-ups">WireGuard</div>
            <h2 style={{ marginTop: 6 }}>Mesh status</h2>
            <p>{activePeers}/{peers.length} peers active</p>
          </div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={loadData}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        <div className="card card-pad stack-y-3">
          <h3>Control plane</h3>
          {status ? (
            <>
              <p>Interface: <span className="mono">{status.interface}</span> on <span className="mono">:{status.listen_port}</span></p>
              <p>Network: <span className="mono">{status.network_cidr}</span></p>
              <p>
                Status: {status.enabled ? "enabled" : "disabled"} · keys {status.has_private_key && status.has_public_key ? "configured" : "missing"}
              </p>
            </>
          ) : (
            <p>No WireGuard status available from backend yet.</p>
          )}
        </div>

        <div className="card card-pad stack-y-3">
          <h3>Peers</h3>
          {loading ? (
            <p>Loading peer list...</p>
          ) : peers.length === 0 ? (
            <p>No peers registered.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
              {peers.map((peer) => (
                <div key={peer.id} className="card" style={{ padding: 12 }}>
                  <div className="flex-between">
                    <p className="mono" style={{ color: "var(--text)", fontSize: 12 }}>{peer.node_id}</p>
                    <span className={`status-dot ${peer.is_active ? "status-ok" : "status-error"}`}>
                      <span className="status-dot-circle" />
                      {peer.is_active ? "active" : "inactive"}
                    </span>
                  </div>
                  <p className="mono" style={{ fontSize: 11, marginTop: 8 }}>Allowed: {peer.allowed_ips}</p>
                  <p className="mono" style={{ fontSize: 11 }}>Endpoint: {peer.endpoint || "(none)"}</p>
                  <p className="mono" style={{ fontSize: 11 }}>
                    Handshake: {peer.last_handshake ? new Date(peer.last_handshake).toLocaleString() : "never"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        </main>
      </div>
    </div>
  );
}
