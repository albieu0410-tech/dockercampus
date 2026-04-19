"use client";
import { useEffect, useState } from "react";
import { getInviteCodes, createInviteCode } from "@/lib/api";

type InviteCode = {
  id: string;
  code: string;
  role: "student" | "professor";
  is_used: boolean;
  expires_at: string | null;
  created_at: string;
};

export default function InviteCodesTab() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [role, setRole] = useState<"student" | "professor">("student");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetchCodes();
  }, []);

  async function fetchCodes() {
    setLoading(true);
    try {
      const data = await getInviteCodes();
      setCodes(data);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const newCode = await createInviteCode({ role });
      setCodes((prev) => [newCode, ...prev]);
    } finally {
      setGenerating(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  const unused = codes.filter((c) => !c.is_used).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold" style={{ fontFamily: "'Syne', sans-serif" }}>
            Invite Codes
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {unused} unused · {codes.length} total
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select value={role} onChange={(e) => setRole(e.target.value as "student" | "professor")} className="text-sm rounded px-3 py-2">
            <option value="student">Student</option>
            <option value="professor">Professor</option>
          </select>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {generating ? (
              <>
                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Generating...
              </>
            ) : (
              <>⊕ Generate code</>
            )}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <div className="w-4 h-4 border border-orange-500 border-t-transparent rounded-full animate-spin" />
          Loading codes...
        </div>
      ) : (
        <div className="card rounded-lg overflow-hidden glow">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Expires</th>
                  <th className="text-left px-4 py-3">Created</th>
                  <th className="text-left px-4 py-3">Copy</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-orange-400 text-xs bg-orange-500/10 px-2 py-1 rounded">{c.code}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded badge-${c.role}`}>{c.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded badge-${c.is_used ? "used" : "unused"}`}>
                        {c.is_used ? "used" : "available"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {!c.is_used && (
                        <button
                          onClick={() => copyCode(c.code)}
                          className="text-xs px-3 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
                        >
                          {copied === c.code ? "✓ Copied" : "Copy"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {codes.length === 0 && <div className="text-center py-12 text-zinc-600 text-sm">No invite codes yet</div>}
        </div>
      )}
    </div>
  );
}
