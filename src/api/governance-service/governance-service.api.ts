import { AgentServerClient } from "@openhands/typescript-client/clients";
import type {
  GovernanceAttentionItem,
  GovernanceResolveRequest,
  GovernanceResolveResponse,
  GovernanceStatus,
} from "#/types/governance";
import { getActiveBackend } from "../backend-registry/active-store";
import { getAgentServerClientOptions } from "../agent-server-client-options";

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;

/**
 * A refused or failed resolve call, reduced to what the UI may act on: the HTTP
 * status and the server's stable `error_code` (never its free text, which can
 * quote operator input).
 */
export class GovernanceResolveError extends Error {
  constructor(
    readonly status: number | null,
    readonly errorCode: string | null,
  ) {
    super(
      `governance resolve failed (${status ?? "no status"}, ${errorCode ?? "no code"})`,
    );
    this.name = "GovernanceResolveError";
  }
}

/** The server's `{detail: {error_code}}`, wherever the client put the body. */
const errorCodeOf = (error: unknown): string | null => {
  const body = (error as { response?: unknown } | null)?.response;
  const detail = (body as { detail?: unknown } | null | undefined)?.detail;
  const code = (detail as { error_code?: unknown } | null | undefined)
    ?.error_code;
  return typeof code === "string" ? code : null;
};

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

  /**
   * Conversations whose governance outbox needs an operator. Resolves `null`
   * when there is nothing to report (cloud backend, or an agent-server without
   * the endpoint); rejects on any other failure.
   */
  static async getAttention(): Promise<GovernanceAttentionItem[] | null> {
    if (getActiveBackend().backend.kind === "cloud") return null;

    const client = new AgentServerClient(getAgentServerClientOptions());
    try {
      return await client.get<GovernanceAttentionItem[]>(
        "/api/governance/attention",
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    } finally {
      client.close();
    }
  }

  /** Acts on one item; rejects with a `GovernanceResolveError`. */
  static async resolveAttention(
    conversationId: string,
    body: GovernanceResolveRequest,
  ): Promise<GovernanceResolveResponse> {
    const client = new AgentServerClient(getAgentServerClientOptions());
    try {
      return await client.post<GovernanceResolveResponse>(
        `/api/governance/attention/${encodeURIComponent(conversationId)}/resolve`,
        body,
      );
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      throw new GovernanceResolveError(
        typeof status === "number" ? status : null,
        errorCodeOf(error),
      );
    } finally {
      client.close();
    }
  }
}

export default GovernanceService;
