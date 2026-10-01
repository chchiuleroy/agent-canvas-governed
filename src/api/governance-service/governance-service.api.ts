import { AgentServerClient } from "@openhands/typescript-client/clients";
import type { GovernanceStatus } from "#/types/governance";
import { getActiveBackend } from "../backend-registry/active-store";
import { getAgentServerClientOptions } from "../agent-server-client-options";

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;

/**
 * Read-only governance status from the local agent-server.
 *
 * `@openhands/typescript-client` has no typed client for this
 * governance-layer endpoint, so this goes through `AgentServerClient.request`
 * (the sanctioned escape hatch) rather than a raw `fetch`.
 */
class GovernanceService {
  /**
   * Resolves `null` when there is nothing to report: a cloud backend (the
   * governance layer is a local-desktop feature) or an agent-server without
   * the governance endpoint (404). Rejects on any other failure so the
   * caller can tell "unknown" from "personal mode".
   */
  static async getStatus(): Promise<GovernanceStatus | null> {
    if (getActiveBackend().backend.kind === "cloud") return null;

    const client = new AgentServerClient(getAgentServerClientOptions());
    try {
      return await client.get<GovernanceStatus>("/api/governance/status");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    } finally {
      client.close();
    }
  }
}

export default GovernanceService;
