import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import GovernanceService from "#/api/governance-service/governance-service.api";
import { isTeamMode } from "#/components/features/governance/governance-status";
import { useActiveBackend } from "#/contexts/active-backend-context";
import type { GovernanceResolveRequest } from "#/types/governance";
import { GOVERNANCE_QUERY_KEYS } from "./query-keys";
import { useGovernanceStatus } from "./use-governance-status";

// A parked record does not fix itself, but another window or the CLI may
// resolve it; this keeps the badge honest without being chatty.
const GOVERNANCE_ATTENTION_REFETCH_MS = 30_000;

/**
 * Conversations whose governance outbox is parked and needs an operator.
 *
 * Only asks in team mode: the outbox does not exist otherwise, and the badge
 * must not appear (or the request be made) for personal or cloud users.
 * `data` is `undefined` until the first answer and after a failure, `null` when
 * the server has no such endpoint.
 */
export function useGovernanceAttention() {
  const { backend } = useActiveBackend();
  const { data: status } = useGovernanceStatus();
  return useQuery({
    queryKey: GOVERNANCE_QUERY_KEYS.attention(
      backend.id,
      backend.connectionRevision ?? 0,
    ),
    queryFn: () => GovernanceService.getAttention(),
    enabled: backend.kind === "local" && isTeamMode(status),
    retry: false,
    refetchInterval: GOVERNANCE_ATTENTION_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Resolve one item. The list is refreshed whether it worked or not: a refusal
 * (409) almost always means the item changed since it was shown.
 */
export function useResolveGovernanceAttention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      conversationId: string;
      body: GovernanceResolveRequest;
    }) => GovernanceService.resolveAttention(vars.conversationId, vars.body),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: [...GOVERNANCE_QUERY_KEYS.all, "attention"],
      }),
  });
}

/** The same id however a server spells it (hyphens, case). */
export const normalizeConversationId = (id: string): string =>
  id.replaceAll("-", "").toLowerCase();

/**
 * Titles of the conversations in the attention list, keyed by
 * `normalizeConversationId`. A title is only a convenience for the operator:
 * a conversation the server cannot look up, or a failed request, just leaves
 * the id as the only label.
 */
export function useGovernanceAttentionTitles(conversationIds: string[]) {
  const { backend } = useActiveBackend();
  const ids = [...new Set(conversationIds)].sort();
  return useQuery({
    queryKey: [
      ...GOVERNANCE_QUERY_KEYS.all,
      "attention-titles",
      backend.id,
      backend.connectionRevision ?? 0,
      ids,
    ],
    queryFn: async () => {
      const found =
        await AgentServerConversationService.batchGetAppConversations(ids);
      const titles: Record<string, string | null> = {};
      found.forEach((conversation) => {
        if (conversation) {
          titles[normalizeConversationId(conversation.id)] =
            conversation.title ?? null;
        }
      });
      return titles;
    },
    enabled: backend.kind === "local" && ids.length > 0,
    retry: false,
    staleTime: 60_000,
  });
}
