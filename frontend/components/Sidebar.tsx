"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@/lib/api";

type NavItem = { label: string; href: string };
type NavSection = { title: string; items: NavItem[] };

function getNavSections(role: string): NavSection[] {
  if (role === "admin") {
    return [
      {
        title: "General",
        items: [
          { label: "Dashboard", href: "/dashboard" },
          { label: "Admin Panel", href: "/admin" },
        ],
      },
      {
        title: "Infrastructure",
        items: [
          { label: "Hive", href: "/hive" },
          { label: "WireGuard", href: "/wireguard" },
          { label: "Routing", href: "/routing" },
        ],
      },
      {
        title: "Operations",
        items: [
          { label: "Jobs", href: "/jobs" },
          { label: "Sleep", href: "/sleep" },
        ],
      },
      {
        title: "Account",
        items: [{ label: "Settings", href: "/settings" }],
      },
    ];
  }

  if (role === "professor") {
    return [
      {
        title: "Navigation",
        items: [
          { label: "Classes", href: "/professor" },
          { label: "My Environment", href: "/dashboard" },
          { label: "Health", href: "/health" },
        ],
      },
      {
        title: "Account",
        items: [{ label: "Settings", href: "/settings" }],
      },
    ];
  }

  // student (default)
  return [
    {
      title: "Navigation",
      items: [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Health", href: "/health" },
      ],
    },
    {
      title: "Account",
      items: [{ label: "Settings", href: "/settings" }],
    },
  ];
}

export default function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();
  const sections = getNavSections(user.role);

  return (
    <nav className="sidebar" style={{ minHeight: "calc(100vh - 56px)" }}>
      {sections.map((section) => (
        <div key={section.title}>
          <div className="sidebar-label">{section.title}</div>
          {section.items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{ textDecoration: "none" }}
              >
                <div className={`sidebar-item${active ? " active" : ""}`}>
                  <span className="sidebar-item-dot" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
