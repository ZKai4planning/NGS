import Link from "next/link";

export default function SettingsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, marginBottom: 18 }}>Settings</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Link
          href="/settings/profile"
          className="card card-pad"
          style={{ display: "block", textDecoration: "none", color: "var(--ink)" }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>Profile</div>
          <div className="helptext">Your account -- email, password, sign out</div>
        </Link>
        <Link
          href="/settings/integrations"
          className="card card-pad"
          style={{ display: "block", textDecoration: "none", color: "var(--ink)" }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>Integrations</div>
          <div className="helptext">AI4Planning, Strata CRM, and other connected services</div>
        </Link>
      </div>
    </div>
  );
}
