"use client";
import { useRouter } from "next/navigation";
import { clearToken } from "@/lib/auth";
import type { User } from "@/lib/api";

export default function Navbar({ user }: { user: User }) {
  const router = useRouter();

  function logout() {
    clearToken();
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.push("/login");
  }

  return (
    <header className="border-b bg-card px-6 py-3 flex items-center justify-between">
      <span className="font-bold text-lg">DockCampus</span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{user.full_name}</span>
        <span className="text-xs bg-muted px-2 py-1 rounded-full capitalize">{user.role}</span>
        <button
          onClick={logout}
          className="text-sm text-destructive hover:underline"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
