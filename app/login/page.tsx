"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { AuthVisualSVG } from "@/components/AuthVisual";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient({ rememberSession: remember });
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setSubmitting(false);
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "That email and password don't match our records."
          : error.message
      );
      return;
    }

    router.push("/projects");
    router.refresh();
  }

  return (
    <div className="auth-shell">
      <div className="auth-visual">
        <AuthVisualSVG />
        <div className="visual-copy">
          <h2>Precision roofing &amp; glazing quotes, built for the field.</h2>
          <p>
            Model roofs, nest sheets, and generate CNC-ready DXFs from one place — sign in to pick
            up where you left off.
          </p>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <img src="/ngslogo.png" alt="Norfolk Glazing Solutions" className="auth-logo" />
          <h1>Login</h1>
          <p className="auth-subtitle">Please login to continue</p>

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

            <div className="field">
              <label>Password</label>
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
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

            <div className="auth-links-row">
              <label className="checkbox-row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>
              <Link href="/forgot-password">Forgot password?</Link>
            </div>

            {error && <p className="field-error">{error}</p>}

            <button className="btn primary full" disabled={submitting} style={{ marginTop: 16 }}>
              {submitting ? "Signing in..." : "Login"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
