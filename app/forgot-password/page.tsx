"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthVisualSVG } from "@/components/AuthVisual";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong. Please try again.");
      }

      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-visual">
        <AuthVisualSVG />
        <div className="visual-copy">
          <h2>Forgot your password?</h2>
          <p>No problem — tell us your email and we'll send a link to set a new one.</p>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <img src="/ngslogo.png" alt="Norfolk Glazing Solutions" className="auth-logo" />
          <h1>Reset password</h1>
          <p className="auth-subtitle">
            Enter the email on your account and we'll send you a reset link.
          </p>

          {sent ? (
            <p className="field-success">
              If an account exists for <b>{email}</b>, a reset link is on its way. Check your inbox
              (and spam folder).
            </p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Email address</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>

              {error && <p className="field-error">{error}</p>}

              <button className="btn primary full" disabled={submitting}>
                {submitting ? "Sending..." : "Send reset link"}
              </button>
            </form>
          )}

          <p className="auth-footer-link">
            <Link href="/login">Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
