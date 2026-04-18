"use client";
import { containerAction, deleteContainer, type Container } from "@/lib/api";
import { useState } from "react";

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
      await containerAction(container.container_id, action);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function doDelete() {
    if (!confirm("Delete this container?")) return;
    setLoading(true);
    try {
      await deleteContainer(container.container_id);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  const isRunning = container.status === "running";

  return (
    <div className="bg-card border rounded-xl p-5 space-y-3 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">{container.name}</p>
          <p className="text-xs text-muted-foreground">{container.image}</p>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-full font-medium ${
            isRunning
              ? "bg-green-100 text-green-700"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {container.status}
        </span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {!isRunning && (
          <button
            onClick={() => doAction("start")}
            disabled={loading}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
          >
            Start
          </button>
        )}
        {isRunning && (
          <>
            <button
              onClick={() => doAction("stop")}
              disabled={loading}
              className="text-xs bg-muted text-foreground px-3 py-1.5 rounded-md hover:opacity-80 disabled:opacity-50"
            >
              Stop
            </button>
            <button
              onClick={() => doAction("restart")}
              disabled={loading}
              className="text-xs bg-muted text-foreground px-3 py-1.5 rounded-md hover:opacity-80 disabled:opacity-50"
            >
              Restart
            </button>
          </>
        )}
        <button
          onClick={doDelete}
          disabled={loading}
          className="text-xs bg-destructive text-destructive-foreground px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
