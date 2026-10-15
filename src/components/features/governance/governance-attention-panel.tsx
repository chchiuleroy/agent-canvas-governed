import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import XMarkIcon from "#/icons/x-mark.svg?react";
import { modalTitleLgMediumClassName } from "#/utils/modal-classes";
import type {
  GovernanceAttentionAction,
  GovernanceAttentionItem,
} from "#/types/governance";
import {
  ACTION_LABEL,
  reasonText,
  visibleActions,
} from "./governance-attention";
import { GovernanceAttentionResolveDialog } from "./governance-attention-resolve-dialog";

interface Props {
  items: GovernanceAttentionItem[];
  onClose: () => void;
}

/** The list of parked records, each with the actions the server allows for it. */
export function GovernanceAttentionPanel({ items, onClose }: Props) {
  const { t } = useTranslation("openhands");
  const [selected, setSelected] = useState<{
    item: GovernanceAttentionItem;
    action: GovernanceAttentionAction;
  } | null>(null);

  // In a portal: the sidebar is a containing block for fixed elements, so inside it
  // the overlay would be clipped to the sidebar instead of covering the window.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        role="presentation"
      />
      <div
        role="dialog"
        aria-modal="true"
        data-testid="governance-attention-panel"
        className="relative max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--oh-border)] bg-[var(--oh-surface)] p-6"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-muted hover:text-foreground"
          aria-label={t(I18nKey.BUTTON$CLOSE)}
        >
          <XMarkIcon className="size-5" />
        </button>
        <h2 className={modalTitleLgMediumClassName}>
          {t(I18nKey.GOVERNANCE$ATTENTION_PANEL_TITLE)}
        </h2>

        {items.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            {t(I18nKey.GOVERNANCE$ATTENTION_PANEL_EMPTY)}
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {items.map((item) => {
              const reason = reasonText(item.reason);
              return (
                <li
                  key={`${item.conversation_id}:${item.request_id ?? ""}`}
                  data-testid="governance-attention-item"
                  className="rounded-lg border border-[var(--oh-border)] p-3 text-sm"
                >
                  <p className="break-all text-xs text-muted">
                    {t(I18nKey.GOVERNANCE$ATTENTION_CONVERSATION)}:{" "}
                    {item.conversation_id}
                  </p>
                  <p className="mt-2">{t(reason.key, reason.values)}</p>
                  {item.last_error_code ? (
                    <p className="mt-1 break-all text-xs text-muted">
                      {t(I18nKey.GOVERNANCE$ATTENTION_ERROR_CODE)}:{" "}
                      {item.last_error_code}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {visibleActions(item).map((action) => (
                      <button
                        key={action}
                        type="button"
                        data-testid={`governance-attention-${action}`}
                        onClick={() => setSelected({ item, action })}
                        className="rounded-lg border border-[var(--oh-border)] px-3 py-1.5 text-xs text-white hover:bg-surface-raised"
                      >
                        {t(ACTION_LABEL[action])}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected ? (
        <GovernanceAttentionResolveDialog
          item={selected.item}
          action={selected.action}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
