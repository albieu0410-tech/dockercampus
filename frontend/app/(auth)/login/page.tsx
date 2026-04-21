"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getMe, login, verifyOtp } from "@/lib/api";
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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await login({ email, password });
      if (res.access_token) {
        saveToken(res.access_token);
        document.cookie = `token=${res.access_token}; path=/`;
        const me = await getMe();
        router.push(me.role === "professor" ? "/professor" : me.role === "admin" ? "/admin" : "/dashboard");
      } else if (res.otp_session_id) {
        setOtpSessionId(res.otp_session_id);
      } else {
        setError("Login failed. Please try again.");
      }
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
    <div className="page-shell" style={{ display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card" style={{ width: "100%", maxWidth: 420, padding: 28 }}>
        <div className="stack-y-2">
          <div className="label-ups">DockCampus</div>
          <h2>{otpSessionId ? "Two-factor verification" : "Sign in"}</h2>
          <p>{otpSessionId ? "Check your email for the 6-digit code." : "Sign in to continue."}</p>
        </div>

        {justRegistered && !otpSessionId && (
          <p style={{ color: "#4ade80", fontSize: 13, marginTop: 14 }}>Account created. Sign in to continue.</p>
        )}

        {!otpSessionId ? (
          <form onSubmit={handleLogin} className="stack-y-3" style={{ marginTop: 18 }}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="Email" required />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="Password" required />
            {error && <p style={{ color: "#fca5a5", fontSize: 13 }}>{error}</p>}
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%" }}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="stack-y-3" style={{ marginTop: 18 }}>
            <input
              type="text"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              className="input mono"
              maxLength={6}
              placeholder="6-digit code"
              required
              style={{ letterSpacing: "0.35em", textAlign: "center" }}
            />
            {error && <p style={{ color: "#fca5a5", fontSize: 13 }}>{error}</p>}
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%" }}>
              {loading ? "Verifying..." : "Verify code"}
            </button>
            <button type="button" onClick={() => { setOtpSessionId(null); setError(""); }} className="btn btn-ghost" style={{ width: "100%" }}>
              Back to login
            </button>
          </form>
        )}

        <p style={{ marginTop: 16, fontSize: 13 }}>
          No account? <a href="/register">Register</a>
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
