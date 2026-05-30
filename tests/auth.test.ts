import { beforeEach, describe, expect, it } from "vitest";
import {
  readSession,
  writeSession,
  clearSession,
  type SessionState,
} from "../src/auth";

const SESSION_KEY = "saturday.session";

const sample: SessionState = {
  token: "tok-123",
  user: { email: "a@b.com", name: "Ada", picture: "https://x/y.png" },
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("session storage", () => {
  it("round-trips a written session", () => {
    writeSession(sample);
    expect(readSession()).toEqual(sample);
  });

  it("returns null when no session is stored", () => {
    expect(readSession()).toBeNull();
  });

  it("returns null on malformed JSON instead of throwing", () => {
    window.localStorage.setItem(SESSION_KEY, "{not valid json");
    expect(readSession()).toBeNull();
  });

  it("clearSession removes the stored session", () => {
    writeSession(sample);
    clearSession();
    expect(readSession()).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
