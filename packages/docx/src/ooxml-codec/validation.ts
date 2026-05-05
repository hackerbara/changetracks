import { projectOoxmlRegions } from "./region.js";
import { validateRelationshipGraph } from "./relationships.js";
import type { OoxmlPackageSnapshot, OoxmlValidationResult } from "./index.js";

export interface ValidatePatchPreservationInput {
  before: OoxmlPackageSnapshot;
  after: OoxmlPackageSnapshot;
  changedParts: readonly string[];
  changedSourceRange?: { partName: string; start: number; end: number };
}

export function validatePatchPreservation(
  input: ValidatePatchPreservationInput
): Pick<
  OoxmlValidationResult,
  | "unchangedPartHashes"
  | "relationshipErrors"
  | "protectedTokenErrors"
  | "warnings"
> {
  const changed = new Set(input.changedParts);
  const unchangedPartHashes: Record<string, string> = {};
  const protectedTokenErrors: string[] = [];
  const warnings: string[] = [];

  for (const [partName, beforeHash] of input.before.hashes) {
    if (!changed.has(partName)) {
      unchangedPartHashes[partName] = beforeHash;
      const afterHash = input.after.hashes.get(partName);
      if (afterHash !== beforeHash) {
        protectedTokenErrors.push(
          `Unchanged part hash changed for ${partName}: expected ${beforeHash}, got ${afterHash}`
        );
      }
    }
  }

  if (input.changedSourceRange) {
    validateUnchangedTokenSlices(input, protectedTokenErrors);
  } else {
    warnings.push("No changed source range supplied for token preservation validation");
  }

  const relationshipValidation = validateRelationshipGraph(input.after);
  return {
    unchangedPartHashes,
    relationshipErrors: relationshipValidation.relationshipErrors,
    protectedTokenErrors,
    warnings,
  };
}

function validateUnchangedTokenSlices(
  input: ValidatePatchPreservationInput,
  errors: string[]
): void {
  const range = input.changedSourceRange!;
  const beforePart = input.before.parts.get(range.partName);
  const afterPart = input.after.parts.get(range.partName);
  if (!beforePart?.text || !afterPart?.text) {
    errors.push(`Cannot validate token preservation without text for ${range.partName}`);
    return;
  }

  const beforeRegions = projectOoxmlRegions(input.before, range.partName);
  const afterRegions = projectOoxmlRegions(input.after, range.partName);
  const beforeTokens = beforeRegions.flatMap((region) => region.tokens);
  const afterTokens = afterRegions.flatMap((region) => region.tokens);

  for (const token of beforeTokens) {
    if (token.xmlStart === undefined || token.xmlEnd === undefined) {
      errors.push(`Token without source range in ${range.partName}: ${token.path}`);
      continue;
    }
    const overlaps = token.xmlStart < range.end && token.xmlEnd > range.start;
    if (overlaps) {
      continue;
    }
    const expectedXml = beforePart.text.slice(token.xmlStart, token.xmlEnd);
    if (!afterPart.text.includes(expectedXml)) {
      errors.push(`Unchanged token XML changed or missing at ${token.path}`);
    }
  }
}
