"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { register } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    invite_code: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await register(form);
      router.push("/login?registered=1");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell" style={{ display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card" style={{ width: "100%", maxWidth: 460, padding: 28 }}>
        <div className="stack-y-2">
          <div className="label-ups">DockCampus</div>
          <h2>Create account</h2>
          <p>Use your invite code to register.</p>
        </div>

        <form onSubmit={handleSubmit} className="stack-y-3" style={{ marginTop: 18 }}>
          <input type="text" value={form.full_name} onChange={(e) => update("full_name", e.target.value)} className="input" placeholder="Full name" required />
          <input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} className="input" placeholder="Email" required />
          <input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} className="input" placeholder="Password" required />
          <input type="text" value={form.invite_code} onChange={(e) => update("invite_code", e.target.value)} className="input" placeholder="Invite code" required />

          {error && <p style={{ color: "#fca5a5", fontSize: 13 }}>{error}</p>}

          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%" }}>
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p style={{ marginTop: 16, fontSize: 13 }}>
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </div>
    </div>
  );
}
