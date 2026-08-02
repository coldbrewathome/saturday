// Plan card API — store/fetch the shareable snapshot behind a #/card/<id>
// public page (the backlink target for Wrapped-style plan shares).

import { API_BASE, type StopSummary } from "./api";

export type PlanCardRecord = {
  cardId: string;
  metroId: string;
  title: string;
  stops: StopSummary[];
  createdAt: string;
};

export async function createPlanCard(body: {
  title: string;
  metroId?: string;
  stops: StopSummary[];
}): Promise<{ cardId: string }> {
  const response = await fetch(`${API_BASE}/plancards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Create plan card failed (${response.status})`);
  }
  return response.json();
}

export class PlanCardFetchError extends Error {
  status: number;
  constructor(status: number) {
    super(`Plan card not found (${status})`);
    this.status = status;
  }
}

export async function getPlanCard(cardId: string): Promise<PlanCardRecord> {
  const response = await fetch(`${API_BASE}/plancards/${cardId}`);
  if (!response.ok) {
    throw new PlanCardFetchError(response.status);
  }
  return response.json();
}
