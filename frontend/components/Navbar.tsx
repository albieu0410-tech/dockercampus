"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearToken } from "@/lib/auth";
import type { User } from "@/lib/api";

export default function Navbar({ user }: { user: User }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  function logout() {
    clearToken();
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.push("/login");
  }

  const navLinks = user.role === "admin"
    ? [{ href: "/admin", label: "Admin" }, { href: "/dashboard", label: "Dashboard" }, { href: "/health", label: "Status" }]
    : user.role === "professor"
    ? [{ href: "/professor", label: "Dashboard" }, { href: "/health", label: "Status" }]
    : [{ href: "/dashboard", label: "Dashboard" }, { href: "/health", label: "Status" }];

  return (
    <header className="border-b bg-card px-4 sm:px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-bold text-lg">DockCampus</span>
          {/* Desktop nav links */}
          <nav className="hidden sm:flex items-center gap-4">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {l.label}
              </a>
            ))}
          </nav>
        </div>

        {/* Desktop right side */}
        <div className="hidden sm:flex items-center gap-4">
          <a href="/profile" className="text-sm text-muted-foreground hover:underline">
            {user.full_name}
          </a>
          <span className="text-xs bg-muted px-2 py-1 rounded-full capitalize">{user.role}</span>
          <button onClick={logout} className="text-sm text-destructive hover:underline">
            Logout
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden p-2 rounded-md hover:bg-muted"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <div className="w-5 h-0.5 bg-foreground mb-1" />
          <div className="w-5 h-0.5 bg-foreground mb-1" />
          <div className="w-5 h-0.5 bg-foreground" />
        </button>
      </div>

      {/* Mobile menu */}
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
