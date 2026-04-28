"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe, type User } from "@/lib/api";
import Navbar from "@/components/Navbar";
import UsersTab from "./components/UsersTab";
import InviteCodesTab from "./components/InviteCodesTab";
import ContainersTab from "./components/ContainersTab";

type Tab = "users" | "invites" | "containers" | "health" | "hive" | "routing" | "jobs" | "sleep" | "wireguard";

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("users");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    getMe()
      .then((me) => {
        if (me.role !== "admin") router.push("/dashboard");
        else setUser(me);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  if (!user) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const tabs: { key: Tab; label: string; icon: string; href?: string }[] = [
    { key: "users",      label: "Users",        icon: "⬡" },
    { key: "invites",    label: "Invite Codes", icon: "⬢" },
    { key: "containers", label: "Containers",   icon: "⬣" },
    { key: "health",     label: "Status",       icon: "⬤", href: "/health" },
    { key: "hive",       label: "Hive",         icon: "◈", href: "/hive" },
    { key: "routing",    label: "Routing",      icon: "◇", href: "/routing" },
    { key: "jobs",       label: "Jobs",         icon: "◆", href: "/jobs" },
    { key: "sleep",      label: "Sleep",        icon: "◉", href: "/sleep" },
    { key: "wireguard",  label: "WireGuard",    icon: "◎", href: "/wireguard" },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
        .tab-active { background: linear-gradient(135deg, #f97316, #ea580c); color: #fff; }
        .card { background: #18181b; border: 1px solid #27272a; }
        .badge-student { background: #1d4ed820; color: #60a5fa; border: 1px solid #1d4ed840; }
        .badge-professor { background: #7c3aed20; color: #a78bfa; border: 1px solid #7c3aed40; }
        .badge-admin { background: #dc262620; color: #f87171; border: 1px solid #dc262640; }
        .badge-active { background: #16a34a20; color: #4ade80; border: 1px solid #16a34a40; }
        .badge-inactive { background: #52525220; color: #a1a1aa; border: 1px solid #52525240; }
        .badge-used { background: #52525220; color: #a1a1aa; border: 1px solid #52525240; }
        .badge-unused { background: #16a34a20; color: #4ade80; border: 1px solid #16a34a40; }
        .glow { box-shadow: 0 0 30px #f9731610; }
        input, select {
          background: #09090b !important;
          border: 1px solid #27272a !important;
          color: #f4f4f5 !important;
        }
        input:focus, select:focus {
          outline: none !important;
          border-color: #f97316 !important;
          box-shadow: 0 0 0 2px #f9731620 !important;
        }
        input::placeholder { color: #52525b !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #09090b; }
        ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 2px; }
      `}</style>

      <Navbar user={user} />

      <div className="flex">
        {/* Sidebar — hidden on mobile */}
        <div className="hidden sm:flex w-52 min-h-[calc(100vh-57px)] border-r border-zinc-800 p-4 flex-col gap-1 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                if (t.href) { router.push(t.href); return; }
                setTab(t.key);
              }}
              className={`w-full text-left px-4 py-3 rounded text-sm transition-all flex items-center gap-3 ${
                tab === t.key ? "tab-active" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
              }`}
            >
              <span className="text-base">{t.icon}</span>
              {t.label}
            </button>
          ))}

          <div className="mt-auto pt-4 border-t border-zinc-800">
            <div className="text-xs text-zinc-600 px-2">
              <div>DockCampus v0.1</div>
              <div className="text-orange-600 mt-0.5">● Admin mode</div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 p-4 sm:p-8">
          <select
            className="sm:hidden text-xs rounded px-2 py-1.5 mb-4 bg-zinc-900 border border-zinc-700"
            value={tab}
            onChange={(e) => {
              const value = e.target.value as Tab;
              const t = tabs.find((x) => x.key === value);
              if (t?.href) { router.push(t.href); return; }
              setTab(value);
            }}
          >
            {tabs.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          {tab === "users" && <UsersTab />}
          {tab === "invites" && <InviteCodesTab />}
          {tab === "containers" && <ContainersTab />}
        </div>
      </div>
    </div>
  );
}
