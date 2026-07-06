"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMe,
  listContainers,
  createContainer,
  getGithubStatus,
  listRepos,
  createDeployment,
  listDeployments,
  apiUrl,
  type User,
  type Container,
  type Deployment,
  type Repo,
} from "@/lib/api";
import Navbar from "@/components/Navbar";
import ContainerCard from "@/components/ContainerCard";
import RepoInspector from "@/components/RepoInspector";
import DeploymentLogsModal from "@/components/DeploymentLogsModal";

type DashboardTab = "containers" | "deploy" | "deployments";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [githubConnected, setGithubConnected] = useState(false);

  const [tab, setTab] = useState<DashboardTab>("containers");
  const [creating, setCreating] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [customPort, setCustomPort] = useState("");
  const [actionError, setActionError] = useState("");
  const [viewingDeploymentId, setViewingDeploymentId] = useState<string | null>(null);

  async function load() {
    const [me, conts] = await Promise.all([getMe(), listContainers()]);
    setUser(me);
    setContainers(conts);

    try {
      const deps = await listDeployments();
      setDeployments(deps);
    } catch {
      setDeployments([]);
    }

    try {
      const github = await getGithubStatus();
      if (github) {
        setGithubConnected(true);
        const repoList = await listRepos();
        setRepos(repoList);
      } else {
        setGithubConnected(false);
        setRepos([]);
      }
    } catch {
      setGithubConnected(false);
      setRepos([]);
    }
  }

  useEffect(() => {
    load().catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") setTab("deploy");
  }, []);

  async function handleCreate() {
    setCreating(true);
    setActionError("");
    try {
      if (!user) return;
      await createContainer(user.id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not create environment");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();
    setDeploying(true);
    setActionError("");
    try {
      if (!hasContainer) {
        setActionError("Create an environment before deploying a repository.");
        return;
      }
      const url = selectedRepo || repoUrl;
      if (!url) return;
      await createDeployment({
        repo_url: url,
        custom_port: customPort ? parseInt(customPort, 10) : undefined,
      });
      setRepoUrl("");
      setSelectedRepo("");
      setCustomPort("");
      setTab("deployments");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setDeploying(false);
    }
  }

  async function retryDeployment(_deploymentId: string, retryRepoUrl: string, port?: number | null) {
    try {
      await createDeployment({ repo_url: retryRepoUrl, custom_port: port ?? undefined });
      await load();
    } catch (err) {
      console.error(err);
    }
  }

  const hasContainer = containers.length > 0;

  const sections = useMemo(
    () => [
      { label: "Dashboard", href: "/dashboard", icon: "⬡", active: true },
      { label: "Health", href: "/health", icon: "⬤" },
      { label: "Hive", href: "/hive", icon: "◈" },
      { label: "Routing", href: "/routing", icon: "◇" },
      { label: "Jobs", href: "/jobs", icon: "◆" },
      { label: "Sleep", href: "/sleep", icon: "◉" },
      { label: "WireGuard", href: "/wireguard", icon: "◎" },
      { label: "Settings", href: "/settings", icon: "◌" },
    ],
    []
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
        .tab-active { background: linear-gradient(135deg, #f97316, #ea580c); color: #fff; }
        .card { background: #18181b; border: 1px solid #27272a; }
      `}</style>

      <Navbar user={user} />

      <div className="flex">
        <aside className="hidden sm:flex w-52 min-h-[calc(100vh-57px)] border-r border-zinc-800 p-4 flex-col gap-1 shrink-0">
          {sections.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className={`w-full text-left px-4 py-3 rounded text-sm transition-all flex items-center gap-3 ${
                s.active ? "tab-active" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
              }`}
            >
              <span className="text-base">{s.icon}</span>
              {s.label}
            </a>
          ))}
        </aside>

        <main className="flex-1 min-w-0 p-4 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Welcome, {user.full_name}</h2>
              <p className="text-zinc-400 text-sm">Manage your environment and deployments</p>
            </div>
            {!hasContainer && (
              <button
                onClick={handleCreate}
                disabled={creating}
                className="bg-orange-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Environment"}
              </button>
            )}
          </div>

          {actionError && (
            <div className="rounded-md border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {actionError}
            </div>
          )}

          <div className="card rounded-xl p-1 flex gap-1 w-full sm:w-fit">
            {(["containers", "deploy", "deployments"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm rounded-md capitalize ${
                  tab === t ? "bg-orange-500 text-white" : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "containers" && (
            <div className="space-y-4">
              {containers.length === 0 ? (
                <div className="card rounded-xl p-8 text-center space-y-3">
                  <p className="font-medium">No environment yet</p>
                  <p className="text-zinc-400 text-sm">Create your development environment to get started</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {containers.map((c) => (
                    <ContainerCard key={c.id} container={c} onRefresh={load} />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "deploy" && (
            <div className="space-y-6">
              {!githubConnected ? (
                <div className="card rounded-xl p-6 space-y-4">
                  <div>
                    <h3 className="font-semibold">Connect GitHub</h3>
                    <p className="text-zinc-400 text-sm mt-1">Connect to deploy from your repositories</p>
                  </div>
                  <a
                    href={apiUrl(`/auth/github/login?token=${typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""}`)}
                    className="inline-block bg-orange-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-orange-600"
                  >
                    Connect GitHub
                  </a>
                </div>
              ) : (
                <div className="card rounded-xl p-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <p className="text-sm text-zinc-300">GitHub connected</p>
                </div>
              )}

              <div className="card rounded-xl p-6 space-y-4">
                <h3 className="font-semibold">Step 1 - Select Dockerfile</h3>
                <RepoInspector
                  onSelectDockerfile={(_dockerfilePath, selectedRepoUrl) => {
                    setRepoUrl(selectedRepoUrl);
                    setSelectedRepo("");
                  }}
                />
              </div>

              <div className="card rounded-xl p-6">
                <form onSubmit={handleDeploy} className="space-y-4">
                  {githubConnected && repos.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Choose repository</label>
                      <select
                        value={selectedRepo}
                        onChange={(e) => {
                          setSelectedRepo(e.target.value);
                          setRepoUrl("");
                        }}
                        className="w-full border border-zinc-700 bg-zinc-900 rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">-- Select repo --</option>
                        {repos.map((r) => (
                          <option key={r.full_name} value={r.url}>
                            {r.full_name} {r.private ? "🔒" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-sm font-medium">Repository URL</label>
                    <input
                      value={repoUrl}
                      onChange={(e) => {
                        setRepoUrl(e.target.value);
                        setSelectedRepo("");
                      }}
                      placeholder="https://github.com/username/repo"
                      className="w-full border border-zinc-700 bg-zinc-900 rounded-md px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium">Custom port (optional)</label>
                    <input
                      value={customPort}
                      onChange={(e) => setCustomPort(e.target.value)}
                      type="number"
                      placeholder="3000"
                      className="w-full border border-zinc-700 bg-zinc-900 rounded-md px-3 py-2 text-sm"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={deploying || !hasContainer}
                    className="bg-orange-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
                  >
                    {deploying ? "Deploying..." : "Deploy"}
                  </button>
                  {!hasContainer && (
                    <p className="text-sm text-amber-300">
                      Create an environment from the Containers tab before deploying.
                    </p>
                  )}
                </form>
              </div>
            </div>
          )}

          {tab === "deployments" && (
            <div className="space-y-3">
              {deployments.length === 0 ? (
                <div className="card rounded-xl p-8 text-center text-zinc-400 text-sm">No deployments yet</div>
              ) : (
                deployments.map((d) => (
                  <div
                    key={d.id}
                    className="card rounded-xl p-4 sm:p-5 cursor-pointer hover:border-zinc-700"
                    onClick={() => setViewingDeploymentId(d.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{d.repo_url}</p>
                        <p className="text-xs text-zinc-400 mt-1">Created: {new Date(d.created_at).toLocaleString()}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        d.status === "running"
                          ? "bg-green-900/50 text-green-300"
                          : d.status === "failed"
                            ? "bg-red-900/50 text-red-300"
                            : "bg-zinc-800 text-zinc-300"
                      }`}>
                        {d.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewingDeploymentId(d.id);
                        }}
                        className="text-orange-400 text-sm hover:underline"
                      >
                        View logs
                      </button>

                      {d.public_url && (
                        <a
                          href={d.public_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-orange-400 text-sm hover:underline"
                        >
                          Open deployment
                        </a>
                      )}
                    </div>

                    {d.status === "failed" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          retryDeployment(d.id, d.repo_url, d.custom_port ?? d.detected_port);
                        }}
                        className="mt-3 text-xs bg-zinc-800 text-zinc-100 px-3 py-1.5 rounded-md hover:bg-zinc-700"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </main>
      </div>

      {viewingDeploymentId && (
        <DeploymentLogsModal
          deploymentId={viewingDeploymentId}
          initial={deployments.find((d) => d.id === viewingDeploymentId)}
          onClose={() => setViewingDeploymentId(null)}
        />
      )}
    </div>
  );
}
