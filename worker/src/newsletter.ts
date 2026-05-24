// Weekly digest send pipeline. Stub for now — logs the payload and
// returns a count. Real Resend HTTP call lands in the next task
// (see docs/decisions/01-newsletter-provider.md).

export type NewsletterRecipient = {
  email: string;
  metroId?: string;
  ageBand?: string;
};

export type SendWeekendDigestResult = {
  ok: true;
  count: number;
  skipped?: string;
};

interface NewsletterEnv {
  NEWSLETTER_ENABLED?: string;
}

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
  // No real send yet. Log the payload so an operator running the
  // endpoint can confirm the recipient list resolves correctly.
  console.log("[newsletter] send (stub)", {
    count: recipients.length,
    sample: recipients.slice(0, 3).map((r) => ({
      email: r.email,
      metroId: r.metroId,
      ageBand: r.ageBand,
    })),
  });
  return { ok: true, count: recipients.length };
}
