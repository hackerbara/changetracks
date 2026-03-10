/**
 * Project-level review configuration.
 *
 * Governs whether a reason is required when accepting, rejecting, or
 * requesting changes — independently for human and agent harnesses.
 */

export interface ReasonRequirement {
  /** Human harness (VS Code UI) — default: false (optional). */
  human: boolean;
  /** Agent harness (CLI/MCP) — default: true (required). */
  agent: boolean;
}

export interface ProjectReviewConfig {
  reasonRequired: ReasonRequirement;
}

const DEFAULT_REASON_REQUIREMENT: ReasonRequirement = {
  human: false,
  agent: true,
};

/**
 * Parse project review config from a raw config object.
 *
 * Accepts the shape produced by TOML parsing or VS Code settings.
 * Missing fields fall back to defaults (human: optional, agent: required).
 *
 * Expected input shape:
 * ```
 * { review: { reason_required: { human: true, agent: false } } }
 * ```
 */
export function parseProjectConfig(raw: Record<string, any>): ProjectReviewConfig {
  const review = raw?.review;
  const reasonRaw = review?.reason_required;

  if (!reasonRaw || typeof reasonRaw !== 'object') {
    return { reasonRequired: { ...DEFAULT_REASON_REQUIREMENT } };
  }

  return {
    reasonRequired: {
      human: typeof reasonRaw.human === 'boolean' ? reasonRaw.human : DEFAULT_REASON_REQUIREMENT.human,
      agent: typeof reasonRaw.agent === 'boolean' ? reasonRaw.agent : DEFAULT_REASON_REQUIREMENT.agent,
    },
  };
}
