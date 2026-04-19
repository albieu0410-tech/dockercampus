"use client";
import { useEffect, useState } from "react";
import { getUsers, updateUser } from "@/lib/api";

type User = {
  id: string;
  email: string;
  full_name: string;
  role: "student" | "professor" | "admin";
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
};

export default function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    setLoading(true);
    try {
      const data = await getUsers();
      setUsers(data);
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    setUpdating(userId);
    try {
      await updateUser(userId, { role });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: role as User["role"] } : u)));
    } finally {
      setUpdating(null);
    }
  }

  async function handleToggleActive(userId: string, current: boolean) {
    setUpdating(userId);
    try {
      await updateUser(userId, { is_active: !current });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_active: !current } : u)));
    } finally {
      setUpdating(null);
    }
  }

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold" style={{ fontFamily: "'Syne', sans-serif" }}>
            Users
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">{users.length} total accounts</p>
        </div>
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded px-3 py-2 text-sm w-64"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <div className="w-4 h-4 border border-orange-500 border-t-transparent rounded-full animate-spin" />
          Loading users...
        </div>
      ) : (
        <div className="card rounded-lg overflow-hidden glow">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Verified</th>
                  <th className="text-left px-4 py-3">Joined</th>
                  <th className="text-left px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors">
                    <td className="px-4 py-3 font-medium">{user.full_name}</td>
                    <td className="px-4 py-3 text-zinc-400">{user.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        disabled={updating === user.id}
                        className={`text-xs rounded px-2 py-1 badge-${user.role}`}
                      >
                        <option value="student">student</option>
                        <option value="professor">professor</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded badge-${user.is_active ? "active" : "inactive"}`}>
                        {user.is_active ? "active" : "disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded ${user.is_verified ? "badge-active" : "badge-inactive"}`}>
                        {user.is_verified ? "✓ yes" : "✗ no"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(user.id, user.is_active)}
                        disabled={updating === user.id}
                        className={`text-xs px-3 py-1 rounded border transition-colors ${
                          user.is_active
                            ? "border-red-800 text-red-400 hover:bg-red-900/20"
                            : "border-green-800 text-green-400 hover:bg-green-900/20"
                        } disabled:opacity-40`}
                      >
                        {updating === user.id ? "..." : user.is_active ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <div className="text-center py-12 text-zinc-600 text-sm">No users found</div>}
        </div>
      )}
    </div>
  );
}
