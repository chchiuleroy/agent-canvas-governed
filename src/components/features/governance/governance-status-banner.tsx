import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useGovernanceStatus } from "#/hooks/query/use-governance-status";
import { cn } from "#/utils/utils";
import { describeGovernanceStatus } from "./governance-status";

/**
 * Sidebar line showing the team-mode state of the local agent-server.
 * Renders nothing outside team mode, so personal users see no change.
 */
export function GovernanceStatusBanner() {
  const { t } = useTranslation("openhands");
  const { data } = useGovernanceStatus();
  const view = describeGovernanceStatus(data);
  if (!view) return null;

  let text: string;
  let title: string | undefined;
  if (view.level === "ok") {
    text = t(I18nKey.GOVERNANCE$STATUS_TEAM_OK);
  } else if (view.level === "setup-incomplete") {
    text = t(I18nKey.GOVERNANCE$STATUS_TEAM_SETUP_INCOMPLETE, {
      settings: view.missingSettings.join(", "),
    });
  } else {
    text = t(I18nKey.GOVERNANCE$STATUS_TEAM_UNAVAILABLE);
    title = view.detail ?? undefined;
  }

  return (
    <div
      role="status"
      data-testid="governance-status-banner"
      data-level={view.level}
      title={title}
      className={cn(
        "px-1 text-xs leading-snug",
        view.level === "ok" ? "text-neutral-400" : "text-amber-400",
      )}
    >
      {text}
    </div>
  );
}
