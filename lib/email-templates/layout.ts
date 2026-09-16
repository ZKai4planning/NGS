// Shared shell for every transactional email. Keeps NGS branding (logo,
// colors, footer) in one place so individual templates only supply the
// subject and the body markup that goes inside.
//
// Uses table-based layout + inline styles on purpose: this is what
// actually survives Gmail/Outlook's HTML sanitizers, unlike the flexbox
// CSS used in the app itself.

const INK = "#1C2430";
const MUTED = "#69727D";
const LINE = "#E4E6E1";
const TEAL = "#0F7173";
const BG = "#FAFAF8";

function appUrl() {
  return (process.env.APP_URL || "").replace(/\/$/, "");
}

export function emailButton(label: string, href: string) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
      <tr>
        <td style="border-radius:8px;background:${TEAL};">
          <a href="${href}"
             style="display:inline-block;padding:12px 30px;font-family:Arial,Helvetica,sans-serif;
                    font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

export function emailLayout({
  previewText,
  bodyHtml,
}: {
  previewText?: string;
  bodyHtml: string;
}) {
  const logoSrc = `${appUrl()}/ngslogo.png`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Norfolk Glazing Solutions</title>
  </head>
  <body style="margin:0;padding:0;background:${BG};font-family:Arial,Helvetica,sans-serif;color:${INK};">
    ${
      previewText
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${previewText}</div>`
        : ""
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0"
                 style="width:480px;max-width:100%;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${INK};padding:26px 32px;text-align:center;">
                <img src="${logoSrc}" alt="Norfolk Glazing Solutions" width="140"
                     style="display:inline-block;height:auto;max-width:140px;" />
              </td>
            </tr>
            <tr>
              <td style="padding:36px 36px 8px;font-family:Arial,Helvetica,sans-serif;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 36px 26px;border-top:1px solid ${LINE};margin-top:20px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};text-align:center;font-family:Arial,Helvetica,sans-serif;">
                  Norfolk Glazing Solutions &middot; Rooftop &amp; window quoting<br />
                  This is an automated message — please don't reply directly to this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
