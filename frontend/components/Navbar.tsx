"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearToken } from "@/lib/auth";
import type { User } from "@/lib/api";

type HealthStatus = "ok" | "degraded" | "error" | "loading";

function HealthBadge() {
  const [status, setStatus] = useState<HealthStatus>("loading");

  async function check() {
    try {
      const resp = await fetch("https://api.sudelca.com/health");
      const data = await resp.json();
      setStatus(data.status === "ok" ? "ok" : "degraded");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  const config = {
    ok: { dot: "bg-green-500 animate-pulse", text: "text-green-400", label: "All systems operational" },
    degraded: { dot: "bg-yellow-500 animate-pulse", text: "text-yellow-400", label: "Degraded" },
    error: { dot: "bg-red-500", text: "text-red-400", label: "Service down" },
    loading: { dot: "bg-zinc-600", text: "text-zinc-500", label: "Checking..." },
  }[status];

  return (
    <a
      href="/health"
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-zinc-800 hover:border-zinc-600 transition-colors"
      title="View system status"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${config.dot}`} />
      <span className={`text-xs font-medium ${config.text}`}>{config.label}</span>
    </a>
  );
}

export default function Navbar({ user }: { user: User }) {
  const router = useRouter();

  function logout() {
    clearToken();
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.push("/login");
  }

  return (
    <header className="border-b border-zinc-800 bg-zinc-950 text-zinc-100 px-4 sm:px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center text-white font-bold text-sm shrink-0">D</div>
          <span className="font-bold text-lg text-zinc-100">DockCampus</span>
        </div>

        <div className="flex items-center gap-3">
          <HealthBadge />
          <a href="/profile" className="text-sm text-zinc-400 hover:text-zinc-100 hover:underline hidden sm:inline">
            {user.full_name}
          </a>
          <span className="text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded-full capitalize hidden sm:inline">{user.role}</span>
          <button onClick={logout} className="text-sm text-red-400 hover:text-red-300 hover:underline">
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
