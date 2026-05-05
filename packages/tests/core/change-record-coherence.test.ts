import { describe, expect, it } from "vitest";
import { verifyAcceptedHistoryCoherence } from "@changedown/core/internals";

describe("accepted history coherence", () => {
  it("treats cn-1 genesis as insertion from empty body", () => {
    const result = verifyAcceptedHistoryCoherence({
      currentBody: "Fresh visible seed.",
      records: [
        {
          id: "cn-1",
          type: "ins",
          status: "accepted",
          metadata: { source: "initial-word-body", scope: "document" },
          markdown: "Fresh visible seed.",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.body0).toBe("");
    expect(result.diagnostics).toEqual([]);
  });

  it("fails when accepted history cannot replay to current body", () => {
    const result = verifyAcceptedHistoryCoherence({
      currentBody: "Tampered body.",
      records: [
        {
          id: "cn-1",
          type: "ins",
          status: "accepted",
          metadata: { source: "initial-word-body", scope: "document" },
          markdown: "Fresh visible seed.",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.body0).toBe("Tampered body.");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("replays simple accepted insertion records from their markdown", () => {
    const result = verifyAcceptedHistoryCoherence({
      currentBody: "The API should use GraphQL for the public interface.",
      records: [
        {
          id: "cn-7",
          type: "ins",
          status: "accepted",
          metadata: {},
          markdown: "GraphQL",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.body0).toBe("The API should use  for the public interface.");
    expect(result.diagnostics).toEqual([]);
  });

  it("does not fail coherence only because accepted insertion text is repeated", () => {
    const result = verifyAcceptedHistoryCoherence({
      currentBody: "Echo Echo Echo",
      records: [
        {
          id: "cn-7",
          type: "ins",
          status: "accepted",
          metadata: {},
          markdown: "Echo",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.body0).toBe("Echo Echo ");
    expect(result.diagnostics).toEqual([]);
  });

  it("diagnoses genesis-shaped records that omit document-scope metadata", () => {
    const result = verifyAcceptedHistoryCoherence({
      currentBody: "Fresh visible seed.",
      records: [
        {
          id: "cn-1",
          type: "ins",
          status: "accepted",
          metadata: { source: "initial-word-body" },
          markdown: "Fresh visible seed.",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.body0).toBe("Fresh visible seed.");
    expect(result.diagnostics).toContain(
      "cn-1: accepted genesis record requires source initial-word-body and document scope"
    );
  });
});
