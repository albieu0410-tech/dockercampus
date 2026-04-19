"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login, verifyMagicLink } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { getMe } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const oobCode = searchParams.get("oobCode");
    const emailFromStorage = localStorage.getItem("emailForSignIn");

    if (oobCode && emailFromStorage) {
      setVerifying(true);
      verifyMagicLink({ email: emailFromStorage, oob_code: oobCode })
        .then(async ({ access_token }) => {
          saveToken(access_token);
          document.cookie = `token=${access_token}; path=/`;
          localStorage.removeItem("emailForSignIn");
          const me = await getMe();
          router.push(
            me.role === "professor"
              ? "/professor"
              : me.role === "admin"
                ? "/admin"
                : "/dashboard",
          );
        })
        .catch((err: any) => {
          setError(err.message);
          setVerifying(false);
        });
    }
  }, [router, searchParams]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login({ email, password });
      localStorage.setItem("emailForSignIn", email);
      setLinkSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted">
        <div className="bg-card border rounded-xl shadow-sm p-8 w-full max-w-md space-y-4 text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Verifying your magic link...</p>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="bg-card border rounded-xl shadow-sm p-8 w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold">DockCampus</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {linkSent ? "Check your email" : "Sign in to your account"}
          </p>
        </div>

        {justRegistered && !linkSent && (
          <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-md px-3 py-2">
            Account created! Sign in to continue.
          </p>
        )}

        {linkSent ? (
          <div className="space-y-4 text-center">
            <div className="text-4xl">📬</div>
            <p className="text-sm text-muted-foreground">
              We sent a magic link to <strong>{email}</strong>. Click it to sign in - no code needed.
            </p>
            <button
              onClick={() => {
                setLinkSent(false);
                setError("");
              }}
              className="text-sm text-muted-foreground hover:underline"
            >
              ← Use a different email
            </button>
          </div>
        ) : (
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
              {loading ? "Sending link..." : "Send magic link"}
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
