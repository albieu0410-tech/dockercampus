"use client";
import { useEffect, useState } from "react";
import { getMe, listContainers, createContainer, type User, type Container } from "@/lib/api";
import Navbar from "@/components/Navbar";
import ContainerCard from "@/components/ContainerCard";

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [newName, setNewName] = useState("");
  const [newImage, setNewImage] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const [me, conts] = await Promise.all([getMe(), listContainers()]);
    setUser(me);
    setContainers(conts);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await createContainer({ name: newName, image: newImage });
      setNewName("");
      setNewImage("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  if (!user) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-muted">
      <Navbar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h2 className="text-xl font-bold">My Containers</h2>
          <p className="text-muted-foreground text-sm">Manage your development environments</p>
        </div>

        <form onSubmit={handleCreate} className="bg-card border rounded-xl p-5 flex gap-3 flex-wrap items-end">
          <div className="space-y-1 flex-1 min-w-[160px]">
            <label className="text-sm font-medium">Container name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="my-app"
              required
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[160px]">
            <label className="text-sm font-medium">Image</label>
            <input
              value={newImage}
              onChange={(e) => setNewImage(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="python:3.12-slim"
              required
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </form>

        {containers.length === 0 ? (
          <p className="text-muted-foreground text-sm">No containers yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {containers.map((c) => (
              <ContainerCard key={c.id} container={c} onRefresh={load} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
