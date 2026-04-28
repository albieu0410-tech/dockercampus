"use client";
import { useState, useEffect } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  function logout() {
    clearToken();
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.push("/login");
  }

  const navLinks = user.role === "admin"
    ? [{ href: "/admin", label: "Admin" }, { href: "/dashboard", label: "Dashboard" }]
    : user.role === "professor"
    ? [
        { href: "/professor", label: "Dashboard" },
        { href: "/health", label: "Health" },
        { href: "/hive", label: "Hive" },
        { href: "/routing", label: "Routing" },
        { href: "/jobs", label: "Jobs" },
        { href: "/sleep", label: "Sleep" },
        { href: "/wireguard", label: "WireGuard" },
        { href: "/settings", label: "Settings" },
      ]
    : [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/health", label: "Health" },
        { href: "/hive", label: "Hive" },
        { href: "/routing", label: "Routing" },
        { href: "/jobs", label: "Jobs" },
        { href: "/sleep", label: "Sleep" },
        { href: "/wireguard", label: "WireGuard" },
        { href: "/settings", label: "Settings" },
      ];

  return (
    <header className="border-b border-zinc-800 bg-zinc-950 text-zinc-100 px-4 sm:px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-bold text-lg text-zinc-100">DockCampus</span>
          <nav className="hidden sm:flex items-center gap-4">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="hidden sm:flex items-center gap-3">
          <HealthBadge />
          <a href="/profile" className="text-sm text-zinc-400 hover:text-zinc-100 hover:underline">
            {user.full_name}
          </a>
          <span className="text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded-full capitalize">{user.role}</span>
          <button onClick={logout} className="text-sm text-red-400 hover:text-red-300 hover:underline">
            Logout
          </button>
        </div>

        <button
          className="sm:hidden p-2 rounded-md hover:bg-zinc-900"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <div className="w-5 h-0.5 bg-zinc-200 mb-1" />
          <div className="w-5 h-0.5 bg-zinc-200 mb-1" />
          <div className="w-5 h-0.5 bg-zinc-200" />
        </button>
      </div>

      {menuOpen && (
        <div className="sm:hidden border-t border-zinc-800 mt-3 pt-3 pb-2 space-y-1 px-4 bg-zinc-950">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="block py-2 text-sm text-zinc-400 hover:text-zinc-100"
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <a
            href="/health"
            className="block py-2 text-sm text-zinc-400 hover:text-zinc-100"
            onClick={() => setMenuOpen(false)}
          >
            System Status
          </a>
          <a
            href="/profile"
            className="block py-2 text-sm text-zinc-400 hover:text-zinc-100"
            onClick={() => setMenuOpen(false)}
          >
            Profile ({user.full_name})
          </a>
          <div className="pt-1 border-t border-zinc-800">
            <button onClick={logout} className="py-2 text-sm text-red-400 hover:text-red-300 hover:underline">
              Logout
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
