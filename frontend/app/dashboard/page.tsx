"use client";
import { useEffect, useState } from "react";
import {
  getMe, listContainers, createContainer,
  getGithubStatus, listRepos, createDeployment, listDeployments,
  type User, type Container, type Deployment, type Repo
} from "@/lib/api";
import Navbar from "@/components/Navbar";
import ContainerCard from "@/components/ContainerCard";

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [creating, setCreating] = useState(false);
  const [githubConnected, setGithubConnected] = useState(false);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [customPort, setCustomPort] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [activeTab, setActiveTab] = useState<"containers" | "deploy" | "deployments">("containers");

  async function load() {
    const [me, conts] = await Promise.all([getMe(), listContainers()]);
    setUser(me);
    setContainers(conts);

    try {
      const github = await getGithubStatus();
      if (github) {
        setGithubConnected(true);
        const repoList = await listRepos();
        setRepos(repoList);
      }
    } catch {}

    try {
      const deps = await listDeployments();
      setDeployments(deps);
    } catch {}
  }

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") {
      setGithubConnected(true);
      setActiveTab("deploy");
    }
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
        custom_port: customPort ? parseInt(customPort) : undefined,
      });
      setRepoUrl("");
      setSelectedRepo("");
      setCustomPort("");
      setActiveTab("deployments");
      await load();
    } finally {
      setDeploying(false);
    }
  }

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );

  const hasContainer = containers.length > 0;

  return (
    <div className="min-h-screen bg-muted">
      <Navbar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Dashboard</h2>
            <p className="text-muted-foreground text-sm">Welcome back, {user.full_name}</p>
          </div>
          {!hasContainer && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Environment"}
            </button>
          )}
        </div>

        {hasContainer && (
          <div className="flex gap-2 border-b">
            {["containers", "deploy", "deployments"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as "containers" | "deploy" | "deployments")}
                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {activeTab === "containers" && (
          <div className="space-y-4">
            {containers.length === 0 ? (
              <div className="bg-card border rounded-xl p-8 text-center space-y-3">
                <p className="font-medium">No environment yet</p>
                <p className="text-muted-foreground text-sm">
                  Create your development environment to get started
                </p>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create Environment"}
                </button>
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

        {activeTab === "deploy" && hasContainer && (
          <div className="space-y-6">
            {!githubConnected ? (
              <div className="bg-card border rounded-xl p-6 space-y-4">
                <div>
                  <h3 className="font-semibold">Connect GitHub</h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    Connect your GitHub account to deploy from your repositories
                  </p>
                </div>
                <div className="flex gap-3">
                  <a
                    href="https://api.sudelca.com/auth/github/login"
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
                  >
                    Connect GitHub
                  </a>
                </div>
              </div>
            ) : (
              <div className="bg-card border rounded-xl p-2 px-3 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500"/>
                <p className="text-sm text-muted-foreground">GitHub connected</p>
              </div>
            )}

            <div className="bg-card border rounded-xl p-6 space-y-4">
              <div>
                <h3 className="font-semibold">Deploy a project</h3>
                <p className="text-muted-foreground text-sm mt-1">
                  Deploy any GitHub repository to your environment
                </p>
              </div>

              <form onSubmit={handleDeploy} className="space-y-4">
                {githubConnected && repos.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Select from your repos</label>
                    <select
                      value={selectedRepo}
                      onChange={(e) => {
                        setSelectedRepo(e.target.value);
                        setRepoUrl("");
                      }}
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">-- Choose a repository --</option>
                      {repos.map((r) => (
                        <option key={r.full_name} value={r.url}>
                          {r.full_name} {r.private ? "🔒" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    {githubConnected ? "Or paste a GitHub URL" : "GitHub repository URL"}
                  </label>
                  <input
                    value={repoUrl}
                    onChange={(e) => {
                      setRepoUrl(e.target.value);
                      setSelectedRepo("");
                    }}
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="https://github.com/username/repo"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    Port <span className="text-muted-foreground">(auto-detected from Dockerfile if empty)</span>
                  </label>
                  <input
                    value={customPort}
                    onChange={(e) => setCustomPort(e.target.value)}
                    type="number"
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="3000"
                  />
                </div>

                <button
                  type="submit"
                  disabled={deploying || (!repoUrl && !selectedRepo)}
                  className="w-full bg-primary text-primary-foreground py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {deploying ? "Deploying..." : "Deploy"}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === "deployments" && (
          <div className="space-y-4">
            {deployments.length === 0 ? (
              <div className="bg-card border rounded-xl p-8 text-center">
                <p className="text-muted-foreground text-sm">No deployments yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {deployments.map((d) => (
                  <div key={d.id} className="bg-card border rounded-xl p-5 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm truncate max-w-xs">{d.repo_url}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Port: {d.custom_port || d.detected_port || "auto"}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
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
                        <pre className="mt-2 bg-muted rounded p-3 overflow-x-auto text-xs whitespace-pre-wrap">
                          {d.build_logs}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
