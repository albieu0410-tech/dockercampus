"use client";
import { useEffect, useState } from "react";
import { getContainers } from "@/lib/api";

type Container = {
  id: string;
  name?: string;
  status: string;
  rust_container_id?: string;
  docker_container_id?: string | null;
  owner_id?: string;
  user_id?: string;
  created_at: string;
};

export default function ContainersTab() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getContainers().then(setContainers).finally(() => setLoading(false));
  }, []);

  const statusColor: Record<string, string> = {
    running: "badge-active",
    stopped: "badge-inactive",
    created: "badge-unused",
    error: "badge-admin",
  };

  const stats = {
    total: containers.length,
    running: containers.filter((c) => c.status === "running").length,
    stopped: containers.filter((c) => c.status === "stopped").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold" style={{ fontFamily: "'Syne', sans-serif" }}>
          Containers
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          {stats.total} total · {stats.running} running · {stats.stopped} stopped
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total", value: stats.total, color: "text-zinc-100" },
          { label: "Running", value: stats.running, color: "text-green-400" },
          { label: "Stopped", value: stats.stopped, color: "text-zinc-500" },
        ].map((s) => (
          <div key={s.label} className="card rounded-lg px-5 py-4">
            <div className={`text-2xl font-bold ${s.color}`} style={{ fontFamily: "'Syne', sans-serif" }}>
              {s.value}
            </div>
            <div className="text-xs text-zinc-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <div className="w-4 h-4 border border-orange-500 border-t-transparent rounded-full animate-spin" />
          Loading containers...
        </div>
      ) : (
        <div className="card rounded-lg overflow-hidden glow">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Container ID</th>
                <th className="text-left px-4 py-3">Owner</th>
                <th className="text-left px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => {
                const containerId = c.rust_container_id ?? c.docker_container_id ?? "-";
                const owner = c.owner_id ?? c.user_id ?? "-";
                return (
                  <tr key={c.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors">
                    <td className="px-4 py-3 font-medium">{c.name ?? "Environment"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded ${statusColor[c.status] ?? "badge-inactive"}`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-zinc-500">
                        {containerId !== "-" ? `${containerId.slice(0, 12)}...` : "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs font-mono">
                      {owner !== "-" ? `${owner.slice(0, 8)}...` : "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {containers.length === 0 && <div className="text-center py-12 text-zinc-600 text-sm">No containers yet</div>}
        </div>
      )}
    </div>
  );
}
