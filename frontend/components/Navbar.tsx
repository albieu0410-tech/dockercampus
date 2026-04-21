"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut, Menu, User as UserIcon } from "lucide-react";
import { clearToken } from "@/lib/auth";
import { apiUrl, type User } from "@/lib/api";

type HealthStatus = "ok" | "degraded" | "error" | "loading";

function HealthBadge() {
  const [status, setStatus] = useState<HealthStatus>("loading");

  async function check() {
    try {
      const resp = await fetch(apiUrl("/health"));
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

  const label = status === "ok"
    ? "All systems operational"
    : status === "degraded"
      ? "Degraded"
      : status === "error"
        ? "Service down"
        : "Checking...";

  const statusClass = status === "ok" ? "status-ok" : status === "degraded" ? "status-degraded" : "status-error";

  return (
    <a href="/health" className={`status-dot ${statusClass}`} title="View system status">
      <span className="status-dot-circle" />
      <span className="hidden sm:inline">{label}</span>
    </a>
  );
}

export default function Navbar({ user }: { user: User }) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  function logout() {
    clearToken();
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.push("/login");
  }

  const navLinks = user.role === "admin"
    ? [
        { href: "/admin", label: "Admin" },
        { href: "/dashboard", label: "Dashboard" },
        { href: "/hive", label: "Hive" },
        { href: "/health", label: "Health" },
      ]
    : user.role === "professor"
      ? [
          { href: "/professor", label: "Classes" },
          { href: "/dashboard", label: "My Environment" },
          { href: "/routing", label: "Routing" },
          { href: "/health", label: "Health" },
        ]
      : [
          { href: "/dashboard", label: "Dashboard" },
          { href: "/routing", label: "Routing" },
          { href: "/health", label: "Health" },
        ];

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a href="/dashboard" className="brand">
          <span className="brand-mark">D</span>
          <span className="brand-word">dockcampus</span>
        </a>

        <nav className="nav-links">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} className={`nav-link ${pathname === l.href ? "active" : ""}`}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="nav-right">
          <HealthBadge />
          <a href="/profile" className="btn btn-ghost btn-sm" title={user.full_name}>
            <UserIcon size={14} />
            <span className="hidden sm:inline">{user.full_name}</span>
          </a>
          <button className="btn btn-ghost btn-sm hidden sm:inline-flex" type="button" title="Notifications">
            <Bell size={14} />
          </button>
          <button onClick={logout} className="btn btn-danger btn-sm hidden sm:inline-flex" type="button">
            <LogOut size={14} />
            Logout
          </button>
          <button className="btn btn-ghost btn-sm sm:hidden" onClick={() => setMenuOpen((v) => !v)} type="button">
            <Menu size={14} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="card" style={{ margin: "8px 14px", padding: 12 }}>
          <div className="stack-y-2">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="btn btn-ghost" onClick={() => setMenuOpen(false)}>
                {l.label}
              </a>
            ))}
            <a href="/profile" className="btn btn-ghost" onClick={() => setMenuOpen(false)}>
              Profile
            </a>
            <button onClick={logout} className="btn btn-danger" type="button">Logout</button>
          </div>
        </div>
      )}
    </header>
  );
}
