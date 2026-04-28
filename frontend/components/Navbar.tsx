"use client";

import { useEffect, useRef, useState } from "react";
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

  const colorMap: Record<HealthStatus, string> = {
    ok: "#22c55e",
    degraded: "#eab308",
    error: "#ef4444",
    loading: "#52525b",
  };
  const labelMap: Record<HealthStatus, string> = {
    ok: "All systems operational",
    degraded: "Degraded",
    error: "Service down",
    loading: "Checking…",
  };

  return (
    <a
      href="/health"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 20,
        border: "1px solid var(--border)",
        textDecoration: "none",
        transition: "border-color 150ms",
        fontSize: 12,
        color: "var(--text-secondary)",
        fontFamily: "'Geist Mono', monospace",
      }}
      title="View system status"
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: colorMap[status],
          flexShrink: 0,
          animation: status === "ok" || status === "degraded" ? "pulse 2s infinite" : undefined,
        }}
      />
      {labelMap[status]}
    </a>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function Navbar({ user }: { user: User }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function logout() {
    clearToken();
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.push("/login");
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <header className="navbar">
      <div className="navbar-inner">
        {/* Brand */}
        <a href="/dashboard" className="brand" style={{ textDecoration: "none" }}>
          <div className="brand-mark">
            <span className="brand-mark-letter">D</span>
          </div>
          <span className="brand-word">dockcampus</span>
        </a>

        {/* Right side */}
        <div className="nav-right">
          <HealthBadge />

          {/* Avatar + dropdown */}
          <div ref={ref} style={{ position: "relative" }}>
            <div
              className="avatar"
              onClick={() => setOpen((o) => !o)}
              title={user.full_name}
            >
              {initials(user.full_name)}
            </div>

            {open && (
              <div className="dropdown" style={{ minWidth: 220 }}>
                {/* User info header */}
                <div
                  style={{
                    padding: "10px 12px 12px",
                    borderBottom: "1px solid var(--border)",
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: 2,
                    }}
                  >
                    {user.full_name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      fontFamily: "'Geist Mono', monospace",
                    }}
                  >
                    {user.email}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      display: "inline-block",
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      padding: "2px 7px",
                      borderRadius: 4,
                      background: "var(--accent-muted)",
                      color: "var(--accent)",
                      fontFamily: "'Geist Mono', monospace",
                    }}
                  >
                    {user.role}
                  </div>
                </div>

                <a
                  href="/profile"
                  className="dropdown-item"
                  style={{ textDecoration: "none" }}
                  onClick={() => setOpen(false)}
                >
                  Profile
                </a>
                <a
                  href="/settings"
                  className="dropdown-item"
                  style={{ textDecoration: "none" }}
                  onClick={() => setOpen(false)}
                >
                  Settings
                </a>

                <div
                  style={{
                    borderTop: "1px solid var(--border)",
                    marginTop: 4,
                    paddingTop: 4,
                  }}
                >
                  <div
                    className="dropdown-item"
                    style={{ color: "var(--error)" }}
                    onClick={() => {
                      setOpen(false);
                      logout();
                    }}
                  >
                    Sign out
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
