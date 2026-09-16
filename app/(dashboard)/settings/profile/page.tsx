import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Stable, deterministic initials from an email's local part -- same logic
// as components/UserMenu.tsx's avatar, kept in sync so the same person
// sees the same initials in the header and here.
function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

/**
 * The actual account/profile page -- deliberately separate from
 * /settings/integrations (see that page for AI4Planning/Strata). There's no
 * `profiles` table in this app yet (see supabase/schema.sql): org_id
 * doubles as the signed-in user's own auth id for solo installers, so the
 * only real profile data available right now is what Supabase Auth itself
 * holds -- email and when the account was created. This page shows exactly
 * that rather than inventing fields (name, company, phone) nothing in the
 * database actually stores.
 */
export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    redirect("/login");
  }

  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <div>
      <h1 style={{ fontSize: 18, marginBottom: 6 }}>Profile</h1>
      <p className="helptext" style={{ marginBottom: 18 }}>
        Your account. Connected services live under Integrations.
      </p>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "var(--ink)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initialsFromEmail(user.email)}
          </span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", wordBreak: "break-all" }}>{user.email}</div>
            {memberSince && <div className="helptext" style={{ marginTop: 2 }}>Member since {memberSince}</div>}
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Password</div>
        <p className="helptext" style={{ marginBottom: 12 }}>
          Sends a password reset link to {user.email}.
        </p>
        <a href="/forgot-password" className="btn">
          Reset password
        </a>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "var(--red)" }}>Sign out</div>
        <p className="helptext" style={{ marginBottom: 12 }}>
          Sign out of NGS on this device.
        </p>
        <a href="/api/auth/signout" className="btn" style={{ color: "var(--red)" }}>
          Sign out
        </a>
      </div>
    </div>
  );
}
