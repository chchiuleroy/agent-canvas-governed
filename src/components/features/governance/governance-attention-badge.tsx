import { useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useGovernanceAttention } from "#/hooks/query/use-governance-attention";
import { GovernanceAttentionPanel } from "./governance-attention-panel";

/**
 * Sidebar line saying how many conversations are parked and need an operator;
 * opens the panel that lists them. Renders nothing unless the server reported
 * at least one (so personal mode, a cloud backend, an older agent-server and a
 * failed request all leave the sidebar exactly as it was).
 */
export function GovernanceAttentionBadge() {
  const { t } = useTranslation("openhands");
  const { data } = useGovernanceAttention();
  const [open, setOpen] = useState(false);
  if (!data || data.length === 0) return null;

  return (
    <>
      <button
        type="button"
        data-testid="governance-attention-badge"
        onClick={() => setOpen(true)}
        className="px-1 text-left text-xs leading-snug text-amber-400 underline-offset-2 hover:underline"
      >
        {t(I18nKey.GOVERNANCE$ATTENTION_BADGE, { count: data.length })}
      </button>
      {open ? (
        <GovernanceAttentionPanel items={data} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
