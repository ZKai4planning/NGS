// Thin wrapper around Brevo's transactional email API
// (https://api.brevo.com/v3/smtp/email). Used instead of Supabase's own
// auth emails so every message carries NGS branding and comes from our
// own sending domain/reputation.
//
// Required env vars (see .env.example):
//   BREVO_API_KEY       - Brevo API key (Settings -> SMTP & API -> API Keys)
//   BREVO_SENDER_EMAIL  - a sender verified in Brevo (Settings -> Senders)
//   BREVO_SENDER_NAME   - display name, defaults to "Norfolk Glazing Solutions"

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

export interface SendEmailInput {
  to: string;
  toName?: string;
  subject: string;
  html: string;
}

export async function sendTransactionalEmail({ to, toName, subject, html }: SendEmailInput) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;

  if (!apiKey || !senderEmail) {
    throw new Error(
      "Brevo is not configured — set BREVO_API_KEY and BREVO_SENDER_EMAIL in the environment."
    );
  }

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || "Norfolk Glazing Solutions",
        email: senderEmail,
      },
      to: [{ email: to, name: toName || undefined }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo send failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<{ messageId: string }>;
}
