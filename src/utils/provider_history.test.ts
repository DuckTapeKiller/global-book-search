import {
  categorizeFailure,
  clearHistory,
  loadHistory,
  recordOutcome,
  serializeHistory,
  summarizeProvider,
} from "@utils/provider_history";

const HOUR = 3_600_000;
const DAY = 86_400_000;

beforeEach(() => clearHistory());

describe("categorizeFailure", () => {
  it("maps HTTP statuses to reasons", () => {
    expect(categorizeFailure(429)).toBe("rate_limited");
    expect(categorizeFailure(202)).toBe("blocked");
    expect(categorizeFailure(403)).toBe("blocked");
    expect(categorizeFailure(503)).toBe("server_error");
  });

  it("maps error messages to reasons", () => {
    expect(categorizeFailure(undefined, new Error("AWSWAF challenge"))).toBe(
      "blocked",
    );
    expect(categorizeFailure(undefined, new Error("request timed out"))).toBe(
      "network",
    );
    expect(
      categorizeFailure(undefined, new Error("Failed to parse JSON")),
    ).toBe("parse");
    expect(categorizeFailure(undefined, new Error("weird"))).toBe("other");
  });
});

describe("recordOutcome + summarizeProvider", () => {
  it("aggregates successes and failures with reason breakdown", () => {
    const now = Date.UTC(2026, 5, 22, 12, 0, 0);
    recordOutcome("goodreads", true, {}, now);
    recordOutcome("goodreads", true, {}, now);
    recordOutcome("goodreads", false, { status: 202 }, now);
    recordOutcome("goodreads", false, { status: 429 }, now);

    const s = summarizeProvider("goodreads", now);
    expect(s.total).toBe(4);
    expect(s.totalOk).toBe(2);
    expect(s.totalFail).toBe(2);
    expect(s.successRate).toBeCloseTo(0.5);
    expect(s.reasons.blocked).toBe(1);
    expect(s.reasons.rate_limited).toBe(1);
    expect(s.lastErrorCode).toBe(429);
  });

  it("returns an empty summary for an unknown provider", () => {
    const s = summarizeProvider("nobody", Date.now());
    expect(s.total).toBe(0);
    expect(s.successRate).toBeNull();
    expect(s.days).toHaveLength(3);
    expect(s.days.every((d) => d.rate === null)).toBe(true);
  });

  it("buckets outcomes into the correct calendar day", () => {
    const today = Date.UTC(2026, 5, 22, 10, 0, 0);
    recordOutcome("x", true, {}, today);
    recordOutcome("x", false, { status: 500 }, today - DAY); // yesterday
    recordOutcome("x", true, {}, today - 2 * DAY); // 2 days ago

    const s = summarizeProvider("x", today);
    // days are oldest → newest
    expect(s.days[2].ok).toBe(1); // today
    expect(s.days[1].fail).toBe(1); // yesterday
    expect(s.days[0].ok).toBe(1); // 2 days ago
  });
});

describe("pruning", () => {
  it("drops outcomes older than the 3-day window", () => {
    const now = Date.UTC(2026, 5, 22, 12, 0, 0);
    recordOutcome("x", true, {}, now - 5 * DAY); // stale
    recordOutcome("x", true, {}, now);
    const s = summarizeProvider("x", now);
    expect(s.total).toBe(1);
  });
});

describe("serialize / load round-trip", () => {
  it("survives a save+load cycle", () => {
    const now = Date.UTC(2026, 5, 22, 12, 0, 0);
    recordOutcome("google", true, {}, now);
    recordOutcome("google", false, { status: 500 }, now);

    const snapshot = JSON.parse(JSON.stringify(serializeHistory())) as unknown;
    clearHistory();
    expect(summarizeProvider("google", now).total).toBe(0);

    loadHistory(snapshot, now);
    const s = summarizeProvider("google", now);
    expect(s.total).toBe(2);
    expect(s.reasons.server_error).toBe(1);
  });

  it("ignores garbage input without throwing", () => {
    expect(() => loadHistory(null)).not.toThrow();
    expect(() => loadHistory({ x: "nope" })).not.toThrow();
    expect(() => loadHistory({ x: { buckets: "bad" } })).not.toThrow();
  });

  it("prunes stale buckets on load", () => {
    const now = Date.UTC(2026, 5, 22, 12, 0, 0);
    const stale = {
      x: {
        buckets: [
          {
            h: Math.floor((now - 10 * DAY) / HOUR),
            ok: 9,
            fail: 0,
            reasons: {},
          },
        ],
      },
    };
    loadHistory(stale, now);
    expect(summarizeProvider("x", now).total).toBe(0);
  });
});
