const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.sudelca.com";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
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
  return request<{ otp_session_id: string; message: string }>("/auth/login", {
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
  return request<User[]>("/users/");
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

// -- Containers ---------------------------------------------------------------

export async function listContainers() {
  return request<Container[]>("/containers/");
}

export async function getContainers() {
  return request<AdminContainer[]>("/containers");
}

export async function createContainer(data: { name: string; image: string }) {
  return request<Container>("/containers/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function containerAction(id: string, action: "start" | "stop" | "restart") {
  return request(`/containers/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export async function deleteContainer(id: string) {
  return request(`/containers/${id}`, { method: "DELETE" });
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

// -- Deployments --------------------------------------------------------------

export async function createDeployment(data: { repo_url: string; custom_port?: number }) {
  return request<Deployment>("/deployments/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listDeployments() {
  return request<Deployment[]>("/deployments/");
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
