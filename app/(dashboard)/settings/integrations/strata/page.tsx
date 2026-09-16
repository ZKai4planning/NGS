import Link from "next/link";

export default function StrataSettingsPage() {
  return (
    <div style={{ maxWidth: 520 }}>
      <Link href="/settings/integrations" className="helptext" style={{ display: "inline-block", marginBottom: 10 }}>
        ← Integrations
      </Link>
      <h1 style={{ fontSize: 18, marginBottom: 6 }}>Strata CRM</h1>
      <p className="helptext" style={{ marginBottom: 18 }}>
        Sync new clients and bookings into NGS automatically.
      </p>

      <div
        style={{
          background: "var(--amber-dim)",
          color: "#7A5A1A",
          padding: "10px 14px",
          borderRadius: 8,
          fontSize: 12.5,
          marginBottom: 18,
          lineHeight: 1.5,
        }}
      >
        <strong>Not confirmed to exist yet.</strong> No public documentation shows getstrata.uk exposing outbound
        webhooks, and direct access is blocked by their robots.txt. Check their own Settings/Integrations page or ask
        their support directly — see the README for what's been tried.
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Webhook URL, if Strata supports one</div>
        <p className="helptext" style={{ marginBottom: 8 }}>
          Point Strata's outbound webhook (or a Zapier/Make "Webhooks" action) at:
        </p>
        <code
          className="mono"
          style={{ display: "block", background: "var(--bg)", padding: "8px 10px", borderRadius: 6, wordBreak: "break-all", fontSize: 12 }}
        >
          https://your-app-domain/api/strata/webhook
        </code>
        <p className="helptext" style={{ marginTop: 10 }}>
          Field names in <code className="mono">app/api/strata/webhook/route.ts</code> are still placeholders and need
          correcting once Strata's real payload shape is known.
        </p>
      </div>
    </div>
  );
}
