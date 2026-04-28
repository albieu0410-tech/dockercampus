"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMe, getWireGuardStatus, listWireGuardPeers,
  type User, type WireGuardPeer, type WireGuardStatus,
} from "@/lib/api";

export default function WireGuardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<WireGuardStatus | null>(null);
  const [peers, setPeers] = useState<WireGuardPeer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getMe().then(setUser).catch(() => router.push("/login"));
  }, [router]);

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

  useEffect(() => { loadData(); }, []);

  const activePeers = useMemo(() => peers.filter((p) => p.is_active).length, [peers]);

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
            DockCampus <span className="text-orange-500">WireGuard</span>
          </div>
        </div>
        <button onClick={loadData} disabled={loading} className="text-xs px-3 py-1.5 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors disabled:opacity-40">
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">WireGuard</div>
          <h2 style={{ fontFamily: "'Syne', sans-serif" }} className="text-2xl font-bold">Mesh status</h2>
          <p className="text-sm text-zinc-500 mt-1">{activePeers}/{peers.length} peers active</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <h3 style={{ fontFamily: "'Syne', sans-serif" }} className="font-semibold">Control plane</h3>
          {!status ? (
            <p className="text-zinc-500 text-sm">{loading ? "Loading..." : "No WireGuard status available from backend."}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${status.enabled ? "bg-green-500 animate-pulse" : "bg-zinc-600"}`} />
                <span className="text-sm">{status.enabled ? "Enabled" : "Disabled"}</span>
                <span className="text-xs text-zinc-500 ml-2">
                  · keys {status.has_private_key && status.has_public_key ? "configured" : "missing"}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                {[
                  { label: "Interface", value: status.interface },
                  { label: "Port", value: `:${status.listen_port}` },
                  { label: "Network", value: status.network_cidr },
                ].map((item) => (
                  <div key={item.label} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                    <div className="text-xs text-zinc-500 mb-1">{item.label}</div>
                    <div className="font-mono text-sm text-zinc-200">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
            <h3 style={{ fontFamily: "'Syne', sans-serif" }} className="text-sm font-semibold">Peers</h3>
            <span className="font-mono text-xs text-zinc-500">{peers.length} total · {activePeers} active</span>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-zinc-500 text-sm">
              <div className="w-4 h-4 border border-orange-500 border-t-transparent rounded-full animate-spin" />
              Loading peers...
            </div>
          ) : peers.length === 0 ? (
            <div className="p-8 text-center text-zinc-600 text-sm">No peers registered.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
              {peers.map((peer) => (
                <div key={peer.id} className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-zinc-100">{peer.node_id}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${peer.is_active ? "bg-green-500 animate-pulse" : "bg-zinc-600"}`} />
                      <span className="text-xs text-zinc-400">{peer.is_active ? "active" : "inactive"}</span>
                    </div>
                  </div>
                  <p className="font-mono text-xs text-zinc-500">Allowed: {peer.allowed_ips}</p>
                  <p className="font-mono text-xs text-zinc-500">Endpoint: {peer.endpoint || "(none)"}</p>
                  <p className="font-mono text-xs text-zinc-600">
                    Handshake: {peer.last_handshake ? new Date(peer.last_handshake).toLocaleString() : "never"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
