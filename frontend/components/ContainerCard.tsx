"use client";

import { useMemo, useState } from "react";
import { Play, RotateCcw, Square, Trash2, ExternalLink } from "lucide-react";
import { containerAction, deleteContainer, type Container } from "@/lib/api";

export default function ContainerCard({
  container,
  onRefresh,
}: {
  container: Container;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function doAction(action: "start" | "stop" | "restart") {
    setLoading(true);
    try {
      await containerAction(container.id, action);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function doDelete() {
    if (!confirm("Delete this container?")) return;
    setLoading(true);
    try {
      await deleteContainer(container.id);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  const isRunning = container.status === "running";
  const editorUrl = container.editor_url || `https://dockcampus.sudelca.com/app/${container.user_id}/`;
  const statusClass = isRunning ? "status-running" : "status-sleeping";

  const cpu = useMemo(() => Math.max(5, Math.min(96, Math.round(container.cpu_limit || 20))), [container.cpu_limit]);
  const ram = useMemo(() => Math.max(10, Math.min(95, Math.round(((container.memory_limit_mb || 256) / 1024) * 100))), [container.memory_limit_mb]);

  return (
    <div className="card card-pad stack-y-4">
      <div className="flex-between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className={`status-dot ${statusClass}`}>
            <span className="status-dot-circle" />
            {container.status}
          </div>
          <h3 style={{ marginTop: 10 }}>My environment</h3>
          <p className="mono" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {container.id} · :{container.port}
          </p>
        </div>
      </div>

      <div className="stack-y-3">
        <div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="label-ups">CPU</span>
            <span className="mono" style={{ fontSize: 12 }}>{cpu}%</span>
          </div>
          <div className="meter"><div className="meter-fill" style={{ width: `${cpu}%` }} /></div>
        </div>
        <div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="label-ups">RAM</span>
            <span className="mono" style={{ fontSize: 12 }}>{container.memory_limit_mb}MB</span>
          </div>
          <div className="meter"><div className="meter-fill" style={{ width: `${ram}%` }} /></div>
        </div>
      </div>

      <div className="stack-y-2">
        {isRunning && (
          <a href={editorUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ width: "100%" }}>
            <ExternalLink size={14} />
            Open editor
          </a>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isRunning && (
            <button onClick={() => doAction("start")} disabled={loading} className="btn btn-secondary btn-sm" type="button">
              <Play size={13} /> Start
            </button>
          )}
          {isRunning && (
            <>
              <button onClick={() => doAction("stop")} disabled={loading} className="btn btn-secondary btn-sm" type="button">
                <Square size={13} /> Stop
              </button>
              <button onClick={() => doAction("restart")} disabled={loading} className="btn btn-secondary btn-sm" type="button">
                <RotateCcw size={13} /> Restart
              </button>
            </>
          )}
          <button onClick={doDelete} disabled={loading} className="btn btn-danger btn-sm" type="button">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
