import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import PlanCardView, { PlanCardArt, metroLabelForId } from "../src/PlanCardView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const stops = [
  {
    id: "spot-1",
    name: "Golden Gate Park",
    neighborhood: "Richmond",
    category: "Outdoors",
    imageUrl: "https://images.unsplash.com/photo-1?w=1200",
  },
  {
    id: "spot-2",
    name: "Exploratorium",
    neighborhood: "Embarcadero",
    category: "Museum",
    imageUrl: undefined,
  },
];

const record = {
  cardId: "abc12345",
  metroId: "bay-area",
  title: "Saturday out",
  stops,
  createdAt: "2026-08-01T00:00:00.000Z",
};

function mockFetchCard(record: unknown | null, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status < 400,
      status,
      json: async () => record,
    }) as Response),
  );
}

describe("PlanCardArt", () => {
  it("renders title, stops, and brand footer", () => {
    render(<PlanCardArt card={record} />);
    expect(screen.getByText("Saturday out")).toBeInTheDocument();
    expect(screen.getByText("Golden Gate Park")).toBeInTheDocument();
    expect(screen.getByText("Exploratorium")).toBeInTheDocument();
    expect(screen.getByText(/Plan your weekend at/)).toBeInTheDocument();
  });

  it("renders a fallback gradient for stops without images", () => {
    const { container } = render(<PlanCardArt card={record} />);
    expect(container.querySelectorAll(".plan-card-stop-img")).toHaveLength(1);
    expect(container.querySelectorAll(".plan-card-stop-fallback")).toHaveLength(1);
  });
});

describe("metroLabelForId", () => {
  it("maps a known metro id to its label", () => {
    expect(metroLabelForId("bay-area")).toBe("Bay Area");
  });

  it("falls back to the raw id for unknown metros", () => {
    expect(metroLabelForId("atlantis")).toBe("atlantis");
  });
});

describe("PlanCardView public page", () => {
  it("fetches the card and renders the art", async () => {
    vi.stubEnv("VITE_POLLS_API", "https://api.test");
    mockFetchCard(record);
    render(<PlanCardView cardId="abc12345" />);
    await waitFor(() => {
      expect(screen.getByText("Saturday out")).toBeInTheDocument();
    });
    expect(screen.getByText("Golden Gate Park")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Plan your weekend at/ })).toBeInTheDocument();
  });

  it("shows the expired state for a 404", async () => {
    vi.stubEnv("VITE_POLLS_API", "https://api.test");
    mockFetchCard(null, 404);
    render(<PlanCardView cardId="gone" />);
    await waitFor(() => {
      expect(screen.getByText("This plan card has expired")).toBeInTheDocument();
    });
  });

  it("shows a loading state while fetching", () => {
    vi.stubEnv("VITE_POLLS_API", "https://api.test");
    mockFetchCard(record);
    render(<PlanCardView cardId="abc12345" />);
    expect(screen.getByText("Loading plan…")).toBeInTheDocument();
  });
});
