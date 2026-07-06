const IS_LOCAL_DEVELOPMENT = process.env.NEXT_PUBLIC_ENVIRONMENT === "development";
const RAW_API_URL = IS_LOCAL_DEVELOPMENT
  ? "/api"
  : process.env.NEXT_PUBLIC_API_URL || "https://api.sudelca.com";

export const API_URL = RAW_API_URL.replace(/\/+$/, "");
export const APP_URL = IS_LOCAL_DEVELOPMENT
  ? "http://localhost"
  : "https://dockcampus.sudelca.com";

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_URL}${normalizedPath}`;
}

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const res = await fetch(apiUrl(normalizedPath), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || "Request failed");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

// -- Auth ---------------------------------------------------------------------

export async function register(data: {
  full_name: string;
  email: string;
  password: string;
  invite_code: string;
}) {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function login(data: { email: string; password: string }) {
  return request<{ access_token?: string; otp_session_id?: string; message?: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function verifyOtp(data: { otp_session_id: string; otp_code: string }) {
  return request<{ access_token: string; token_type: string }>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// -- Users --------------------------------------------------------------------

export async function getMe() {
  return request<User>("/users/me");
}

export async function listUsers() {
  return request<User[]>("/users");
}

export async function getUsers() {
  return request<AdminUser[]>("/users");
}

export async function updateUser(userId: string, data: { role?: string; is_active?: boolean }) {
  return request<AdminUser>(`/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function listStudents() {
  return request<User[]>("/users/students");
}

