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
    ok: { dot: "bg-green-500 animate-pulse", text: "text-green-600", label: "All systems operational" },
    degraded: { dot: "bg-yellow-500 animate-pulse", text: "text-yellow-600", label: "Degraded" },
    error: { dot: "bg-red-500", text: "text-red-600", label: "Service down" },
    loading: { dot: "bg-zinc-400", text: "text-zinc-400", label: "Checking..." },
  }[status];

  return (
    <a
      href="/health"
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-zinc-200 hover:border-zinc-300 transition-colors"
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
    ? [{ href: "/professor", label: "Dashboard" }]
    : [{ href: "/dashboard", label: "Dashboard" }];

  return (
    <header className="border-b bg-card px-4 sm:px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-bold text-lg">DockCampus</span>
          <nav className="hidden sm:flex items-center gap-4">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="hidden sm:flex items-center gap-3">
          <HealthBadge />
          <a href="/profile" className="text-sm text-muted-foreground hover:underline">
            {user.full_name}
          </a>
          <span className="text-xs bg-muted px-2 py-1 rounded-full capitalize">{user.role}</span>
          <button onClick={logout} className="text-sm text-destructive hover:underline">
            Logout
          </button>
        </div>

        <button
          className="sm:hidden p-2 rounded-md hover:bg-muted"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <div className="w-5 h-0.5 bg-foreground mb-1" />
          <div className="w-5 h-0.5 bg-foreground mb-1" />
          <div className="w-5 h-0.5 bg-foreground" />
        </button>
      </div>

      {menuOpen && (
        <div className="sm:hidden border-t mt-3 pt-3 pb-2 space-y-1 px-4">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="block py-2 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <a
            href="/health"
            className="block py-2 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMenuOpen(false)}
          >
            System Status
          </a>
          <a
            href="/profile"
            className="block py-2 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMenuOpen(false)}
          >
            Profile ({user.full_name})
          </a>
          <div className="pt-1 border-t">
            <button onClick={logout} className="py-2 text-sm text-destructive hover:underline">
              Logout
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
