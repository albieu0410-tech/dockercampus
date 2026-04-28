"use client";

import { usePathname } from "next/navigation";
import type { User } from "@/lib/api";

type Link = { href: string; label: string; icon: string };

export default function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();

  const adminLinks: Link[] = [
    { href: "/admin", label: "Admin", icon: "⬡" },
    { href: "/health", label: "Status", icon: "⬤" },
    { href: "/hive", label: "Hive", icon: "◈" },
    { href: "/routing", label: "Routing", icon: "◇" },
    { href: "/jobs", label: "Jobs", icon: "◆" },
    { href: "/sleep", label: "Sleep", icon: "◉" },
    { href: "/wireguard", label: "WireGuard", icon: "◎" },
    { href: "/settings", label: "Settings", icon: "◌" },
  ];

  const userLinks: Link[] = [
    { href: user.role === "professor" ? "/professor" : "/dashboard", label: "Dashboard", icon: "⬡" },
    { href: "/health", label: "Health", icon: "⬤" },
    { href: "/hive", label: "Hive", icon: "◈" },
    { href: "/routing", label: "Routing", icon: "◇" },
    { href: "/jobs", label: "Jobs", icon: "◆" },
    { href: "/sleep", label: "Sleep", icon: "◉" },
    { href: "/wireguard", label: "WireGuard", icon: "◎" },
    { href: "/settings", label: "Settings", icon: "◌" },
  ];

  const links = user.role === "admin" ? adminLinks : userLinks;

  return (
    <aside className="hidden sm:flex w-52 min-h-[calc(100vh-57px)] border-r border-zinc-800 p-4 flex-col gap-1 shrink-0 bg-zinc-950">
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <a
            key={link.href}
            href={link.href}
            className={`w-full text-left px-4 py-3 rounded text-sm transition-all flex items-center gap-3 ${
              active
                ? "bg-gradient-to-br from-orange-500 to-orange-600 text-white"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
            }`}
          >
            <span className="text-base">{link.icon}</span>
            {link.label}
          </a>
        );
      })}
    </aside>
  );
}
