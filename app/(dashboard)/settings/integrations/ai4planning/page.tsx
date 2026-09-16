"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Status {
  connected: boolean;
  baseUrl: string | null;
  apiKeyMasked: string | null;
  webhookSecretMasked: string | null;
  enabled: boolean;
  updatedAt: string | null;
}

export default function AI4PlanningSettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/ai4planning/webhook`);
    fetch("/api/settings/integrations/ai4planning")
      .then((r) => r.json())
      .then((d) => {
        setStatus(d);
        if (d.baseUrl) setBaseUrl(d.baseUrl);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/integrations/ai4planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setStatus(data);
      setRevealedSecret(data.webhookSecretFull ?? null);
      setApiKey("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect AI4Planning? Existing submissions and their decisions stay on record.")) return;
    await fetch("/api/settings/integrations/ai4planning", { method: "DELETE" });
    setStatus({ connected: false, baseUrl: null, apiKeyMasked: null, webhookSecretMasked: null, enabled: true, updatedAt: null });
    setBaseUrl("");
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <Link href="/settings/integrations" className="helptext" style={{ display: "inline-block", marginBottom: 10 }}>
        ← Integrations
      </Link>
      <h1 style={{ fontSize: 18, marginBottom: 6 }}>AI4Planning</h1>
      <p className="helptext" style={{ marginBottom: 18 }}>
        Submit projects for council/planning approval and receive the decision automatically.
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
        <strong>Proposed contract, not yet verified.</strong> Submissions POST to{" "}
        <code className="mono">{"{base URL}"}/v1/submissions</code>, and decisions arrive via the webhook URL below.
        This is a sensible starting shape given AI4Planning is a companion project you're building — the request/
        response fields may need adjusting once its real API is finalized. See{" "}
        <code className="mono">app/api/ai4planning/submit/route.ts</code>.
      </div>

      {loading ? (
        <p className="helptext">Loading…</p>
      ) : (
        <>
          <form onSubmit={handleSave} className="card card-pad" style={{ marginBottom: 16 }}>
            <div className="field">
              <label>AI4Planning base URL</label>
              <input
                type="url"
                required
                placeholder="https://api.ai4planning.co.uk"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label>API key {status?.apiKeyMasked && <span className="helptext">(currently {status.apiKeyMasked})</span>}</label>
              <input
                type="password"
                placeholder={status?.connected ? "Enter a new key to rotate it" : "Paste your AI4Planning API key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required={!status?.connected}
              />
            </div>
            {error && <p className="field-error">{error}</p>}
            <button className="btn primary" disabled={saving}>
              {saving ? "Saving…" : status?.connected ? "Update connection" : "Connect"}
            </button>
          </form>

          {revealedSecret && (
            <div className="card card-pad" style={{ marginBottom: 16, borderColor: "var(--teal)" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Webhook secret (shown once)</div>
              <p className="helptext" style={{ marginBottom: 8 }}>
                Copy this into AI4Planning's webhook configuration now — it won't be shown in full again.
              </p>
              <code
                className="mono"
                style={{ display: "block", background: "var(--bg)", padding: "8px 10px", borderRadius: 6, wordBreak: "break-all", fontSize: 12 }}
              >
                {revealedSecret}
              </code>
            </div>
          )}

          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Webhook URL for AI4Planning</div>
            <p className="helptext" style={{ marginBottom: 8 }}>
              Give AI4Planning this URL to call once a decision is made. It should sign the request body with your
              webhook secret (HMAC-SHA256) in an <code className="mono">X-AI4Planning-Signature</code> header.
            </p>
            <code
              className="mono"
              style={{ display: "block", background: "var(--bg)", padding: "8px 10px", borderRadius: 6, wordBreak: "break-all", fontSize: 12 }}
            >
              {webhookUrl}
            </code>
          </div>

          {status?.connected && (
            <button onClick={handleDisconnect} className="btn" style={{ color: "var(--red)" }}>
              Disconnect
            </button>
          )}
        </>
      )}
    </div>
  );
}
