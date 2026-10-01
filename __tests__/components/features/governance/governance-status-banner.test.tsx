import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GovernanceStatusBanner } from "#/components/features/governance/governance-status-banner";
import type { GovernanceStatus } from "#/types/governance";

const statusMock = vi.hoisted(() => ({
  data: undefined as GovernanceStatus | null | undefined,
}));
vi.mock("#/hooks/query/use-governance-status", () => ({
  useGovernanceStatus: () => ({ data: statusMock.data }),
}));

// The global test setup returns bare keys; echo the interpolation options too
// so the missing-settings list passed to `t` can be asserted.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${JSON.stringify(options)}` : key,
  }),
}));

const api = (over = {}) => ({
  reachable: true,
  credentials_ok: true,
  error: null,
  checked_at: "2026-10-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  statusMock.data = undefined;
});

describe("GovernanceStatusBanner", () => {
  it("renders nothing for personal mode", () => {
    statusMock.data = {
      deployment_mode: "personal",
      missing_settings: [],
      central_api: null,
    };
    render(<GovernanceStatusBanner />);
    expect(screen.queryByTestId("governance-status-banner")).toBeNull();
  });

  it("renders nothing while the status is unknown", () => {
    render(<GovernanceStatusBanner />);
    expect(screen.queryByTestId("governance-status-banner")).toBeNull();
  });

  it("shows a neutral line when team mode is healthy", () => {
    statusMock.data = {
      deployment_mode: "team",
      missing_settings: [],
      central_api: api(),
    };
    render(<GovernanceStatusBanner />);
    expect(screen.getByTestId("governance-status-banner")).toHaveAttribute(
      "data-level",
      "ok",
    );
  });

  it("warns when central governance is unavailable and exposes the reason", () => {
    statusMock.data = {
      deployment_mode: "team",
      missing_settings: [],
      central_api: api({
        reachable: false,
        credentials_ok: null,
        error: "central API unreachable (ConnectError)",
      }),
    };
    render(<GovernanceStatusBanner />);
    const banner = screen.getByTestId("governance-status-banner");
    expect(banner).toHaveAttribute("data-level", "unavailable");
    expect(banner).toHaveAttribute(
      "title",
      "central API unreachable (ConnectError)",
    );
  });

  it("names the missing settings", () => {
    statusMock.data = {
      deployment_mode: "team",
      missing_settings: [
        "OH_GOVERNANCE_CLIENT_ID",
        "OH_GOVERNANCE_CLIENT_SECRET",
      ],
      central_api: api({ reachable: null, credentials_ok: null }),
    };
    render(<GovernanceStatusBanner />);
    const banner = screen.getByTestId("governance-status-banner");
    expect(banner).toHaveAttribute("data-level", "setup-incomplete");
    expect(banner.textContent).toContain("OH_GOVERNANCE_CLIENT_ID");
    expect(banner.textContent).toContain("OH_GOVERNANCE_CLIENT_SECRET");
  });
});
