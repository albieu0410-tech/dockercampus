"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_URL, getMe, login, verifyOtp } from "@/lib/api";
import { saveToken } from "@/lib/auth";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpSessionId, setOtpSessionId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function goByRole() {
    const me = await getMe();
    router.push(me.role === "professor" ? "/professor" : me.role === "admin" ? "/admin" : "/dashboard");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await login({ email, password });
      if (res.access_token) {
        saveToken(res.access_token);
        document.cookie = `token=${res.access_token}; path=/`;
        await goByRole();
      } else if (res.otp_session_id) {
        setOtpSessionId(res.otp_session_id);
      } else {
        setError("Login failed. Please try again.");
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { access_token } = await verifyOtp({ otp_session_id: otpSessionId!, otp_code: otpCode });
      saveToken(access_token);
      document.cookie = `token=${access_token}; path=/`;
      await goByRole();
    } catch (err: any) {
      setError(err.message || "Invalid code");
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
            Deploy faster.
            <br />
            <span className="text-orange-500">Own your stack.</span>
          </h1>
          <p className="text-zinc-400 mt-6 max-w-xl text-base">
            DockCampus lets you ship from GitHub to your own Hive infrastructure with full control.
          </p>
        </div>
        <div className="text-xs text-zinc-500">queen online · {API_URL}</div>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-7 sm:p-8 shadow-2xl">
          <h2 className="text-2xl font-bold">Sign in</h2>
          <p className="text-zinc-400 text-sm mt-1">Access your DockCampus workspace</p>

          {justRegistered && !otpSessionId && (
            <p className="mt-4 text-sm text-green-300 bg-green-900/30 border border-green-700/40 rounded-md px-3 py-2">
              Account created. Sign in to continue.
            </p>
          )}

          {!otpSessionId ? (
            <form onSubmit={handleLogin} className="space-y-4 mt-6">
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
              {error && <p className="text-red-300 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-orange-500 hover:bg-orange-600 text-white py-2 text-sm font-medium disabled:opacity-50"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4 mt-6">
              <div>
                <label className="text-xs uppercase tracking-wider text-zinc-500">6-digit code</label>
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  maxLength={6}
                  placeholder="••••••"
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-center tracking-[0.35em] text-lg outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                  required
                />
              </div>
              {error && <p className="text-red-300 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-orange-500 hover:bg-orange-600 text-white py-2 text-sm font-medium disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify code"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOtpSessionId(null);
                  setError("");
                }}
                className="w-full text-zinc-400 hover:text-zinc-200 text-sm"
              >
                Back to login
              </button>
            </form>
          )}

          <p className="text-sm text-center text-zinc-400 mt-6">
            No account? <a href="/register" className="text-orange-400 hover:underline">Register</a>
          </p>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
