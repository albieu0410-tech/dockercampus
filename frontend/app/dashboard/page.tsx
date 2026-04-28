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
  type User,
  type Container,
  type Deployment,
  type Repo,
} from "@/lib/api";
import ContainerCard from "@/components/ContainerCard";
import RepoInspector from "@/components/RepoInspector";

type DashboardTab = "containers" | "deploy" | "deployments";

function HealthBadge() {
  const [status, setStatus] = useState<"ok" | "degraded" | "error" | "loading">("loading");

  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const resp = await fetch("https://api.sudelca.com/health");
        const data = await resp.json();
        if (!alive) return;
        setStatus(data.status === "ok" ? "ok" : "degraded");
      } catch {
        if (!alive) return;
        setStatus("error");
      }
    }
    check();
    const id = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const config = {
    ok: { dot: "bg-green-500 animate-pulse", text: "text-green-400", label: "Healthy" },
    degraded: { dot: "bg-yellow-500 animate-pulse", text: "text-yellow-400", label: "Degraded" },
    error: { dot: "bg-red-500", text: "text-red-400", label: "Down" },
    loading: { dot: "bg-zinc-600", text: "text-zinc-500", label: "Checking" },
  }[status];

  return (
    <a
      href="/health"
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-zinc-800 hover:border-zinc-600 transition-colors"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${config.dot}`} />
      <span className={`text-xs font-medium ${config.text}`}>{config.label}</span>
    </a>
  );
}

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
    try {
      await createContainer({ name: "environment", image: "dockcampus-student" });
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();
    setDeploying(true);
    try {
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

      <div className="border-b border-zinc-800 px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center text-white font-bold text-sm shrink-0">D</div>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif" }} className="text-base sm:text-lg font-800 tracking-tight">
              DockCampus <span className="text-orange-500">Student</span>
            </div>
            <div className="text-xs text-zinc-500 hidden sm:block">Workspace</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <HealthBadge />
          <button
            onClick={() => {
              document.cookie = "token=; Max-Age=0";
              localStorage.removeItem("token");
              router.push("/login");
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-3 py-1.5 border border-zinc-800 rounded hover:border-zinc-600"
          >
            Sign out
          </button>
        </div>
      </div>

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
                    href={`https://api.sudelca.com/auth/github/login?token=${typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""}`}
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
                    disabled={deploying}
                    className="bg-orange-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
                  >
                    {deploying ? "Deploying..." : "Deploy"}
                  </button>
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
                  <div key={d.id} className="card rounded-xl p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{d.repo_url}</p>
                        <p className="text-xs text-zinc-400 mt-1">Created: {new Date(d.created_at).toLocaleString()}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        d.status === "success"
                          ? "bg-green-900/50 text-green-300"
                          : d.status === "failed"
                            ? "bg-red-900/50 text-red-300"
                            : "bg-zinc-800 text-zinc-300"
                      }`}>
                        {d.status}
                      </span>
                    </div>

                    {d.public_url && (
                      <a
                        href={d.public_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-orange-400 text-sm hover:underline mt-2 inline-block"
                      >
                        Open deployment
                      </a>
                    )}

                    {d.status === "failed" && (
                      <button
                        onClick={() => retryDeployment(d.id, d.repo_url, d.custom_port ?? d.detected_port)}
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
    </div>
  );
}
