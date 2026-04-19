"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login, verifyOtp } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { getMe } from "@/lib/api";

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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { otp_session_id } = await login({ email, password });
      setOtpSessionId(otp_session_id);
    } catch (err: any) {
      setError(err.message);
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
      const me = await getMe();
      router.push(me.role === "professor" ? "/professor" : me.role === "admin" ? "/admin" : "/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="bg-card border rounded-xl shadow-sm p-8 w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold">DockCampus</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {otpSessionId ? "Check your email for a 6-digit code" : "Sign in to your account"}
          </p>
        </div>

        {justRegistered && !otpSessionId && (
          <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-md px-3 py-2">
            Account created! Sign in to continue.
          </p>
        )}

        {!otpSessionId ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">6-digit code</label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary tracking-widest text-center text-lg"
                maxLength={6}
                placeholder="••••••"
                required
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOtpSessionId(null);
                setError("");
              }}
              className="w-full text-sm text-muted-foreground hover:underline"
            >
              ← Back to login
            </button>
          </form>
        )}

        <p className="text-sm text-center text-muted-foreground">
          No account?{" "}
          <a href="/register" className="text-primary hover:underline">Register</a>
        </p>
      </div>
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
