"use client";

import { useEffect, useMemo, useState } from "react";
import { Github, Plus, Rocket, RotateCcw } from "lucide-react";
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

type Tab = "containers" | "deploy" | "deployments";

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
  const [activeTab, setActiveTab] = useState<Tab>("containers");

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
      } else {
        setGithubConnected(false);
      }
    } catch {
      setGithubConnected(false);
    }

    try {
      const deps = await listDeployments();
      setDeployments(deps);
    } catch {
      setDeployments([]);
    }
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
        custom_port: customPort ? parseInt(customPort, 10) : undefined,
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

  async function retryDeployment(_deploymentId: string, retryRepoUrl: string, port?: number | null) {
    await createDeployment({ repo_url: retryRepoUrl, custom_port: port ?? undefined });
    await load();
  }

  const runningCount = useMemo(() => containers.filter((c) => c.status === "running").length, [containers]);

  if (!user) {
    return (
      <div className="page-shell" style={{ display: "grid", placeItems: "center" }}>
        <p>Loading...</p>
      </div>
    );
  }

  const hasContainer = containers.length > 0;

  return (
    <div className="page-shell">
      <Navbar user={user} />
      <main className="page stack-y-6">
        <div className="flex-between" style={{ flexWrap: "wrap" }}>
          <div>
            <div className="label-ups">Dashboard</div>
            <h2 style={{ marginTop: 6 }}>Welcome back, {user.full_name}</h2>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!hasContainer && (
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating} type="button">
                <Plus size={14} /> {creating ? "Creating..." : "Create Environment"}
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setActiveTab("deploy")} type="button">
              <Rocket size={14} /> New deployment
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <div className="card card-pad"><div className="label-ups">Containers</div><h3 style={{ marginTop: 6 }}>{containers.length}</h3></div>
          <div className="card card-pad"><div className="label-ups">Running</div><h3 style={{ marginTop: 6 }}>{runningCount}</h3></div>
          <div className="card card-pad"><div className="label-ups">Deployments</div><h3 style={{ marginTop: 6 }}>{deployments.length}</h3></div>
        </div>

        <div className="tabs">
          <button className={`tab ${activeTab === "containers" ? "active" : ""}`} onClick={() => setActiveTab("containers")}>Containers</button>
          <button className={`tab ${activeTab === "deploy" ? "active" : ""}`} onClick={() => setActiveTab("deploy")}>Deploy</button>
          <button className={`tab ${activeTab === "deployments" ? "active" : ""}`} onClick={() => setActiveTab("deployments")}>Deployments ({deployments.length})</button>
        </div>

        {activeTab === "containers" && (
          <div>
            {containers.length === 0 ? (
              <div className="card card-pad stack-y-3" style={{ textAlign: "center", padding: 42 }}>
                <p style={{ color: "var(--text)", fontWeight: 500 }}>No environment yet</p>
                <p>Create your development environment to get started.</p>
                <div>
                  <button className="btn btn-primary" onClick={handleCreate} disabled={creating} type="button">
                    <Plus size={14} /> {creating ? "Creating..." : "Create Environment"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
                {containers.map((c) => (
                  <ContainerCard key={c.id} container={c} onRefresh={load} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "deploy" && (
          <div className="stack-y-4">
            {!githubConnected ? (
              <div className="card card-pad stack-y-3">
                <h3>Connect GitHub</h3>
                <p>Connect your GitHub account to deploy from your repositories.</p>
                <div>
                  <a href={`${apiUrl("/auth/github/login")}?token=${typeof window !== "undefined" ? localStorage.getItem("token") : ""}`} className="btn btn-primary">
                    <Github size={14} /> Connect GitHub
                  </a>
                </div>
              </div>
            ) : (
              <div className="card card-pad">
                <div className="status-dot status-running">
                  <span className="status-dot-circle" /> GitHub connected
                </div>
              </div>
            )}

            <div className="card card-pad stack-y-4">
              <h3>Step 1 - Browse repository</h3>
              <RepoInspector
                onSelectDockerfile={(_dockerfilePath, selectedRepoUrl) => {
                  setRepoUrl(selectedRepoUrl);
                  setSelectedRepo("");
                }}
              />
            </div>

            <div className="card card-pad stack-y-4">
              <h3>Step 2 - Deploy</h3>
              <form onSubmit={handleDeploy} className="stack-y-3">
                {githubConnected && repos.length > 0 && (
                  <div className="stack-y-2">
                    <label className="label-ups">Select from your repos</label>
                    <select
                      value={selectedRepo}
                      onChange={(e) => {
                        setSelectedRepo(e.target.value);
                        setRepoUrl("");
                      }}
                      className="input"
                    >
                      <option value="">-- Choose repository --</option>
                      {repos.map((r) => (
                        <option key={r.full_name} value={r.url}>
                          {r.full_name} {r.private ? "(private)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="stack-y-2">
                  <label className="label-ups">Repository URL</label>
                  <input
                    value={repoUrl}
                    onChange={(e) => {
                      setRepoUrl(e.target.value);
                      setSelectedRepo("");
                    }}
                    placeholder="https://github.com/username/repo"
                    className="input"
                  />
                </div>

                <div className="stack-y-2">
                  <label className="label-ups">Port (optional)</label>
                  <input
                    value={customPort}
                    onChange={(e) => setCustomPort(e.target.value)}
                    type="number"
                    placeholder="3000"
                    className="input"
                  />
                </div>

                <button type="submit" disabled={deploying || (!repoUrl && !selectedRepo)} className="btn btn-primary">
                  <Rocket size={14} /> {deploying ? "Deploying..." : "Deploy"}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === "deployments" && (
          <div className="stack-y-3">
            {deployments.length === 0 ? (
              <div className="card card-pad" style={{ textAlign: "center", padding: 38 }}>
                No deployments yet.
              </div>
            ) : (
              deployments.map((d) => (
                <div key={d.id} className="card card-pad stack-y-3">
                  <div className="flex-between" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div>
                      <p className="mono" style={{ color: "var(--text)", fontSize: 13 }}>{d.repo_url}</p>
                      <p className="mono" style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
                        Port: {d.custom_port || d.detected_port || "auto"}
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`status-dot ${d.status === "running" ? "status-running" : d.status === "failed" ? "status-error" : "status-building"}`}>
                        <span className="status-dot-circle" /> {d.status}
                      </span>
                      {(d.status === "failed" || d.status === "error") && (
                        <button type="button" onClick={() => retryDeployment(d.id, d.repo_url, d.custom_port)} className="btn btn-secondary btn-sm">
                          <RotateCcw size={12} /> Retry
                        </button>
                      )}
                    </div>
                  </div>

                  {d.public_url && (
                    <a href={d.public_url} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 12 }}>
                      {d.public_url}
                    </a>
                  )}

                  {d.build_logs && (
                    <details>
                      <summary className="label-ups" style={{ cursor: "pointer" }}>View build logs</summary>
                      <pre className="code" style={{ marginTop: 10 }}>{d.build_logs}</pre>
                    </details>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
