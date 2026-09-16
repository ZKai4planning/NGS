"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface IntegrationStatus {
  provider: string;
  connected: boolean;
  enabled: boolean;
  apiKeyMasked: string | null;
  updatedAt: string | null;
}

const PROVIDER_INFO: Record<string, { name: string; description: string; href: string }> = {
  ai4planning: {
    name: "AI4Planning",
    description: "Submit projects for council/planning approval and receive the decision automatically.",
    href: "/settings/integrations/ai4planning",
  },
  strata: {
    name: "Strata CRM",
    description: "Sync new clients and bookings into NGS automatically.",
    href: "/settings/integrations/strata",
  },
};

export default function IntegrationsSettingsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings/integrations")
      .then((r) => r.json())
      .then((d) => setIntegrations(d.integrations ?? []))
      .finally(() => setLoading(false));
  }, []);

  const byProvider = new Map(integrations.map((i) => [i.provider, i]));

  return (
    <div>
      <h1 style={{ fontSize: 18, marginBottom: 6 }}>Integrations</h1>
      <p className="helptext" style={{ marginBottom: 18 }}>
        Connect NGS to the other tools your work runs through.
      </p>

      {loading ? (
        <p className="helptext">Loading…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Object.entries(PROVIDER_INFO).map(([key, info]) => {
            const status = byProvider.get(key);
            return (
              <Link
                key={key}
                href={info.href}
                className="card card-pad"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none", color: "var(--ink)" }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{info.name}</div>
                  <div className="helptext">{info.description}</div>
                </div>
                <div>
                  {status?.connected ? (
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "#0B4E4F",
                        background: "var(--teal-dim)",
                        padding: "4px 10px",
                        borderRadius: 20,
                      }}
                    >
                      Connected {status.apiKeyMasked ? `· ${status.apiKeyMasked}` : ""}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "var(--muted)",
                        border: "1px solid var(--line)",
                        padding: "4px 10px",
                        borderRadius: 20,
                      }}
                    >
                      Not connected
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
