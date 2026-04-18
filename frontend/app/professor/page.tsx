"use client";
import { useEffect, useState } from "react";
import { getMe, listStudents, listContainers, type User, type Container } from "@/lib/api";
import Navbar from "@/components/Navbar";

export default function ProfessorPage() {
  const [user, setUser] = useState<User | null>(null);
  const [students, setStudents] = useState<User[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);

  useEffect(() => {
    async function load() {
      const [me, studs, conts] = await Promise.all([
        getMe(),
        listStudents(),
        listContainers(),
      ]);
      setUser(me);
      setStudents(studs);
      setContainers(conts);
    }
    load();
  }, []);

  if (!user) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-muted">
      <Navbar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h2 className="text-xl font-bold">Professor Dashboard</h2>
          <p className="text-muted-foreground text-sm">Overview of all students and containers</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "Total students", value: students.length },
            { label: "Total containers", value: containers.length },
            { label: "Running", value: containers.filter((c) => c.status === "running").length },
          ].map((stat) => (
            <div key={stat.label} className="bg-card border rounded-xl p-5">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="text-3xl font-bold mt-1">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h3 className="font-semibold">Students</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Containers</th>
                <th className="text-left px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-muted/50">
                  <td className="px-5 py-3 font-medium">{s.full_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{s.email}</td>
                  <td className="px-5 py-3">
                    {containers.filter((c) => c.owner_id === s.id).length}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.is_active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
