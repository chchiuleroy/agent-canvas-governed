import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { AgentState } from "#/types/agent-state";
import { ActionTooltip } from "../action-tooltip";
import { RiskAlert } from "#/components/shared/risk-alert";
import WarningIcon from "#/icons/u-warning.svg?react";
import { useEventMessageStore } from "#/stores/event-message-store";
import { useEventStore } from "#/stores/use-event-store";
import { isActionEvent } from "#/types/agent-server/type-guards";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";
import { useAgentState } from "#/hooks/use-agent-state";
import { useRespondToConfirmation } from "#/hooks/mutation/use-respond-to-confirmation";
import { SecurityRisk } from "#/types/agent-server/core/base/common";
import { useGovernanceStatus } from "#/hooks/query/use-governance-status";
import { isTeamMode } from "#/components/features/governance/governance-status";

export function ConversationConfirmationButtons() {
  const submittedEventIds = useEventMessageStore(
    (state) => state.submittedEventIds,
  );
  const addSubmittedEventId = useEventMessageStore(
    (state) => state.addSubmittedEventId,
  );
  const removeSubmittedEventId = useEventMessageStore(
    (state) => state.removeSubmittedEventId,
  );

  const { t } = useTranslation("openhands");
  const { data: conversation } = useActiveConversation();
  const { curAgentState } = useAgentState();
  const { mutate: respondToConfirmation } = useRespondToConfirmation();
  const events = useEventStore((state) => state.events);
  // In team mode the local "continue" is not the approval: central
  // governance decides and the agent-server resumes on its own, and the
  // server refuses a local accept without the bridge token anyway. Only an
  // affirmative team-mode report switches this on; unknown keeps today's UI.
  const { data: governanceStatus } = useGovernanceStatus();
  const teamMode = isTeamMode(governanceStatus);

  const awaitingAction = events
    .slice()
    .reverse()
    .find((ev) => {
      if (ev.source !== "agent") return false;
      return curAgentState === AgentState.AWAITING_USER_CONFIRMATION;
    });

  const handleConfirmation = useCallback(
    (accept: boolean) => {
      if (!awaitingAction || !conversation) {
        return;
      }
      if (accept && teamMode) {
        return;
      }

      // Mark event as submitted to prevent duplicate submissions
      const eventId = awaitingAction.id;
      if (eventId) {
        addSubmittedEventId(eventId);
      }

      // Call the agent-server API endpoint
      respondToConfirmation(
        {
          conversationId: conversation.id,
          conversationUrl: conversation.conversation_url || "",
          sessionApiKey: conversation.session_api_key,
          accept,
        },
        {
          // The event was marked submitted before the request. If the
          // request fails (for example a team-mode server refusing a local
          // accept), the action is still waiting for confirmation, so give
          // the buttons back instead of leaving it with no way to retry or
          // reject until a reload. (The global mutation handler already
          // shows the error.)
          onError: () => {
            if (eventId) {
              removeSubmittedEventId(eventId);
            }
          },
        },
      );
    },
    [
      awaitingAction,
      conversation,
      addSubmittedEventId,
      removeSubmittedEventId,
      respondToConfirmation,
      teamMode,
    ],
  );

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!awaitingAction) {
      return undefined;
    }

    const handleCancelShortcut = (event: KeyboardEvent) => {
      if (event.shiftKey && event.metaKey && event.key === "Backspace") {
        event.preventDefault();
        handleConfirmation(false);
      }
    };

    const handleContinueShortcut = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "Enter") {
        event.preventDefault();
        handleConfirmation(true);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Cancel: Shift+Cmd+Backspace (⇧⌘⌫)
      handleCancelShortcut(event);
      // Continue: Cmd+Enter (⌘↩)
      handleContinueShortcut(event);
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [awaitingAction, handleConfirmation]);

  // Only show if agent is waiting for confirmation and we haven't already submitted
  if (
    curAgentState !== AgentState.AWAITING_USER_CONFIRMATION ||
    !awaitingAction ||
    (awaitingAction.id !== undefined &&
      submittedEventIds.includes(awaitingAction.id))
  ) {
    return null;
  }

  // Get security risk from the action (only ActionEvent has security_risk)
  const risk = isActionEvent(awaitingAction)
    ? awaitingAction.security_risk
    : SecurityRisk.UNKNOWN;

  const isHighRisk = risk === SecurityRisk.HIGH;

  return (
    <div className="flex flex-col gap-2 pt-4">
      {isHighRisk && (
        <RiskAlert
          content={t(I18nKey.CHAT_INTERFACE$HIGH_RISK_WARNING)}
          icon={<WarningIcon width={16} height={16} color="#fff" />}
          severity="high"
          title={t(I18nKey.COMMON$HIGH_RISK)}
        />
      )}
      <div className="flex justify-between items-center">
        <p
          className="text-sm font-normal text-white"
          data-testid={teamMode ? "team-approval-pending" : undefined}
        >
          {teamMode
            ? t(I18nKey.GOVERNANCE$TEAM_APPROVAL_PENDING)
            : t(I18nKey.CHAT_INTERFACE$USER_ASK_CONFIRMATION)}
        </p>
        <div className="flex items-center gap-3">
          <ActionTooltip
            type="reject"
            onClick={() => handleConfirmation(false)}
          />
          {!teamMode && (
            <ActionTooltip
              type="confirm"
              onClick={() => handleConfirmation(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
