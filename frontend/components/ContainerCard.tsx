"use client";
import { APP_URL, containerAction, deleteContainer, wakeContainer, type Container } from "@/lib/api";
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
      await containerAction(container.user_id, action);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function doWake() {
    setLoading(true);
    try {
      await wakeContainer(container.user_id);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function doDelete() {
    if (!confirm("Delete this container?")) return;
    setLoading(true);
    try {
      await deleteContainer(container.user_id);
      onRefresh();
    } finally {
      setLoading(false);
    }
  }

  const isRunning = container.status === "running";
  const isSleeping = container.status === "sleeping";
  const editorUrl = container.editor_url || `${APP_URL}/app/${container.user_id}/`;

  return (
    <div className="bg-card border rounded-xl p-5 space-y-3 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">My Environment</p>
          <p className="text-xs text-muted-foreground">Port {container.port}</p>
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

      {isRunning && (
        <a
          href={editorUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center text-xs bg-primary text-primary-foreground px-3 py-2 rounded-md hover:opacity-90 font-medium"
        >
          Open Editor
        </a>
      )}

      <div className="flex gap-2 flex-wrap">
        {isSleeping && (
          <button
            onClick={doWake}
            disabled={loading}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
          >
            Wake
          </button>
        )}
        {!isRunning && !isSleeping && (
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
