import type { GovernanceStatus } from "#/types/governance";

export type GovernanceBannerView =
  | { level: "ok" }
  | { level: "setup-incomplete"; missingSettings: string[] }
  | { level: "unavailable"; detail: string | null };

/**
 * Decide what (if anything) the sidebar should say about governance.
 *
 * Returns `null` for everything that is not an affirmative team-mode
 * result — loading, an unreachable status endpoint, a cloud backend, and
 * personal mode all leave the UI exactly as it was. Missing settings win
 * over a healthy probe: a team server without its bridge token cannot
 * accept a central approval even when the central API itself is up.
 */
export function describeGovernanceStatus(
  status: GovernanceStatus | null | undefined,
): GovernanceBannerView | null {
  if (status?.deployment_mode !== "team") return null;
  if (status.missing_settings.length > 0) {
    return {
      level: "setup-incomplete",
      missingSettings: status.missing_settings,
    };
  }
  const api = status.central_api;
  if (api?.reachable && api.credentials_ok) return { level: "ok" };
  return { level: "unavailable", detail: api?.error ?? null };
}

/** True only when the server positively reported team mode. */
export function isTeamMode(status: GovernanceStatus | null | undefined) {
  return status?.deployment_mode === "team";
}
