"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { AuthVisualSVG } from "@/components/AuthVisual";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [verifying, setVerifying] = useState(true);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function verify() {
      const supabase = createClient();
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      const code = searchParams.get("code");

      // Primary path: the link we send (via Brevo) carries token_hash +
      // type=recovery, verified with verifyOtp — this is what actually
      // works for a recovery link generated server-side via the admin API.
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "recovery",
        });
        setVerifyError(
          error ? "This reset link is invalid or has expired. Request a new one." : null
        );
        setVerifying(false);
        return;
      }

      // Fallback: a ?code= param (PKCE), kept in case this ever runs
      // against a link generated a different way.
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        setVerifyError(
          error ? "This reset link is invalid or has expired. Request a new one." : null
        );
        setVerifying(false);
        return;
      }

      setVerifyError("This reset link is invalid or has expired. Request a new one.");
      setVerifying(false);
    }
    verify();
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    setDone(true);
    setTimeout(() => {
      router.push("/projects");
      router.refresh();
    }, 1500);
  }

  return (
    <div className="auth-shell">
      <div className="auth-visual">
        <AuthVisualSVG />
        <div className="visual-copy">
          <h2>Set a new password</h2>
          <p>Choose something strong that you haven't used before.</p>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <img src="/ngslogo.png" alt="Norfolk Glazing Solutions" className="auth-logo" />
          <h1>New password</h1>

          {verifying ? (
            <p className="auth-subtitle">Verifying your reset link...</p>
          ) : verifyError ? (
            <>
              <p className="field-error">{verifyError}</p>
              <a
                href="/forgot-password"
                className="btn primary full"
                style={{ marginTop: 14, display: "block", textAlign: "center" }}
              >
                Request a new link
              </a>
            </>
          ) : done ? (
            <p className="field-success">Password updated. Redirecting you now...</p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>New password</label>
                <div className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <div className="field">
                <label>Confirm password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                />
              </div>

              {error && <p className="field-error">{error}</p>}

              <button className="btn primary full" disabled={submitting} style={{ marginTop: 8 }}>
                {submitting ? "Saving..." : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
