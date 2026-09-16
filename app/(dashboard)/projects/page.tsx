import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("*, clients(name, address)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 18 }}>Projects</h1>
        <Link href="/projects/new" className="btn primary">
          New project
        </Link>
      </div>

      {!projects || projects.length === 0 ? (
        <div className="card card-pad">
          <p className="helptext">No projects yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="card">
          {projects.map((p: any, i: number) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 20,
                padding: "10px 20px",
                borderTop: i === 0 ? "none" : "1px solid var(--line)",
              }}
            >
              <Link
                href={`/projects/${p.id}`}
                style={{
                  display: "flex",
                  flex: 1,
                  minWidth: 0,
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  textDecoration: "none",
                  color: "var(--ink)",
                  padding: "4px 0",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.title}</div>
                  <div className="helptext">{p.clients?.name ?? "No client"} · {p.clients?.address ?? "—"}</div>
                </div>
                <div className="helptext" style={{ textTransform: "capitalize", whiteSpace: "nowrap" }}>
                  {p.status.replace(/_/g, " ")}
                </div>
              </Link>
              <DeleteProjectButton projectId={p.id} projectTitle={p.title} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
