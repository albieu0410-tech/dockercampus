"use client";
import { useEffect, useRef, useState } from "react";
import { getDeployment, isDeploymentInProgress, type Deployment } from "@/lib/api";

const POLL_INTERVAL_MS = 2000;

const STATUS_STYLES: Record<string, string> = {
  running: "bg-green-900/50 text-green-300",
  failed: "bg-red-900/50 text-red-300",
  cancelled: "bg-zinc-700 text-zinc-300",
};

export default function DeploymentLogsModal({
  deploymentId,
  initial,
  onClose,
}: {
  deploymentId: string;
  initial?: Deployment;
  onClose: () => void;
}) {
  const [deployment, setDeployment] = useState<Deployment | null>(initial ?? null);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const dep = await getDeployment(deploymentId);
        if (cancelled) return;
        setDeployment(dep);
        setError("");
        if (isDeploymentInProgress(dep.status)) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load deployment");
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deploymentId]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [deployment?.build_logs]);

  const inProgress = deployment ? isDeploymentInProgress(deployment.status) : false;
  const statusClass = deployment ? STATUS_STYLES[deployment.status] ?? "bg-yellow-900/50 text-yellow-300" : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-zinc-800">
          <div className="min-w-0">
            <p className="font-semibold truncate">{deployment?.repo_url ?? "Deployment"}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Deployment logs</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {deployment && (
              <span className={`text-xs px-2 py-1 rounded-full font-medium capitalize ${statusClass}`}>
                {deployment.status}
              </span>
            )}
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-100 text-sm px-2 py-1"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-5 overflow-hidden flex-1 flex flex-col gap-3">
          {error && (
            <div className="rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {inProgress && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <div className="w-3 h-3 border border-orange-500 border-t-transparent rounded-full animate-spin" />
              Live — refreshing every {POLL_INTERVAL_MS / 1000}s
            </div>
          )}

          <pre
            ref={logRef}
            className="flex-1 overflow-auto bg-black/60 border border-zinc-800 rounded-md p-4 text-xs font-mono whitespace-pre-wrap text-zinc-300"
          >
            {deployment?.build_logs || "Waiting for logs..."}
          </pre>

          {deployment?.public_url && (
            <a
              href={deployment.public_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 text-sm hover:underline"
            >
              Open deployment →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
