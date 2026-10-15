import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GovernanceAttentionBadge } from "#/components/features/governance/governance-attention-badge";
import type { GovernanceAttentionItem } from "#/types/governance";

const mocks = vi.hoisted(() => ({
  data: undefined as GovernanceAttentionItem[] | null | undefined,
}));
vi.mock("#/hooks/query/use-governance-attention", () => ({
  useGovernanceAttention: () => ({ data: mocks.data }),
  useResolveGovernanceAttention: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
  }),
}));

// The global setup returns bare keys; echo interpolation so it can be asserted.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${JSON.stringify(options)}` : key,
  }),
}));

const item = (over: Partial<GovernanceAttentionItem> = {}) => ({
  conversation_id: "11111111-1111-1111-1111-111111111111",
  reason: "claim_failed",
  last_error_code: "device_not_bound",
  central_approval_id: "a1",
  request_id: "req-1",
  attempt_count: 1,
  last_attempt_at: "2026-10-15T00:00:00Z",
  allowed_actions: ["retry", "abandon", "dismiss"],
  ...over,
});

beforeEach(() => {
  mocks.data = undefined;
});

describe("GovernanceAttentionBadge", () => {
  it.each([
    ["while unknown", undefined],
    ["when the server has no such endpoint", null],
    ["when nothing needs attention", []],
  ])("renders nothing %s", (_label, data) => {
    mocks.data = data;
    render(<GovernanceAttentionBadge />);
    expect(screen.queryByTestId("governance-attention-badge")).toBeNull();
  });

  it("says how many need attention and opens the panel", async () => {
    mocks.data = [item(), item({ conversation_id: "c2", request_id: "req-2" })];
    render(<GovernanceAttentionBadge />);

    const badge = screen.getByTestId("governance-attention-badge");
    expect(badge.textContent).toContain('"count":2');
    expect(screen.queryByTestId("governance-attention-panel")).toBeNull();

    await userEvent.click(badge);
    expect(
      screen.getByTestId("governance-attention-panel"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("governance-attention-item")).toHaveLength(2);
  });
});

describe("the panel", () => {
  const open = async () => {
    render(<GovernanceAttentionBadge />);
    await userEvent.click(screen.getByTestId("governance-attention-badge"));
  };

  it("offers only the actions the server allows for each item", async () => {
    mocks.data = [
      item({ allowed_actions: ["retry", "dismiss"] }),
      item({
        conversation_id: "c2",
        request_id: "req-2",
        allowed_actions: ["abandon"],
      }),
      item({
        conversation_id: "c3",
        reason: "unreadable_outbox",
        request_id: null,
        allowed_actions: [],
      }),
    ];
    await open();

    const [first, second, third] = screen.getAllByTestId(
      "governance-attention-item",
    );
    // a record where the action may already have run must not get an abandon
    expect(
      within(first).queryByTestId("governance-attention-abandon"),
    ).toBeNull();
    expect(
      within(first).getByTestId("governance-attention-retry"),
    ).toBeVisible();
    expect(
      within(first).getByTestId("governance-attention-dismiss"),
    ).toBeVisible();
    expect(
      within(second).queryByTestId("governance-attention-retry"),
    ).toBeNull();
    expect(
      within(second).getByTestId("governance-attention-abandon"),
    ).toBeVisible();
    expect(within(third).queryByRole("button")).toBeNull();
  });

  it("shows what came from the server as text, never as markup", async () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    mocks.data = [
      item({
        reason: hostile,
        last_error_code: hostile,
        conversation_id: hostile,
      }),
    ];
    await open();

    const panel = screen.getByTestId("governance-attention-panel");
    expect(panel.querySelector("img")).toBeNull();
    expect(panel.textContent).toContain(hostile);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("explains an unknown reason as unknown, and names it", async () => {
    mocks.data = [
      item({ reason: "from_a_newer_server", allowed_actions: ["dismiss"] }),
    ];
    await open();
    expect(
      screen.getByTestId("governance-attention-panel").textContent,
    ).toContain("GOVERNANCE$ATTENTION_REASON_UNKNOWN");
    expect(
      screen.getByTestId("governance-attention-panel").textContent,
    ).toContain("from_a_newer_server");
  });

  it("is drawn on the document body, outside the sidebar that holds the badge", async () => {
    // inside the sidebar a fixed overlay is clipped to the sidebar's width
    mocks.data = [item()];
    const { container } = render(<GovernanceAttentionBadge />);
    await userEvent.click(screen.getByTestId("governance-attention-badge"));

    expect(
      screen.getByTestId("governance-attention-panel"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("[data-testid=governance-attention-panel]"),
    ).toBeNull();
  });

  it("still offers exactly what the server allows for a reason it does not know", async () => {
    mocks.data = [
      item({
        reason: "from_a_newer_server",
        allowed_actions: ["retry", "dismiss"],
      }),
    ];
    await open();
    expect(screen.getByTestId("governance-attention-retry")).toBeVisible();
    expect(screen.getByTestId("governance-attention-dismiss")).toBeVisible();
    expect(screen.queryByTestId("governance-attention-abandon")).toBeNull();
  });

  it("opens the confirmation for the chosen action only", async () => {
    mocks.data = [item()];
    await open();
    expect(
      screen.queryByTestId("governance-attention-resolve-dialog"),
    ).toBeNull();

    await userEvent.click(screen.getByTestId("governance-attention-abandon"));
    expect(
      screen.getByTestId("governance-attention-resolve-dialog"),
    ).toBeInTheDocument();
  });
});
