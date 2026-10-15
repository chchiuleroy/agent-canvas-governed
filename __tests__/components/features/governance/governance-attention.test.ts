import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nKey } from "#/i18n/declaration";
import {
  classifyResolveFailure,
  cleanOperator,
  reasonText,
  rememberedOperator,
  rememberOperator,
  visibleActions,
} from "#/components/features/governance/governance-attention";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("visibleActions", () => {
  it("offers only what the server allows, in a fixed order", () => {
    expect(visibleActions({ allowed_actions: ["dismiss", "retry"] })).toEqual([
      "retry",
      "dismiss",
    ]);
    expect(visibleActions({ allowed_actions: ["dismiss"] })).toEqual([
      "dismiss",
    ]);
  });

  it("never invents an action the server did not list", () => {
    // abandon must not appear for a record where it could have run already
    expect(
      visibleActions({ allowed_actions: ["retry", "dismiss"] }),
    ).not.toContain("abandon");
    expect(visibleActions({ allowed_actions: [] })).toEqual([]);
  });

  it("ignores an action this UI does not know instead of guessing", () => {
    expect(
      visibleActions({ allowed_actions: ["purge", "abandon", "retry"] }),
    ).toEqual(["retry", "abandon"]);
  });
});

describe("reasonText", () => {
  it("maps each reason the server can write to its own explanation", () => {
    const reasons = [
      "claim_failed",
      "claim_transient",
      "claim_retry_failed",
      "report_failed",
      "approval_cancelled_or_expired",
      "central_status_unexpected",
      "reconcile_failed",
      "binding_report_failed",
      "late_report_refused",
      "unreadable_outbox",
    ];
    const keys = reasons.map((r) => reasonText(r).key);
    expect(new Set(keys).size).toBe(reasons.length);
    expect(keys).not.toContain(I18nKey.GOVERNANCE$ATTENTION_REASON_UNKNOWN);
  });

  it("falls back to the generic text for a reason it does not know, and says which", () => {
    expect(reasonText("from_a_newer_server")).toEqual({
      key: I18nKey.GOVERNANCE$ATTENTION_REASON_UNKNOWN,
      values: { reason: "from_a_newer_server" },
    });
    expect(reasonText(null).key).toBe(
      I18nKey.GOVERNANCE$ATTENTION_REASON_UNKNOWN,
    );
  });

  it("does not look reasons up on the object prototype", () => {
    for (const reason of ["constructor", "__proto__", "toString"]) {
      expect(reasonText(reason).key).toBe(
        I18nKey.GOVERNANCE$ATTENTION_REASON_UNKNOWN,
      );
    }
  });
});

describe("cleanOperator", () => {
  it("trims and accepts an ordinary or non-Latin name", () => {
    expect(cleanOperator("  ada  ")).toBe("ada");
    expect(cleanOperator("王小明 (ops)")).toBe("王小明 (ops)");
  });

  it("holds the same 1 to 64 character bound as the server", () => {
    expect(cleanOperator("")).toBeNull();
    expect(cleanOperator("   ")).toBeNull();
    expect(cleanOperator("a".repeat(64))).toBe("a".repeat(64));
    expect(cleanOperator("a".repeat(65))).toBeNull();
    // counted in characters, not UTF-16 units
    expect(cleanOperator("😀".repeat(64))).toBe("😀".repeat(64));
  });

  it.each([
    ["a line break", "ada\nbob"],
    ["a tab", "ada\tbob"],
    ["a zero-width space", "ada​bob"],
    ["a line separator", "ada bob"],
    ["a null", "ada\u0000"],
  ])("refuses %s", (_label, name) => {
    expect(cleanOperator(name)).toBeNull();
  });
});

describe("classifyResolveFailure", () => {
  it("tells a stale view from a central problem from a bad request", () => {
    expect(classifyResolveFailure(409, "state_changed")).toBe("stale");
    expect(classifyResolveFailure(409, "request_id_mismatch")).toBe("stale");
    expect(classifyResolveFailure(409, "action_not_allowed")).toBe("stale");
    expect(classifyResolveFailure(404, "not_found")).toBe("stale");
    expect(classifyResolveFailure(424, "central_failed")).toBe("central");
    expect(classifyResolveFailure(422, null)).toBe("invalid");
  });

  it("does not call an unexplained failure stale", () => {
    expect(classifyResolveFailure(409, "reject_failed")).toBe("other");
    expect(classifyResolveFailure(500, null)).toBe("other");
    expect(classifyResolveFailure(null, null)).toBe("other");
  });
});

describe("the remembered operator", () => {
  it("is read back after it is remembered", () => {
    rememberOperator("ada");
    expect(rememberedOperator()).toBe("ada");
  });

  it("is empty, not an error, when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(rememberedOperator()).toBe("");
    expect(() => rememberOperator("ada")).not.toThrow();
  });
});
