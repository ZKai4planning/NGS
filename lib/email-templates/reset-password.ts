import { emailLayout, emailButton } from "./layout";

export function resetPasswordEmail({
  resetUrl,
  email,
}: {
  resetUrl: string;
  email: string;
}) {
  const bodyHtml = `
    <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#1C2430;">Reset your password</h1>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#1C2430;">
      We received a request to reset the password for <strong>${email}</strong>.
    </p>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#1C2430;">
      Click the button below to choose a new password. This link expires in 1 hour and can only be used once.
    </p>
    ${emailButton("Reset password", resetUrl)}
    <p style="margin:0 0 4px;font-size:12.5px;line-height:1.6;color:#69727D;">
      If you didn't request this, you can safely ignore this email — your password won't change.
    </p>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#69727D;word-break:break-all;">
      Or paste this link into your browser:<br />
      <a href="${resetUrl}" style="color:#0F7173;">${resetUrl}</a>
    </p>
  `;

  return {
    subject: "Reset your Norfolk Glazing Solutions password",
    html: emailLayout({
      previewText: "Reset the password for your NGS account.",
      bodyHtml,
    }),
  };
}
