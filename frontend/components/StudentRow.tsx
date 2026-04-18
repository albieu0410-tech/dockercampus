import { Badge } from "@/components/ui/badge";
import type { User } from "@/lib/api";

export function StudentRow({ student }: { student: User }) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-card p-4 md:grid-cols-3 md:items-center">
      <div>
        <p className="font-medium">{student.full_name}</p>
        <p className="text-sm text-muted-foreground">{student.email}</p>
      </div>
      <div className="text-sm text-muted-foreground">ID: {student.id}</div>
      <div className="md:text-right">
        <Badge>{student.role}</Badge>
      </div>
    </div>
  );
}
