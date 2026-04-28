"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { register } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await register({
        full_name: fullName,
        email,
        password,
        invite_code: inviteCode,
      });
      router.push("/login?registered=1");
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 grid lg:grid-cols-2" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
      `}</style>

      <section className="hidden lg:flex flex-col justify-between p-12 border-r border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
        <div>
          <div className="w-9 h-9 bg-orange-500 rounded flex items-center justify-center text-white font-bold text-sm">D</div>
          <h1 style={{ fontFamily: "'Syne', sans-serif" }} className="text-5xl leading-tight mt-10">
            Join your
            <br />
            <span className="text-orange-500">DockCampus Hive.</span>
          </h1>
          <p className="text-zinc-400 mt-6 max-w-xl text-base">
            Use your invite code to create a student or professor account and start deploying.
          </p>
        </div>
        <div className="text-xs text-zinc-500">invites required · secure onboarding</div>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-7 sm:p-8 shadow-2xl">
          <h2 className="text-2xl font-bold">Create account</h2>
          <p className="text-zinc-400 text-sm mt-1">Register with your invite code</p>

          <form onSubmit={handleRegister} className="space-y-4 mt-6">
            <div>
              <label className="text-xs uppercase tracking-wider text-zinc-500">Full name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                required
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-zinc-500">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                required
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-zinc-500">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                required
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-zinc-500">Invite code</label>
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Enter your invite code"
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                required
              />
            </div>

            {error && <p className="text-red-300 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-orange-500 hover:bg-orange-600 text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create account"}
            </button>
          </form>

          <p className="text-sm text-center text-zinc-400 mt-6">
            Already have an account? <a href="/login" className="text-orange-400 hover:underline">Sign in</a>
          </p>
        </div>
      </section>
    </div>
  );
}
