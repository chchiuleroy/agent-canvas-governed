import { useQuery } from "@tanstack/react-query";
import GovernanceService from "#/api/governance-service/governance-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { QUERY_KEYS } from "./query-keys";

// The status probes central-governance-api server-side, so polling is what
// turns "central API died" into something the user can see.
const GOVERNANCE_STATUS_REFETCH_MS = 30_000;

/**
 * Governance status of the local agent-server: personal vs team mode and, in
 * team mode, whether central-governance-api is usable.
 *
 * `data` is `undefined` while loading, `null` when not applicable (cloud
 * backend / agent-server without the endpoint), and an error leaves `data`
 * `undefined` — callers must treat every non-team result as "unchanged
 * behavior", never as an affirmative "personal".
 */
export function useGovernanceStatus() {
  const { backend } = useActiveBackend();
  return useQuery({
    queryKey: [...QUERY_KEYS.GOVERNANCE_STATUS, backend.id],
    queryFn: () => GovernanceService.getStatus(),
    enabled: backend.kind === "local",
    retry: false,
    refetchInterval: GOVERNANCE_STATUS_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}
