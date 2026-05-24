// Weekly digest send pipeline. Calls Resend HTTP API per-recipient
// (no SDK) — see docs/decisions/01-newsletter-provider.md. The HTML/text
// template lands in the next task; for now we send a placeholder body
// so the wiring (auth, env gating, error accounting) can be exercised
// end-to-end against a real Resend account.

export type NewsletterRecipient = {
  email: string;
  metroId?: string;
  ageBand?: string;
};

export type SendWeekendDigestResult = {
  ok: true;
  count: number;
  failed?: number;
  skipped?: string;
  errors?: Array<{ email: string; status: number; message: string }>;
};

interface NewsletterEnv {
  NEWSLETTER_ENABLED?: string;
  RESEND_API_KEY?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "FamHop Weekend <weekly@famhop.com>";
const REPLY_TO = "hello@famhop.com";

export async function sendWeekendDigest(
  env: NewsletterEnv,
  recipients: NewsletterRecipient[],
): Promise<SendWeekendDigestResult> {
  if (env.NEWSLETTER_ENABLED !== "true") {
    console.log("[newsletter] send skipped (NEWSLETTER_ENABLED!=true)", {
      count: recipients.length,
    });
    return { ok: true, count: 0, skipped: "disabled" };
  }
  if (!env.RESEND_API_KEY) {
    console.log("[newsletter] send skipped (RESEND_API_KEY not set)", {
      count: recipients.length,
    });
    return { ok: true, count: 0, skipped: "no-api-key" };
  }

  // TODO(next task): replace with real per-metro digest from
  // worker/src/newsletter-template.ts.
  const subject = "Your FamHop weekend";
  const html =
    "<p>Placeholder digest body. The real template lands in the next task.</p>";
  const text =
    "Placeholder digest body. The real template lands in the next task.";

  let sent = 0;
  const errors: Array<{ email: string; status: number; message: string }> = [];

  for (const recipient of recipients) {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [recipient.email],
        reply_to: REPLY_TO,
        subject,
        html,
        text,
      }),
    });
    if (res.ok) {
      sent += 1;
    } else {
      let message = "";
      try {
        message = (await res.text()).slice(0, 200);
      } catch {
        // swallow — best-effort error capture
      }
      errors.push({ email: recipient.email, status: res.status, message });
    }
  }

  if (errors.length > 0) {
    console.log("[newsletter] send completed with errors", {
      sent,
      failed: errors.length,
      sample: errors.slice(0, 3),
    });
    return { ok: true, count: sent, failed: errors.length, errors };
  }
  console.log("[newsletter] send ok", { sent });
  return { ok: true, count: sent };
}
