import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendTransactionalEmail } from "@/lib/brevo";
import { resetPasswordEmail } from "@/lib/email-templates/reset-password";

// We generate the recovery link ourselves (via the service-role client)
// and send it through Brevo with NGS branding, instead of calling
// supabase.auth.resetPasswordForEmail() and relying on Supabase's own
// email delivery. Always returns a generic success message regardless of
// whether the email exists, so this endpoint can't be used to enumerate
// accounts.
export async function POST(req: Request) {
  let email: string | undefined;
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : undefined;
  } catch {
    // ignore — handled by the check below
  }

  const genericResponse = NextResponse.json({
    message: "If an account exists for that email, we've sent a password reset link.",
  });

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, "");

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${appUrl}/reset-password` },
    });

    // We build the link ourselves from `hashed_token` rather than using
    // `data.properties.action_link` directly. action_link points at
    // Supabase's own /auth/v1/verify endpoint and (for a link generated
    // server-side via the admin API, with no browser-held PKCE code
    // verifier) redirects back in a way our client can't exchange for a
    // session. Using token_hash + verifyOtp() on our own page is the
    // pattern that actually works for admin-generated recovery links.
    if (!error && data?.properties?.hashed_token) {
      const resetUrl = `${appUrl}/reset-password?token_hash=${encodeURIComponent(
        data.properties.hashed_token
      )}&type=recovery`;

      const { subject, html } = resetPasswordEmail({ resetUrl, email });
      await sendTransactionalEmail({ to: email, subject, html });
    } else if (error) {
      // Most commonly: no user with this email. Log for ops visibility,
      // but don't leak that to the caller.
      console.warn("forgot-password: generateLink error:", error.message);
    }
  } catch (err) {
    console.error("forgot-password: failed to send reset email:", err);
  }

  return genericResponse;
}
