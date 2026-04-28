"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getMe, listContainers, containerAction, deleteContainer, type User, type Container } from "@/lib/api";
import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";

export default function ContainerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [container, setContainer] = useState<Container | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const [me, conts] = await Promise.all([getMe(), listContainers()]);
    setUser(me);
    setContainer(conts.find((c) => c.container_id === id) ?? null);
  }

  useEffect(() => { load(); }, [id]);

  async function doAction(action: "start" | "stop" | "restart") {
    setLoading(true);
    try {
      await containerAction(id, action);
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function doDelete() {
    if (!confirm("Delete this container?")) return;
    await deleteContainer(id);
    router.push("/dashboard");
  }

  if (!user || !container) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  const isRunning = container.status === "running";

  return (
    <div className="min-h-screen bg-zinc-950">
      <Navbar user={user} />
      <div className="flex">
        <Sidebar user={user} />
        <main className="flex-1 max-w-3xl px-6 py-8 space-y-6">
        <button onClick={() => router.back()} className="text-sm text-muted-foreground hover:underline">← Back</button>

        <div className="bg-card border rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">{container.name}</h2>
              <p className="text-sm text-muted-foreground">{container.image}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${isRunning ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
              {container.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Container ID</p>
              <p className="font-mono text-xs mt-1 break-all">{container.container_id}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Created</p>
              <p className="mt-1">{new Date(container.created_at).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap pt-2">
            {!isRunning && (
              <button onClick={() => doAction("start")} disabled={loading} className="text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50">Start</button>
            )}
            {isRunning && (
              <>
                <button onClick={() => doAction("stop")} disabled={loading} className="text-sm bg-muted text-foreground px-4 py-2 rounded-md hover:opacity-80 disabled:opacity-50">Stop</button>
                <button onClick={() => doAction("restart")} disabled={loading} className="text-sm bg-muted text-foreground px-4 py-2 rounded-md hover:opacity-80 disabled:opacity-50">Restart</button>
              </>
            )}
            <button onClick={doDelete} className="text-sm bg-destructive text-destructive-foreground px-4 py-2 rounded-md hover:opacity-90">Delete</button>
          </div>
        </div>
        </main>
      </div>
    </div>
  );
}
