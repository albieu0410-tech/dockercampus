"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMe, listStudents, listContainers, createContainer,
  containerAction, deleteContainer, createDeployment, listDeployments,
  type User, type Container, type Deployment
} from "@/lib/api";
import Navbar from "@/components/Navbar";
import RepoInspector from "@/components/RepoInspector";

type Tab = "overview" | "containers" | "deployments";

export default function ProfessorPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [students, setStudents] = useState<User[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [repoUrl, setRepoUrl] = useState("");
  const [customPort, setCustomPort] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function load() {
    try {
      const [me, studs, conts, deps] = await Promise.all([
        getMe(),
        listStudents(),
        listContainers(),
        listDeployments(),
      ]);
      if (me.role !== "professor" && me.role !== "admin") {
        router.push("/dashboard");
        return;
      }
      setUser(me);
      setStudents(studs);
      setContainers(conts);
      setDeployments(deps);
    } catch {
      router.push("/login");
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();
    setDeploying(true);
    setDeployError("");
    try {
      await createDeployment({
        repo_url: repoUrl,
        custom_port: customPort ? parseInt(customPort) : undefined,
      });
      setRepoUrl("");
      setCustomPort("");
      setTab("deployments");
      await load();
    } catch (err: any) {
      setDeployError(err.message);
    } finally {
      setDeploying(false);
    }
  }

  async function handleContainerAction(id: string, action: "start" | "stop" | "restart") {
    setActionLoading(id + action);
    try {
      await containerAction(id, action);
      await load();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeleteContainer(id: string) {
    if (!confirm("Delete this container?")) return;
    setActionLoading(id + "delete");
    try {
      await deleteContainer(id);
      await load();
    } finally {
      setActionLoading(null);
    }
  }

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "containers", label: `Containers (${containers.length})` },
    { key: "deployments", label: `Deployments (${deployments.length})` },
  ];

  return (
    <div className="min-h-screen bg-muted">
      <Navbar user={user} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Professor Dashboard</h2>
            <p className="text-muted-foreground text-sm">Manage students, containers and deployments</p>
          </div>
          <button
            onClick={() => setTab("deployments")}
            className="self-start sm:self-auto bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
          >
            + New deployment
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Students", value: students.length },
            { label: "Containers", value: containers.length },
            { label: "Running", value: containers.filter((c) => c.status === "running").length },
            { label: "Deployments", value: deployments.length },
          ].map((stat) => (
            <div key={stat.label} className="bg-card border rounded-xl p-4">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-2xl sm:text-3xl font-bold mt-1">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === "overview" && (
          <div className="bg-card border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h3 className="font-semibold">Students</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3">Name</th>
                    <th className="text-left px-5 py-3">Email</th>
                    <th className="text-left px-5 py-3">Containers</th>
                    <th className="text-left px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground text-sm">
                        No students yet
                      </td>
                    </tr>
                  ) : students.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/50">
                      <td className="px-5 py-3 font-medium">{s.full_name}</td>
                      <td className="px-5 py-3 text-muted-foreground">{s.email}</td>
                      <td className="px-5 py-3">
                        {containers.filter((c) => c.owner_id === s.id || c.user_id === s.id).length}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          s.is_active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                        }`}>
                          {s.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Containers tab */}
        {tab === "containers" && (
          <div className="space-y-4">
            {containers.length === 0 ? (
              <div className="bg-card border rounded-xl p-8 text-center text-muted-foreground text-sm">
                No containers yet
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {containers.map((c) => (
                  <div key={c.id} className="bg-card border rounded-xl p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{c.name || "Container"}</p>
                        <p className="text-xs text-muted-foreground">Port {c.port}</p>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
                        c.status === "running" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                      }`}>
                        {c.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {c.status !== "running" && (
                        <button
                          onClick={() => handleContainerAction(c.id, "start")}
                          disabled={!!actionLoading}
                          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
                        >
                          {actionLoading === c.id + "start" ? "..." : "Start"}
                        </button>
                      )}
                      {c.status === "running" && (
                        <>
                          <button
                            onClick={() => handleContainerAction(c.id, "stop")}
                            disabled={!!actionLoading}
                            className="text-xs bg-muted text-foreground px-3 py-1.5 rounded-md hover:opacity-80 disabled:opacity-50"
                          >
                            {actionLoading === c.id + "stop" ? "..." : "Stop"}
                          </button>
                          <button
                            onClick={() => handleContainerAction(c.id, "restart")}
                            disabled={!!actionLoading}
                            className="text-xs bg-muted text-foreground px-3 py-1.5 rounded-md hover:opacity-80 disabled:opacity-50"
                          >
                            {actionLoading === c.id + "restart" ? "..." : "Restart"}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDeleteContainer(c.id)}
                        disabled={!!actionLoading}
                        className="text-xs bg-destructive text-destructive-foreground px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
                      >
                        {actionLoading === c.id + "delete" ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Deployments tab */}
        {tab === "deployments" && (
          <div className="space-y-6">
            {/* Deploy form */}
            <div className="bg-card border rounded-xl p-6 space-y-4">
              <h3 className="font-semibold">Deploy a repository</h3>
              <form onSubmit={handleDeploy} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-sm font-medium">Browse repository</label>
                    <RepoInspector
                      onSelectDockerfile={(_dockerfilePath, selectedRepoUrl) => {
                        setRepoUrl(selectedRepoUrl);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Port <span className="text-muted-foreground">(optional)</span></label>
                    <input
                      type="number"
                      value={customPort}
                      onChange={(e) => setCustomPort(e.target.value)}
                      placeholder="3000"
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                {deployError && <p className="text-destructive text-sm">{deployError}</p>}
                <button
                  type="submit"
                  disabled={deploying}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {deploying ? "Deploying..." : "Deploy"}
                </button>
              </form>
            </div>

            {/* Deployments list */}
            <div className="space-y-3">
              {deployments.length === 0 ? (
                <div className="bg-card border rounded-xl p-8 text-center text-muted-foreground text-sm">
                  No deployments yet
                </div>
              ) : deployments.map((d) => (
                <div key={d.id} className="bg-card border rounded-xl p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{d.repo_url}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Port: {d.custom_port || d.detected_port || "auto"}
                      </p>
                    </div>
                    <span className={`self-start text-xs px-2 py-1 rounded-full font-medium ${
                      d.status === "running" ? "bg-green-100 text-green-700" :
                      d.status === "failed" ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {d.status}
                    </span>
                  </div>
                  {d.public_url && (
                    <a
                      href={d.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs text-primary hover:underline truncate"
                    >
                      {d.public_url}
                    </a>
                  )}
                  {d.build_logs && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View build logs
                      </summary>
                      <pre className="mt-2 bg-muted rounded p-3 overflow-x-auto text-xs whitespace-pre-wrap max-h-48">
                        {d.build_logs}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
