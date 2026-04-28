"use client";
import { useEffect, useState } from "react";
import { getMe, type User } from "@/lib/api";
import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    getMe().then(setUser);
  }, []);

  if (!user) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-zinc-950">
      <Navbar user={user} />
      <div className="flex">
        <Sidebar user={user} />
        <main className="flex-1 max-w-2xl px-6 py-8 space-y-6">
          <h2 className="text-xl font-bold">Settings</h2>

          <div className="bg-card border rounded-xl p-6 space-y-4">
            <h3 className="font-semibold">Account</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Name</p>
                <p className="font-medium mt-1">{user.full_name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Email</p>
                <p className="font-medium mt-1">{user.email}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Role</p>
                <p className="font-medium mt-1 capitalize">{user.role}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Member since</p>
                <p className="font-medium mt-1">{new Date(user.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
