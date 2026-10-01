import { describe, expect, it } from "vitest";
import {
  describeGovernanceStatus,
  isTeamMode,
} from "#/components/features/governance/governance-status";
import type { GovernanceStatus } from "#/types/governance";

const healthyApi = {
  reachable: true,
  credentials_ok: true,
  error: null,
  checked_at: "2026-10-01T00:00:00Z",
};

const team = (overrides: Partial<GovernanceStatus> = {}): GovernanceStatus => ({
  deployment_mode: "team",
  missing_settings: [],
  central_api: healthyApi,
  ...overrides,
});

const personal: GovernanceStatus = {
  deployment_mode: "personal",
  missing_settings: [],
  central_api: null,
};

describe("describeGovernanceStatus", () => {
  // Why: personal users must see exactly today's UI, and an unknown status
  // must never be rendered as an alarm.
  it("says nothing while loading", () => {
    expect(describeGovernanceStatus(undefined)).toBeNull();
  });

  it("says nothing when not applicable (cloud / no endpoint)", () => {
    expect(describeGovernanceStatus(null)).toBeNull();
  });

  it("says nothing in personal mode", () => {
    expect(describeGovernanceStatus(personal)).toBeNull();
  });

  it("reports ok only when reachable AND credentials are valid", () => {
    expect(describeGovernanceStatus(team())).toEqual({ level: "ok" });
  });

  it("reports unavailable when the central API is unreachable", () => {
    const view = describeGovernanceStatus(
      team({
        central_api: {
          ...healthyApi,
          reachable: false,
          credentials_ok: null,
          error: "central API unreachable (ConnectError)",
        },
      }),
    );
    expect(view).toEqual({
      level: "unavailable",
      detail: "central API unreachable (ConnectError)",
    });
  });

  it("reports unavailable when reachable but the credentials were rejected", () => {
    const view = describeGovernanceStatus(
      team({
        central_api: {
          ...healthyApi,
          credentials_ok: false,
          error: "token request failed (HTTP 401)",
        },
      }),
    );
    expect(view?.level).toBe("unavailable");
  });

  it("lets missing settings win over a healthy probe", () => {
    // The central API can be up while the bridge token is unset; accept is
    // then refused, so "connected" would be a lie.
    const view = describeGovernanceStatus(
      team({ missing_settings: ["OH_GOVERNANCE_BRIDGE_TOKEN"] }),
    );
    expect(view).toEqual({
      level: "setup-incomplete",
      missingSettings: ["OH_GOVERNANCE_BRIDGE_TOKEN"],
    });
  });

  it("treats team mode without a central_api block as unavailable", () => {
    expect(describeGovernanceStatus(team({ central_api: null }))).toEqual({
      level: "unavailable",
      detail: null,
    });
  });
});

describe("isTeamMode", () => {
  it("is true only for an affirmative team report", () => {
    expect(isTeamMode(team())).toBe(true);
    expect(isTeamMode(undefined)).toBe(false);
    expect(isTeamMode(null)).toBe(false);
    expect(isTeamMode(personal)).toBe(false);
  });
});