export async function updateProfile(data: { full_name: string }) {
  return request<User>("/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function changePassword(data: { current_password: string; new_password: string }) {
  return request("/users/me/change-password", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteAccount() {
  return request("/users/me", { method: "DELETE" });
}

// -- Containers ---------------------------------------------------------------

export async function listContainers() {
  return request<Container[]>("/containers");
}

export async function getContainers() {
  return request<AdminContainer[]>("/containers");
}

export async function createContainer(userId: string | number) {
  return request<{ container_id: string; port: number; editor_url: string }>("/containers/create", {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export async function containerAction(userId: string, action: "start" | "stop" | "restart") {
  if (action === "restart") {
    await request(`/containers/${userId}/stop`, { method: "POST" });
    return request(`/containers/${userId}/start`, { method: "POST" });
  }
  return request(`/containers/${userId}/${action}`, { method: "POST" });
}

export async function wakeContainer(userId: string) {
  return request(`/containers/${userId}/wake`, { method: "POST" });
}

export async function deleteContainer(userId: string) {
  return request(`/containers/${userId}/delete`, { method: "DELETE" });
}

// -- GitHub -------------------------------------------------------------------

export async function getGithubStatus() {
  return request<GithubConnection | null>("/auth/github/status");
}

export async function getInviteCodes() {
  return request<InviteCode[]>("/auth/invite-codes");
}

export async function createInviteCode(data: { role: string }) {
  return request<InviteCode>("/auth/invite-codes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listRepos() {
  return request<Repo[]>("/auth/github/repos");
}

export async function getRepoTree(repo: string) {
  return request<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `/auth/github/tree?repo=${encodeURIComponent(repo)}`
  );
}

export async function getFileContent(repo: string, path: string) {
  return request<{ content: string; path: string }>(
    `/auth/github/file?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`
  );
}

// -- Deployments --------------------------------------------------------------

export async function createDeployment(data: { repo_url: string; custom_port?: number }) {
  return request<Deployment>("/deployments", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listDeployments() {
  return request<Deployment[]>("/deployments");
}

export async function getDeployment(deploymentId: string) {
  return request<Deployment>(`/deployments/${encodeURIComponent(deploymentId)}`);
}

export const DEPLOYMENT_IN_PROGRESS_STATUSES = [
  "pending",
  "cloning",
  "detecting",
  "building",
  "starting",
] as const;

export function isDeploymentInProgress(status: string): boolean {
  return (DEPLOYMENT_IN_PROGRESS_STATUSES as readonly string[]).includes(status);
}

export async function cancelDeployment(deploymentId: string) {
  return request<{ id: string; status: string; cancelled: boolean }>(
    `/deployments/${encodeURIComponent(deploymentId)}/cancel`,
    { method: "POST" }
  );
}

// -- Hive ---------------------------------------------------------------------

export async function listHiveNodes() {
  return request<HiveNode[]>("/hive/nodes");
}

export async function getHiveJoinInfo() {
  return request<HiveJoinInfo>("/hive/join-info");
}

// -- Routing ------------------------------------------------------------------

export async function getRoutingState() {
  return request<RoutingState>("/routing/state");
}

export async function setRoutingStrategy(strategy: "rr" | "least" | "sticky" | "weight") {
  return request("/routing/strategy", {
    method: "PUT",
    body: JSON.stringify({ strategy }),
  });
}

export async function setCanary(active: boolean, percent: number) {
  return request("/routing/canary", {
    method: "PUT",
    body: JSON.stringify({ active, percent }),
  });
}

export async function setCircuit(nodeId: string, state: "closed" | "half" | "open") {
  return request(`/routing/nodes/${encodeURIComponent(nodeId)}/circuit`, {
    method: "POST",
    body: JSON.stringify({ state }),
  });
}

// -- WireGuard ----------------------------------------------------------------

export async function getWireGuardStatus() {
  return request<WireGuardStatus>("/wireguard/status");
}

export async function listWireGuardPeers() {
  return request<WireGuardPeer[]>("/wireguard/peers");
}

export async function upsertWireGuardPeer(data: {
  node_id: string;
  public_key?: string;
  preshared_key?: string;
  allowed_ips?: string;
  endpoint?: string;
  is_active?: boolean;
}) {
  return request<WireGuardPeer>("/wireguard/peers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateWireGuardPeer(
  nodeId: string,
  data: {
    public_key?: string;
    preshared_key?: string;
    allowed_ips?: string;
    endpoint?: string;
    is_active?: boolean;
  }
) {
  return request<WireGuardPeer>(`/wireguard/peers/${encodeURIComponent(nodeId)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// -- Jobs ---------------------------------------------------------------------

export async function listJobs(params?: { status?: string; limit?: number }) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.limit != null) q.set("limit", String(params.limit));
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return request<Job[]>(`/jobs/${suffix}`);
}

export async function createJob(data: {
  job_type: string;
  payload?: Record<string, unknown>;
  max_retries?: number;
}) {
  return request<Job>("/jobs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function retryJob(jobId: string) {
  return request<Job>(`/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
  });
}

export async function cancelJob(jobId: string) {
  return request<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
}

// -- Sleep --------------------------------------------------------------------

export async function getSleepStatus() {
  return request<SleepStatus>("/sleep/status");
}

export async function listSleepCandidates(limit = 100) {
  return request<SleepCandidate[]>(`/sleep/candidates?limit=${encodeURIComponent(String(limit))}`);
}

export async function runSleepManagerOnce() {
  return request<SleepReport>("/sleep/run", {
    method: "POST",
  });
}

// -- Types --------------------------------------------------------------------

export type User = {
  id: number | string;
  email: string;
  full_name: string;
  role: "student" | "professor" | "admin";
  is_active: boolean;
  created_at: string;
  is_verified?: boolean;
};

export type Container = {
  id: string;
  docker_container_id: string | null;
  port: number;
  status: string;
  user_id: string;
  cpu_limit: number;
  memory_limit_mb: number;
  created_at: string;
  editor_url: string | null;
  container_id?: string;
  owner_id?: number | string;
  name?: string;
  image?: string;
};

// -- New Types ----------------------------------------------------------------

export type GithubConnection = {
  id: string;
  github_username: string;
  created_at: string;
};

export type Repo = {
  name: string;
  full_name: string;
  url: string;
  private: boolean;
  description: string | null;
  updated_at: string;
};

export type Deployment = {
  id: string;
  repo_url: string;
  detected_port: number | null;
  custom_port: number | null;
  status: string;
  build_logs: string | null;
  public_url: string | null;
  created_at: string;
};

export type HiveNode = {
  id: string;
  role: "queen" | "worker";
  host: string;
  ip: string;
  ram_used: number;
  ram_total: number;
  cpu: number;
  disk_used: number;
  disk_total: number;
  deployments: number;
  last: string;
  online: boolean;
};

export type HiveJoinInfo = {
  join_token: string;
  join_command: string;
};

export type RoutingState = {
  strategy: "rr" | "least" | "sticky" | "weight";
  canary_active: boolean;
  canary_percent: number;
  nodes: RoutingNode[];
};

export type RoutingNode = {
  id: string;
  reqs: number;
  rt: number;
  err: number;
  breaker: "closed" | "half" | "open";
  failures: number;
  weight: number;
  active_connections: number;
  is_canary: boolean;
  host: string;
  ip: string;
  online: boolean;
};

export type WireGuardStatus = {
  enabled: boolean;
  configured: boolean;
  interface: string;
  network_cidr: string;
  listen_port: number;
  has_private_key: boolean;
  has_public_key: boolean;
};

export type WireGuardPeer = {
  id: string;
  node_id: string;
  public_key: string;
  preshared_key: string | null;
  allowed_ips: string;
  endpoint: string | null;
  is_active: boolean;
  last_handshake: string | null;
  updated_at: string;
};

export type Job = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  retries: number;
  max_retries: number;
};

export type SleepStatus = {
  config: {
    enabled: boolean;
    idle_sleep_minutes: number;
    scan_interval_seconds: number;
  };
  running: number;
  sleeping: number;
  stopped: number;
  idle_candidates: number;
};

export type SleepCandidate = {
  user_id: string;
  docker_container_id: string | null;
  last_activity: string;
};

export type SleepReport = {
  scanned: number;
  slept: number;
  failed: number;
  skipped: number;
  idle_minutes: number;
};

export type AdminUser = {
  id: string;
  email: string;
  full_name: string;
  role: "student" | "professor" | "admin";
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
};

export type InviteCode = {
  id: string;
  code: string;
  role: "student" | "professor";
  is_used: boolean;
  expires_at: string | null;
  created_at: string;
};

export type AdminContainer = {
  id: string;
  name?: string;
  status: string;
  rust_container_id?: string;
  docker_container_id?: string | null;
  owner_id?: string;
  user_id?: string;
  created_at: string;
};
