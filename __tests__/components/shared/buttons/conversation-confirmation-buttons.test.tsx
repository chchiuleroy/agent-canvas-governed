import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationConfirmationButtons } from "#/components/shared/buttons/conversation-confirmation-buttons";
import { useEventMessageStore } from "#/stores/event-message-store";
import { AgentState } from "#/types/agent-state";
import type { GovernanceStatus } from "#/types/governance";

const mocks = vi.hoisted(() => ({
  respond: vi.fn(),
  governance: undefined as GovernanceStatus | null | undefined,
}));

// The real event-message store is used on purpose: the "buttons come back
// after a failed response" behavior is a round trip through it.
vi.mock("#/stores/use-event-store", () => ({
  useEventStore: (selector: (s: unknown) => unknown) =>
    selector({ events: [{ id: "ev-1", source: "agent" }] }),
}));
vi.mock("#/hooks/query/use-active-conversation", () => ({
  useActiveConversation: () => ({
    data: {
      id: "conv-1",
      conversation_url: "http://127.0.0.1:18000/api/conversations/conv-1",
      session_api_key: "key",
    },
  }),
}));
vi.mock("#/hooks/use-agent-state", () => ({
  useAgentState: () => ({
    curAgentState: AgentState.AWAITING_USER_CONFIRMATION,
  }),
}));
vi.mock("#/hooks/mutation/use-respond-to-confirmation", () => ({
  useRespondToConfirmation: () => ({ mutate: mocks.respond }),
}));
vi.mock("#/hooks/query/use-governance-status", () => ({
  useGovernanceStatus: () => ({ data: mocks.governance }),
}));

const teamStatus: GovernanceStatus = {
  deployment_mode: "team",
  missing_settings: [],
  central_api: null,
};

// mutate(variables, options): the component passes per-call options as well.
const calledWith = (variables: Record<string, unknown>) => [
  expect.objectContaining(variables),
  expect.anything(),
];

beforeEach(() => {
  mocks.respond.mockReset();
  mocks.governance = undefined;
  useEventMessageStore.setState({ submittedEventIds: [] });
});

describe("ConversationConfirmationButtons", () => {
  it("offers continue and reject when governance status is unknown", () => {
    // Why: an unknown status (loading, older agent-server) must keep today's
    // behavior rather than hiding the only way to proceed.
    render(<ConversationConfirmationButtons />);

    expect(screen.getByTestId("action-confirm-button")).toBeInTheDocument();
    expect(screen.getByTestId("action-reject-button")).toBeInTheDocument();
    expect(screen.queryByTestId("team-approval-pending")).toBeNull();
  });

  it("offers continue and reject in personal mode", () => {
    mocks.governance = {
      deployment_mode: "personal",
      missing_settings: [],
      central_api: null,
    };
    render(<ConversationConfirmationButtons />);

    fireEvent.click(screen.getByTestId("action-confirm-button"));

    expect(mocks.respond).toHaveBeenCalledWith(
      ...calledWith({ conversationId: "conv-1", accept: true }),
    );
  });

  it("replaces continue with a waiting message in team mode", () => {
    // Why: in team mode the local accept is refused without the bridge
    // token and is not the approval anyway; central governance decides and
    // the agent-server resumes by itself.
    mocks.governance = teamStatus;
    render(<ConversationConfirmationButtons />);

    expect(screen.queryByTestId("action-confirm-button")).toBeNull();
    expect(screen.getByTestId("team-approval-pending")).toBeInTheDocument();
  });

  it("still lets the user reject locally in team mode", () => {
    // Rejecting grants nothing, and the server never gates it.
    mocks.governance = teamStatus;
    render(<ConversationConfirmationButtons />);

    fireEvent.click(screen.getByTestId("action-reject-button"));

    expect(mocks.respond).toHaveBeenCalledWith(
      ...calledWith({ conversationId: "conv-1", accept: false }),
    );
  });

  it("ignores the continue keyboard shortcut in team mode", () => {
    mocks.governance = teamStatus;
    render(<ConversationConfirmationButtons />);

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("keeps the continue keyboard shortcut outside team mode", () => {
    render(<ConversationConfirmationButtons />);

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });

    expect(mocks.respond).toHaveBeenCalledWith(...calledWith({ accept: true }));
  });

  describe("submission state", () => {
    it("hides the buttons while a response is in flight", () => {
      // mutate never calls back: the request is still pending.
      render(<ConversationConfirmationButtons />);

      fireEvent.click(screen.getByTestId("action-confirm-button"));

      expect(screen.queryByTestId("action-confirm-button")).toBeNull();
      expect(screen.queryByTestId("action-reject-button")).toBeNull();
    });

    it("brings the buttons back when the response fails", () => {
      // Why: the event is marked submitted BEFORE the request, so without a
      // rollback a failed response (for example the 403 an unrecognised team
      // mode server answers a local accept with) left the action waiting for
      // confirmation with no way to retry or reject until a reload.
      mocks.respond.mockImplementation(
        (_variables: unknown, options?: { onError?: (e: Error) => void }) =>
          options?.onError?.(new Error("403")),
      );
      render(<ConversationConfirmationButtons />);

      fireEvent.click(screen.getByTestId("action-confirm-button"));

      expect(screen.getByTestId("action-confirm-button")).toBeInTheDocument();
      expect(screen.getByTestId("action-reject-button")).toBeInTheDocument();
      expect(useEventMessageStore.getState().submittedEventIds).toEqual([]);
    });

    it("also brings the buttons back when a reject fails", () => {
      mocks.respond.mockImplementation(
        (_variables: unknown, options?: { onError?: (e: Error) => void }) =>
          options?.onError?.(new Error("network")),
      );
      render(<ConversationConfirmationButtons />);

      fireEvent.click(screen.getByTestId("action-reject-button"));

      expect(screen.getByTestId("action-reject-button")).toBeInTheDocument();
    });

    it("keeps the buttons hidden when the response succeeds", () => {
      mocks.respond.mockImplementation(
        (_variables: unknown, options?: { onSuccess?: () => void }) =>
          options?.onSuccess?.(),
      );
      render(<ConversationConfirmationButtons />);

      fireEvent.click(screen.getByTestId("action-confirm-button"));

      expect(screen.queryByTestId("action-confirm-button")).toBeNull();
      expect(useEventMessageStore.getState().submittedEventIds).toEqual([
        "ev-1",
      ]);
    });
  });
});
