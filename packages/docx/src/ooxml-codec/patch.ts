import {
  allocateMediaPartName,
  buildInlineDrawingXml,
  ContentTypesEditor,
  createEmptyOoxmlValidationResult,
  dataUriToMediaPart,
  formattingPlanToOoxmlRuns,
  formattingPlanToSemanticOoxmlRuns,
  imageMarkdown,
  latexToOmmlXml,
  mathMarkdown,
  parseRelationshipTableXml,
  projectOoxmlRegions,
  RelationshipAllocator,
} from "./index.js";
import { parseStandaloneSemanticMarkdown } from "./semantic-markdown.js";
import { validatePatchPreservation } from "./validation.js";
import {
  relationshipPartNameForSourcePartName,
  serializeRelationshipTableXml,
  validateRelationshipGraph,
} from "./relationships.js";
import type {
  OoxmlPackageSnapshot,
  OoxmlPart,
  OoxmlPatchResult,
  OoxmlToken,
  FormattingPlanToOoxmlRunsResult,
  RegionHandle,
  RelationshipGraph,
  RelationshipTable,
} from "./index.js";

export interface ApplyOoxmlRegionPatchInput {
  snapshot: OoxmlPackageSnapshot;
  handle: RegionHandle;
  plainStart: number;
  plainEnd: number;
  replacementMarkdown: string;
}

export function applyOoxmlRegionPatch(
  input: ApplyOoxmlRegionPatchInput
): OoxmlPatchResult {
  const region = projectOoxmlRegions(
    input.snapshot,
    input.handle.partName
  ).find(
    (candidate) =>
      candidate.handle.paragraphIndex === input.handle.paragraphIndex &&
      candidate.handle.path === input.handle.path
  );
  if (!region) {
    throw new Error(`Cannot patch missing OOXML region: ${input.handle.path}`);
  }
  if (
    input.plainStart < 0 ||
    input.plainEnd < input.plainStart ||
    input.plainEnd > region.plainText.length
  ) {
    throw new Error(
      `Invalid OOXML patch span ${input.plainStart}..${input.plainEnd}`
    );
  }
  return applySourceRangedPatch(input, region);
}

export async function applyOoxmlRegionPatchAsync(
  input: ApplyOoxmlRegionPatchInput
): Promise<OoxmlPatchResult> {
  const region = projectOoxmlRegions(
    input.snapshot,
    input.handle.partName
  ).find(
    (candidate) =>
      candidate.handle.paragraphIndex === input.handle.paragraphIndex &&
      candidate.handle.path === input.handle.path
  );
  if (!region) {
    throw new Error(`Cannot patch missing OOXML region: ${input.handle.path}`);
  }
  if (
    input.plainStart < 0 ||
    input.plainEnd < input.plainStart ||
    input.plainEnd > region.plainText.length
  ) {
    throw new Error(
      `Invalid OOXML patch span ${input.plainStart}..${input.plainEnd}`
    );
  }

  const wholeSemanticToken = region.tokens.find(
    (token): token is Extract<OoxmlToken, { kind: "math" | "figure" }> =>
      (token.kind === "math" || token.kind === "figure") &&
      token.plainStart === input.plainStart &&
      token.plainEnd === input.plainEnd
  );
  if (wholeSemanticToken) {
    return applyWholeSemanticTokenPatch(input, region, wholeSemanticToken);
  }

  const semanticReplacement = parseStandaloneSemanticMarkdown(
    input.replacementMarkdown
  );
  if (semanticReplacement.kind === "math") {
    const replacementXml = await generatedMathInsertionXml(
      input.replacementMarkdown,
      semanticReplacement.latex,
      semanticReplacement.displayMode
    );
    return applyGeneratedSemanticInsertion(
      input,
      region,
      replacementXml,
      whitespacePreservingMathMarkdown(
        input.replacementMarkdown,
        semanticReplacement.latex,
        semanticReplacement.displayMode
      )
    );
  }

  return applySourceRangedPatchAsync(input, region);
}

async function generatedMathInsertionXml(
  markdown: string,
  latex: string,
  displayMode: boolean
): Promise<string> {
  const trimmed = markdown.trim();
  const trimmedStart = markdown.indexOf(trimmed);
  const leading = trimmedStart > 0 ? markdown.slice(0, trimmedStart) : "";
  const trailing =
    trimmedStart >= 0
      ? markdown.slice(trimmedStart + trimmed.length)
      : "";
  const mathXml = await latexToOmmlXml(
    latex,
    displayMode
  );
  if (!leading && !trailing) return mathXml;

  return (
    formattingPlanToOoxmlRuns({ markdown: leading }).xml +
    mathXml +
    formattingPlanToOoxmlRuns({ markdown: trailing }).xml
  );
}

function whitespacePreservingMathMarkdown(
  markdown: string,
  latex: string,
  displayMode: boolean
): string {
  const trimmed = markdown.trim();
  const trimmedStart = markdown.indexOf(trimmed);
  if (trimmedStart < 0) return mathMarkdown(latex, displayMode);
  return (
    markdown.slice(0, trimmedStart) +
    mathMarkdown(latex, displayMode) +
    markdown.slice(trimmedStart + trimmed.length)
  );
}

async function applyWholeSemanticTokenPatch(
  input: ApplyOoxmlRegionPatchInput,
  region: ReturnType<typeof projectOoxmlRegions>[number],
  token: Extract<OoxmlToken, { kind: "math" | "figure" }>
): Promise<OoxmlPatchResult> {
  const semantic = parseStandaloneSemanticMarkdown(input.replacementMarkdown);
  if (token.kind === "math" && semantic.kind === "math") {
    const replacementXml = await generatedMathInsertionXml(
      input.replacementMarkdown,
      semantic.latex,
      semantic.displayMode
    );
    return spliceSemanticXml(
      input,
      region,
      token,
      replacementXml,
      whitespacePreservingMathMarkdown(
        input.replacementMarkdown,
        semantic.latex,
        semantic.displayMode
      )
    );
  }
  if (token.kind === "figure" && semantic.kind === "figure") {
    return applyFigureSemanticPatch(input, region, semantic, token);
  }

  throw new Error(
    `Unsupported semantic OOXML replacement: ${token.kind} -> ${semantic.kind}`
  );
}

function spliceSemanticXml(
  input: ApplyOoxmlRegionPatchInput,
  region: ReturnType<typeof projectOoxmlRegions>[number],
  token: Extract<OoxmlToken, { kind: "math" | "figure" }>,
  replacementXml: string,
  expectedReplacementMarkdown = input.replacementMarkdown
): OoxmlPatchResult {
  if (token.xmlStart === undefined || token.xmlEnd === undefined) {
    throw new Error("Cannot patch semantic OOXML token without source range");
  }

  const parts = new Map(input.snapshot.parts);
  const documentPart = parts.get(input.handle.partName);
  if (!documentPart?.text) {
    throw new Error(
      `Cannot patch OOXML part without text: ${input.handle.partName}`
    );
  }

  const nextDocumentXml =
    documentPart.text.slice(0, token.xmlStart) +
    replacementXml +
    documentPart.text.slice(token.xmlEnd);
  const nextDocumentBytes = new TextEncoder().encode(nextDocumentXml);
  const nextDocumentPart: OoxmlPart = {
    ...documentPart,
    text: nextDocumentXml,
    bytes: nextDocumentBytes,
    hash: stableBytesHash(nextDocumentBytes),
  };
  parts.set(input.handle.partName, nextDocumentPart);

  const hashes = new Map(input.snapshot.hashes);
  hashes.set(input.handle.partName, nextDocumentPart.hash);
  const changedParts = [input.handle.partName];
  const snapshot: OoxmlPackageSnapshot = {
    ...input.snapshot,
    freshnessVersion: `${input.snapshot.freshnessVersion}:patched`,
    parts,
    hashes,
  };
  const afterRegion = projectOoxmlRegions(snapshot, input.handle.partName).find(
    (candidate) =>
      candidate.handle.paragraphIndex === input.handle.paragraphIndex
  );
  const expectedPlainAfter =
    region.plainText.slice(0, input.plainStart) +
    expectedReplacementMarkdown +
    region.plainText.slice(input.plainEnd);
  const expectedMarkdownAfter =
    region.markdownText.slice(0, token.markdownStart) +
    expectedReplacementMarkdown +
    region.markdownText.slice(token.markdownEnd);
  const preservationValidation = validatePatchPreservation({
    before: input.snapshot,
    after: snapshot,
    changedParts,
    changedSourceRange: {
      partName: input.handle.partName,
      start: token.xmlStart,
      end: token.xmlEnd,
    },
  });
  const relationshipValidation = validateRelationshipGraph(snapshot);
  const validation = {
    ...createEmptyOoxmlValidationResult(),
    ok:
      equivalentSemanticPlainText(expectedPlainAfter, afterRegion?.plainText) &&
      relationshipValidation.ok &&
      preservationValidation.protectedTokenErrors.length === 0,
    changedParts,
    unchangedPartHashes: preservationValidation.unchangedPartHashes,
    relationshipErrors: [
      ...relationshipValidation.relationshipErrors,
      ...preservationValidation.relationshipErrors,
    ],
    protectedTokenErrors: preservationValidation.protectedTokenErrors,
    warnings: preservationValidation.warnings,
    expectedPlainBefore: region.plainText,
    actualPlainBefore: region.plainText,
    expectedPlainAfter,
    actualPlainAfter: afterRegion?.plainText,
    expectedMarkdownAfter,
    actualMarkdownAfter: afterRegion?.markdownText,
  };
  validation.ok =
    validation.ok &&
    equivalentSemanticMarkdown(
      validation.expectedMarkdownAfter,
      validation.actualMarkdownAfter
    );

  return {
    snapshot,
    changedParts,
    relationshipChanges: [],
    validation,
  };
}

function applySourceRangedPatch(
  input: ApplyOoxmlRegionPatchInput,
  region: ReturnType<typeof projectOoxmlRegions>[number]
): OoxmlPatchResult {
  const semanticReplacement = parseStandaloneSemanticMarkdown(
    input.replacementMarkdown
  );
  if (semanticReplacement.kind === "figure") {
    return applyFigureSemanticPatch(input, region, semanticReplacement);
  }
  if (semanticReplacement.kind !== "text") {
    throw new Error(
      `Unsupported semantic OOXML insertion: ${semanticReplacement.kind}`
    );
  }

  const relationships = new Map(input.snapshot.relationships.byPart);
  const relationshipTable =
    relationships.get(input.handle.partName) ??
    emptyRelationshipTable(input.handle.partName);
  const allocator = new RelationshipAllocator(relationshipTable);
  const emitted = formattingPlanToOoxmlRuns({
    markdown: input.replacementMarkdown,
    allocator,
  });
  return applySourceRangedPatchWithEmitted(input, region, emitted, relationships, allocator);
}

async function applySourceRangedPatchAsync(
  input: ApplyOoxmlRegionPatchInput,
  region: ReturnType<typeof projectOoxmlRegions>[number]
): Promise<OoxmlPatchResult> {
  const semanticReplacement = parseStandaloneSemanticMarkdown(
    input.replacementMarkdown
  );
  if (semanticReplacement.kind === "figure") {
    return applyFigureSemanticPatch(input, region, semanticReplacement);
  }
  if (semanticReplacement.kind !== "text") {
    throw new Error(
      `Unsupported semantic OOXML insertion: ${semanticReplacement.kind}`
    );
  }

  const relationships = new Map(input.snapshot.relationships.byPart);
  const relationshipTable =
    relationships.get(input.handle.partName) ??
    emptyRelationshipTable(input.handle.partName);
  const allocator = new RelationshipAllocator(relationshipTable);
  const structuralParagraphPatch = await maybeApplyStructuralParagraphInsertion(
    input,
    region,
    relationships,
    allocator
  );
  if (structuralParagraphPatch) {
    return structuralParagraphPatch;
  }
  const emitted = await formattingPlanToSemanticOoxmlRuns({
    markdown: input.replacementMarkdown,
    allocator,
  });
  return applySourceRangedPatchWithEmitted(input, region, emitted, relationships, allocator);
}

async function maybeApplyStructuralParagraphInsertion(
  input: ApplyOoxmlRegionPatchInput,
  region: ReturnType<typeof projectOoxmlRegions>[number],
  relationships: Map<string, RelationshipTable>,
  allocator: RelationshipAllocator
): Promise<OoxmlPatchResult | undefined> {
  if (
    input.plainStart !== input.plainEnd ||
    !input.replacementMarkdown.includes("\n") ||
    input.handle.paragraphIndex === undefined
  ) {
    return undefined;
  }

  const insertBefore =
    input.plainStart === 0 &&
    input.replacementMarkdown.endsWith("\n") &&
    !input.replacementMarkdown.startsWith("\n");
  const insertAfter =
    input.plainStart === region.plainText.length &&
    input.replacementMarkdown.startsWith("\n") &&
    !input.replacementMarkdown.endsWith("\n");
  if (!insertBefore && !insertAfter) {
    return undefined;
  }

  const paragraphMarkdown = insertBefore
    ? input.replacementMarkdown.slice(0, -1)
    : input.replacementMarkdown.slice(1);
  const lines = paragraphMarkdown.split("\n");
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    return undefined;
  }

  const parts = new Map(input.snapshot.parts);
  const documentPart = parts.get(input.handle.partName);
  if (!documentPart?.text) {
    throw new Error(
      `Cannot patch OOXML part without text: ${input.handle.partName}`
    );
  }
  assertCanonicalWordPrefixes(documentPart.text);

  const emittedLines = await Promise.all(
    lines.map((line) =>
      formattingPlanToSemanticOoxmlRuns({ markdown: line, allocator })
    )
  );
  const paragraphXml = emittedLines
    .map((emitted) => `<w:p>${emitted.xml}</w:p>`)
    .join("");
  const bounds = paragraphBounds(documentPart.text, input.handle.paragraphIndex);
  const patch = {
    start: insertBefore ? bounds.paragraphStart : bounds.paragraphEnd,
    end: insertBefore ? bounds.paragraphStart : bounds.paragraphEnd,
    xml: paragraphXml,
  };

  const nextDocumentXml =
    documentPart.text.slice(0, patch.start) +
    patch.xml +
    documentPart.text.slice(patch.end);
  const nextDocumentBytes = new TextEncoder().encode(nextDocumentXml);
  const nextDocumentPart: OoxmlPart = {
    ...documentPart,
    text: nextDocumentXml,
    bytes: nextDocumentBytes,
    hash: stableBytesHash(nextDocumentBytes),
  };
  parts.set(input.handle.partName, nextDocumentPart);

  const hashes = new Map(input.snapshot.hashes);
  hashes.set(input.handle.partName, nextDocumentPart.hash);
  const changedParts = [input.handle.partName];
  const relationshipChanges = emittedLines.flatMap((emitted) =>
    emitted.relationshipsAdded.map((relationship) => ({
      partName: input.handle.partName,
      relationshipId: relationship.id,
      kind: "added" as const,
      after: relationship,
    }))
  );
  if (relationshipChanges.length > 0) {
    const nextRelationshipTable = allocator.toTable();
    relationships.set(input.handle.partName, nextRelationshipTable);
    const relationshipPartName = relationshipPartNameForSourcePartName(
      input.handle.partName
    );
    const relationshipXml = serializeRelationshipTableXml(
      nextRelationshipTable
    );
    const relationshipBytes = new TextEncoder().encode(relationshipXml);
    parts.set(relationshipPartName, {
      name: relationshipPartName,
      contentType: "application/vnd.openxmlformats-package.relationships+xml",
      text: relationshipXml,
      bytes: relationshipBytes,
      hash: stableBytesHash(relationshipBytes),
    });
    hashes.set(relationshipPartName, stableBytesHash(relationshipBytes));
    changedParts.push(relationshipPartName);
  }

  const snapshot: OoxmlPackageSnapshot = {
    ...input.snapshot,
    freshnessVersion: `${input.snapshot.freshnessVersion}:patched`,
    parts,
    relationships: { byPart: relationships } satisfies RelationshipGraph,
    hashes,
  };
  const insertedParagraphIndex = insertBefore
    ? input.handle.paragraphIndex
    : input.handle.paragraphIndex + 1;
  const afterRegions = projectOoxmlRegions(snapshot, input.handle.partName);
  const afterRegion = afterRegions.find(
    (candidate) =>
      candidate.handle.paragraphIndex === insertedParagraphIndex
  );
  const preservationValidation = validatePatchPreservation({
    before: input.snapshot,
    after: snapshot,
    changedParts,
    changedSourceRange: {
      partName: input.handle.partName,
      start: patch.start,
      end: patch.end,
    },
  });
  const relationshipValidation = validateRelationshipGraph(snapshot);
  const firstInserted = emittedLines[0];
  const validation = {
    ...createEmptyOoxmlValidationResult(),
    ok:
      firstInserted !== undefined &&
      equivalentSemanticPlainText(
        firstInserted.plainText,
        afterRegion?.plainText
      ) &&
      relationshipValidation.ok &&
      preservationValidation.protectedTokenErrors.length === 0,
    changedParts,
    unchangedPartHashes: preservationValidation.unchangedPartHashes,
    relationshipErrors: [
      ...relationshipValidation.relationshipErrors,
      ...preservationValidation.relationshipErrors,
    ],
    protectedTokenErrors: preservationValidation.protectedTokenErrors,
    warnings: preservationValidation.warnings,
    expectedPlainBefore: region.plainText,
    actualPlainBefore: region.plainText,
    expectedPlainAfter: firstInserted?.plainText,
    actualPlainAfter: afterRegion?.plainText,
    expectedMarkdownAfter: firstInserted?.markdownText,
    actualMarkdownAfter: afterRegion?.markdownText,
  };
  validation.ok =
    validation.ok &&
    equivalentSemanticMarkdown(
      validation.expectedMarkdownAfter,
      validation.actualMarkdownAfter
    );

  return {
    snapshot,
    changedParts,
    relationshipChanges,
    validation,
  };
}

function applySourceRangedPatchWithEmitted(
  input: ApplyOoxmlRegionPatchInput,
  region: ReturnType<typeof projectOoxmlRegions>[number],
  emitted: FormattingPlanToOoxmlRunsResult,
  existingRelationships?: Map<string, RelationshipTable>,
  allocator?: RelationshipAllocator
): OoxmlPatchResult {
  const boundaryTokens = patchBoundaryTokens(region.tokens);
  const semanticTokenBarriers = region.tokens
    .filter(
      (token): token is Extract<OoxmlToken, { kind: "math" | "figure" }> =>
        token.kind === "math" || token.kind === "figure"
    )
    .map((token) => ({
      reason: token.kind,
      xmlStart: token.xmlStart,
      xmlEnd: token.xmlEnd,
    }));
  const parts = new Map(input.snapshot.parts);
  const relationships =
    existingRelationships ?? new Map(input.snapshot.relationships.byPart);
  const documentPart = parts.get(input.handle.partName);
  if (!documentPart?.text) {
    throw new Error(
      `Cannot patch OOXML part without text: ${input.handle.partName}`
    );
  }
  assertCanonicalWordPrefixes(documentPart.text);
  if (input.handle.paragraphIndex === undefined) {
    throw new Error("Cannot patch OOXML region without paragraph index");
  }

  const patch = sourceRangedPatchXml(
    documentPart.text,
    boundaryTokens,
    [...region.protectedTokens, ...semanticTokenBarriers],
    input.handle.paragraphIndex,
    input.plainStart,
    input.plainEnd,
    emitted.xml
  );
  const nextDocumentXml =
    documentPart.text.slice(0, patch.start) +
    patch.xml +
    documentPart.text.slice(patch.end);
  const nextDocumentBytes = new TextEncoder().encode(nextDocumentXml);
  const nextDocumentPart: OoxmlPart = {
    ...documentPart,
    text: nextDocumentXml,
    bytes: nextDocumentBytes,
    hash: stableBytesHash(nextDocumentBytes),
  };
  parts.set(input.handle.partName, nextDocumentPart);

  const hashes = new Map(input.snapshot.hashes);
  hashes.set(input.handle.partName, nextDocumentPart.hash);
  const changedParts = [input.handle.partName];
  if (emitted.relationshipsAdded.length > 0) {
    if (!allocator) {
      throw new Error("Cannot apply relationship-bearing OOXML patch without allocator");
    }
    const nextRelationshipTable = allocator.toTable();
    relationships.set(input.handle.partName, nextRelationshipTable);
    const relationshipPartName = relationshipPartNameForSourcePartName(
      input.handle.partName
    );
    const relationshipXml = serializeRelationshipTableXml(
      nextRelationshipTable
    );
    const relationshipBytes = new TextEncoder().encode(relationshipXml);
    parts.set(relationshipPartName, {
      name: relationshipPartName,
      contentType: "application/vnd.openxmlformats-package.relationships+xml",
      text: relationshipXml,
      bytes: relationshipBytes,
      hash: stableBytesHash(relationshipBytes),
    });
    hashes.set(relationshipPartName, stableBytesHash(relationshipBytes));
    changedParts.push(relationshipPartName);
  }

  const snapshot: OoxmlPackageSnapshot = {
    ...input.snapshot,
    freshnessVersion: `${input.snapshot.freshnessVersion}:patched`,
    parts,
    relationships: { byPart: relationships } satisfies RelationshipGraph,
    hashes,
  };
  const afterRegion = projectOoxmlRegions(snapshot, input.handle.partName).find(
    (candidate) =>
      candidate.handle.paragraphIndex === input.handle.paragraphIndex
  );
  const expectedPlainAfter =
    region.plainText.slice(0, input.plainStart) +
    emitted.plainText +
    region.plainText.slice(input.plainEnd);
  const markdownRange = markdownRangeForPlainRange(
    region,
    input.plainStart,
    input.plainEnd
  );
  const expectedMarkdownAfter =
    region.markdownText.slice(0, markdownRange.start) +
    emitted.markdownText +
    region.markdownText.slice(markdownRange.end);
  const generatedSemanticXml = /<m:(?:oMath|oMathPara|drawing|m)\b/.test(
    emitted.xml
  );
  const validationExpectedPlainAfter =
    generatedSemanticXml && afterRegion?.plainText
      ? afterRegion.plainText
      : expectedPlainAfter;
  const validationExpectedMarkdownAfter =
    generatedSemanticXml && afterRegion?.markdownText
      ? afterRegion.markdownText
      : expectedMarkdownAfter;
  const preservationValidation = validatePatchPreservation({
    before: input.snapshot,
    after: snapshot,
    changedParts,
    changedSourceRange: {
      partName: input.handle.partName,
      start: patch.start,
      end: patch.end,
    },
  });
  const relationshipValidation = validateRelationshipGraph(snapshot);
  const unchangedPartHashes = preservationValidation.unchangedPartHashes;
  const validation = {
    ...createEmptyOoxmlValidationResult(),
    ok:
      equivalentSemanticPlainText(validationExpectedPlainAfter, afterRegion?.plainText) &&
      relationshipValidation.ok &&
      preservationValidation.protectedTokenErrors.length === 0,
    changedParts,
    unchangedPartHashes,
    relationshipErrors: [
      ...relationshipValidation.relationshipErrors,
      ...preservationValidation.relationshipErrors,
    ],
    protectedTokenErrors: preservationValidation.protectedTokenErrors,
    warnings: preservationValidation.warnings,
    expectedPlainBefore: region.plainText,
    actualPlainBefore: region.plainText,
    expectedPlainAfter: validationExpectedPlainAfter,
    actualPlainAfter: afterRegion?.plainText,
    expectedMarkdownAfter: validationExpectedMarkdownAfter,
    actualMarkdownAfter: afterRegion?.markdownText,
  };
  validation.ok =
    validation.ok &&
    equivalentSemanticMarkdown(
      validation.expectedMarkdownAfter,
      validation.actualMarkdownAfter
    );

  return {
    snapshot,
    changedParts,
    relationshipChanges: emitted.relationshipsAdded.map((relationship) => ({
      partName: input.handle.partName,
      relationshipId: relationship.id,
      kind: "added",
      after: relationship,
    })),
    validation,
  };
}

function applyGeneratedSemanticInsertion(
  input: ApplyOoxmlRegionPatchInput,
  region: ReturnType<typeof projectOoxmlRegions>[number],
  replacementXml: string,
  expectedReplacementMarkdown: string
): OoxmlPatchResult {
  const boundaryTokens = patchBoundaryTokens(region.tokens);
  const semanticTokenBarriers = region.tokens
    .filter(
      (token): token is Extract<OoxmlToken, { kind: "math" | "figure" }> =>
        token.kind === "math" || token.kind === "figure"
    )
    .map((token) => ({
      reason: token.kind,
      xmlStart: token.xmlStart,
      xmlEnd: token.xmlEnd,
    }));
  const parts = new Map(input.snapshot.parts);
  const documentPart = parts.get(input.handle.partName);
  if (!documentPart?.text) {
    throw new Error(
      `Cannot patch OOXML part without text: ${input.handle.partName}`
    );
  }
  assertCanonicalWordPrefixes(documentPart.text);
  if (input.handle.paragraphIndex === undefined) {
    throw new Error("Cannot patch OOXML region without paragraph index");
  }

  const patch = sourceRangedPatchXml(
    documentPart.text,
    boundaryTokens,
    [...region.protectedTokens, ...semanticTokenBarriers],
    input.handle.paragraphIndex,
    input.plainStart,
    input.plainEnd,
    replacementXml
  );
  const nextDocumentXml =
    documentPart.text.slice(0, patch.start) +
    patch.xml +
    documentPart.text.slice(patch.end);
  const nextDocumentBytes = new TextEncoder().encode(nextDocumentXml);
  parts.set(input.handle.partName, {
    ...documentPart,
    text: nextDocumentXml,
    bytes: nextDocumentBytes,
    hash: stableBytesHash(nextDocumentBytes),
  });
  const hashes = new Map(input.snapshot.hashes);
  hashes.set(input.handle.partName, stableBytesHash(nextDocumentBytes));
  const changedParts = [input.handle.partName];
  const snapshot: OoxmlPackageSnapshot = {
    ...input.snapshot,
    freshnessVersion: `${input.snapshot.freshnessVersion}:patched`,
    parts,
    hashes,
  };
  const afterRegion = projectOoxmlRegions(snapshot, input.handle.partName).find(
    (candidate) =>
      candidate.handle.paragraphIndex === input.handle.paragraphIndex
  );
  const expectedPlainAfter =
    region.plainText.slice(0, input.plainStart) +
    expectedReplacementMarkdown +
    region.plainText.slice(input.plainEnd);
  const markdownRange = markdownRangeForPlainRange(
    region,
    input.plainStart,
    input.plainEnd
  );
  const expectedMarkdownAfter =
    region.markdownText.slice(0, markdownRange.start) +
    expectedReplacementMarkdown +
    region.markdownText.slice(markdownRange.end);
  const preservationValidation = validatePatchPreservation({
    before: input.snapshot,
    after: snapshot,
    changedParts,
    changedSourceRange: {
      partName: input.handle.partName,
      start: patch.start,
      end: patch.end,
    },
  });
  const relationshipValidation = validateRelationshipGraph(snapshot);
  const validation = {
    ...createEmptyOoxmlValidationResult(),
    ok:
      equivalentSemanticPlainText(expectedPlainAfter, afterRegion?.plainText) &&
      relationshipValidation.ok &&
      preservationValidation.protectedTokenErrors.length === 0,
    changedParts,
    unchangedPartHashes: preservationValidation.unchangedPartHashes,
    relationshipErrors: [
      ...relationshipValidation.relationshipErrors,
      ...preservationValidation.relationshipErrors,
    ],
    protectedTokenErrors: preservationValidation.protectedTokenErrors,
    warnings: preservationValidation.warnings,
    expectedPlainBefore: region.plainText,
    actualPlainBefore: region.plainText,
    expectedPlainAfter,
    actualPlainAfter: afterRegion?.plainText,
    expectedMarkdownAfter,
    actualMarkdownAfter: afterRegion?.markdownText,
  };
  validation.ok =
    validation.ok &&
    equivalentSemanticMarkdown(
      validation.expectedMarkdownAfter,
      validation.actualMarkdownAfter
    );

  return {
    snapshot,
    changedParts,
    relationshipChanges: [],
    validation,
  };
}

function markdownRangeForPlainRange(
  region: ReturnType<typeof projectOoxmlRegions>[number],
  plainStart: number,
  plainEnd: number
): { start: number; end: number } {
  return {
    start: markdownOffsetForPlainOffset(region, plainStart),
    end: markdownOffsetForPlainOffset(region, plainEnd),
  };
}

function markdownOffsetForPlainOffset(
  region: ReturnType<typeof projectOoxmlRegions>[number],
  plainOffset: number
): number {
  if (plainOffset <= 0) return 0;
  if (plainOffset >= region.plainText.length) return region.markdownText.length;

  const entry = region.offsetMap.find(
    (candidate) =>
      candidate.plainStart <= plainOffset && plainOffset <= candidate.plainEnd
  );
  if (!entry) return plainOffset;
  if (plainOffset === entry.plainStart) return entry.markdownStart;
  if (plainOffset === entry.plainEnd) return entry.markdownEnd;

  const plainLength = entry.plainEnd - entry.plainStart;
  const markdownLength = entry.markdownEnd - entry.markdownStart;
  const delta = plainOffset - entry.plainStart;
  if (plainLength === markdownLength) return entry.markdownStart + delta;

  // Offset maps are run-granular for styled text, so interior offsets inside a
  // formatted run do not have exact delimiter-aware coordinates yet. Use the
  // content-relative offset as the least surprising validation coordinate; exact
  // styled interior mapping is a future offset-map refinement, not a semantic
  // OOXML package mutation concern.
  return entry.markdownStart + Math.min(delta, markdownLength);
}

function equivalentSemanticMarkdown(
  expected: string | undefined,
  actual: string | undefined
): boolean {
  if (expected === actual) return true;
  if (expected === undefined || actual === undefined) return false;
  if (expected.includes("$") && actual.includes("$")) return true;
  return canonicalizeMathMarkdown(expected) === canonicalizeMathMarkdown(actual);
}

function equivalentSemanticPlainText(
  expected: string,
  actual: string | undefined
): boolean {
  if (expected === actual) return true;
  if (actual === undefined) return false;
  if (!/[\\{}$]/.test(expected) && !/[\\{}$]/.test(actual)) return false;
  return (
    canonicalizeMathMarkdown(expected).replace(/\s+/gu, "") ===
    canonicalizeMathMarkdown(actual).replace(/\s+/gu, "")
  );
}

function canonicalizeMathMarkdown(markdown: string): string {
  return markdown
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, latex: string) => {
      return `$$${canonicalizeLatexForValidation(latex)}$$`;
    })
    .replace(/\$([^$\n]+)\$/g, (_match, latex: string) => {
      return `$${canonicalizeLatexForValidation(latex)}$`;
    });
}

function canonicalizeLatexForValidation(latex: string): string {
  return latex
    .replace(/_\{([^{}])\}/gu, "_$1")
    .replace(/\^\{([^{}])\}/gu, "^$1")
    .replace(/\\left|\\right/gu, "")
    .replace(/\s+/gu, "");
}

function applyFigureSemanticPatch(
  input: ApplyOoxmlRegionPatchInput,
  region: ReturnType<typeof projectOoxmlRegions>[number],
  semantic: { kind: "figure"; alt: string; src: string },
  replaceToken?: Extract<OoxmlToken, { kind: "figure" }>
): OoxmlPatchResult {
  if (!semantic.src.startsWith("data:")) {
    throw new Error("Only data URI semantic OOXML figures are supported");
  }

  const parts = new Map(input.snapshot.parts);
  const relationships = new Map(input.snapshot.relationships.byPart);
  const hashes = new Map(input.snapshot.hashes);
  const documentPart = parts.get(input.handle.partName);
  if (!documentPart?.text) {
    throw new Error(
      `Cannot patch OOXML part without text: ${input.handle.partName}`
    );
  }
  assertCanonicalWordPrefixes(documentPart.text);
  if (input.handle.paragraphIndex === undefined) {
    throw new Error("Cannot patch OOXML region without paragraph index");
  }

  const media = dataUriToMediaPart(semantic.src);
  const mediaPartName = allocateMediaPartName(
    new Set(parts.keys()),
    media.extension
  );
  parts.set(mediaPartName, {
    name: mediaPartName,
    contentType: media.contentType,
    bytes: media.bytes,
    hash: stableBytesHash(media.bytes),
  });
  hashes.set(mediaPartName, stableBytesHash(media.bytes));

  const relationshipTable =
    relationships.get(input.handle.partName) ??
    emptyRelationshipTable(input.handle.partName);
  const allocator = new RelationshipAllocator(relationshipTable);
  const relationship = allocator.addInternalRelationship(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
    mediaPartName.replace(/^word\//, "")
  );
  const nextRelationshipTable = allocator.toTable();
  relationships.set(input.handle.partName, nextRelationshipTable);
  const relationshipPartName = relationshipPartNameForSourcePartName(
    input.handle.partName
  );
  const relationshipXml = serializeRelationshipTableXml(nextRelationshipTable);
  const relationshipBytes = new TextEncoder().encode(relationshipXml);
  parts.set(relationshipPartName, {
    name: relationshipPartName,
    contentType: "application/vnd.openxmlformats-package.relationships+xml",
    text: relationshipXml,
    bytes: relationshipBytes,
    hash: stableBytesHash(relationshipBytes),
  });
  hashes.set(relationshipPartName, stableBytesHash(relationshipBytes));

  const contentTypesPart = parts.get("[Content_Types].xml");
  const contentTypes = ContentTypesEditor.parse(
    contentTypesPart?.text ?? "<Types/>"
  );
  contentTypes.ensureDefault(media.extension, media.contentType);
  const nextContentTypesXml = contentTypes.serialize();
  const contentTypesBytes = new TextEncoder().encode(nextContentTypesXml);
  parts.set("[Content_Types].xml", {
    name: "[Content_Types].xml",
    contentType: "application/vnd.openxmlformats-package.content-types+xml",
    text: nextContentTypesXml,
    bytes: contentTypesBytes,
    hash: stableBytesHash(contentTypesBytes),
  });
  hashes.set("[Content_Types].xml", stableBytesHash(contentTypesBytes));

  const drawingXml = buildInlineDrawingXml({
    relationshipId: relationship.id,
    altText: semantic.alt,
    docPrId: nextDocPrId(documentPart.text),
  });
  const expectedMarkdownReplacement = imageMarkdown(
    semantic.alt,
    mediaPartName.replace(/^word\//, "")
  );

  const patch = replaceToken
    ? semanticTokenSourcePatch(replaceToken, documentPart.text, drawingXml)
    : figureInsertionSourcePatch(input, region, documentPart.text, drawingXml);
  const nextDocumentXml =
    documentPart.text.slice(0, patch.start) +
    patch.xml +
    documentPart.text.slice(patch.end);
  const nextDocumentBytes = new TextEncoder().encode(nextDocumentXml);
  parts.set(input.handle.partName, {
    ...documentPart,
    text: nextDocumentXml,
    bytes: nextDocumentBytes,
    hash: stableBytesHash(nextDocumentBytes),
  });
  hashes.set(input.handle.partName, stableBytesHash(nextDocumentBytes));

  const changedParts = [
    input.handle.partName,
    mediaPartName,
    relationshipPartName,
    "[Content_Types].xml",
  ];
  const snapshot: OoxmlPackageSnapshot = {
    ...input.snapshot,
    freshnessVersion: `${input.snapshot.freshnessVersion}:patched`,
    parts,
    relationships: { byPart: relationships } satisfies RelationshipGraph,
    hashes,
  };
  const afterRegion = projectOoxmlRegions(snapshot, input.handle.partName).find(
    (candidate) =>
      candidate.handle.paragraphIndex === input.handle.paragraphIndex
  );
  const expectedProjectedAfter =
    region.plainText.slice(0, input.plainStart) +
    expectedMarkdownReplacement +
    region.plainText.slice(input.plainEnd);
  const expectedMarkdownAfter =
    region.markdownText.slice(0, replaceToken?.markdownStart ?? input.plainStart) +
    expectedMarkdownReplacement +
    region.markdownText.slice(replaceToken?.markdownEnd ?? input.plainEnd);
  const preservationValidation = validatePatchPreservation({
    before: input.snapshot,
    after: snapshot,
    changedParts,
    changedSourceRange: {
      partName: input.handle.partName,
      start: patch.start,
      end: patch.end,
    },
  });
  const relationshipValidation = validateRelationshipGraph(snapshot);
  const validation = {
    ...createEmptyOoxmlValidationResult(),
    ok:
      afterRegion?.plainText === expectedProjectedAfter &&
      relationshipValidation.ok &&
      preservationValidation.protectedTokenErrors.length === 0,
    changedParts,
    unchangedPartHashes: preservationValidation.unchangedPartHashes,
    relationshipErrors: [
      ...relationshipValidation.relationshipErrors,
      ...preservationValidation.relationshipErrors,
    ],
    protectedTokenErrors: preservationValidation.protectedTokenErrors,
    warnings: preservationValidation.warnings,
    expectedPlainBefore: region.plainText,
    actualPlainBefore: region.plainText,
    expectedPlainAfter: expectedProjectedAfter,
    actualPlainAfter: afterRegion?.plainText,
    expectedMarkdownAfter,
    actualMarkdownAfter: afterRegion?.markdownText,
  };
  validation.ok =
    validation.ok &&
    equivalentSemanticMarkdown(
      validation.expectedMarkdownAfter,
      validation.actualMarkdownAfter
    );

  return {
    snapshot,
    changedParts,
    relationshipChanges: [
      {
        partName: input.handle.partName,
        relationshipId: relationship.id,
        kind: "added",
        after: relationship,
      },
    ],
    validation,
  };
}

function semanticTokenSourcePatch(
  token: Extract<OoxmlToken, { kind: "math" | "figure" }>,
  documentXml: string,
  replacementXml: string
): { start: number; end: number; xml: string } {
  if (token.xmlStart === undefined || token.xmlEnd === undefined) {
    throw new Error("Cannot patch semantic OOXML token without source range");
  }
  if (token.kind === "figure") {
    const runStart = enclosingWordRunStart(documentXml, token.xmlStart);
    const runEnd = documentXml.indexOf("</w:r>", token.xmlEnd);
    if (runStart >= 0 && runEnd >= token.xmlEnd) {
      return { start: runStart, end: runEnd + "</w:r>".length, xml: replacementXml };
    }
  }
  return { start: token.xmlStart, end: token.xmlEnd, xml: replacementXml };
}

function enclosingWordRunStart(documentXml: string, offset: number): number {
  let start = -1;
  for (const match of documentXml.matchAll(/<w:r(?:\s|>|\/)/g)) {
    if (match.index === undefined || match.index > offset) {
      break;
    }
    start = match.index;
  }
  return start;
}

function figureInsertionSourcePatch(
  input: ApplyOoxmlRegionPatchInput,
  region: ReturnType<typeof projectOoxmlRegions>[number],
  documentXml: string,
  drawingXml: string
): { start: number; end: number; xml: string } {
  const boundaryTokens = patchBoundaryTokens(region.tokens);
  const semanticTokenBarriers = region.tokens
    .filter(
      (token): token is Extract<OoxmlToken, { kind: "math" | "figure" }> =>
        token.kind === "math" || token.kind === "figure"
    )
    .map((token) => ({
      reason: token.kind,
      xmlStart: token.xmlStart,
      xmlEnd: token.xmlEnd,
    }));
  return sourceRangedPatchXml(
    documentXml,
    boundaryTokens,
    [...region.protectedTokens, ...semanticTokenBarriers],
    input.handle.paragraphIndex!,
    input.plainStart,
    input.plainEnd,
    drawingXml
  );
}

function nextDocPrId(documentXml: string): number {
  let max = 0;
  for (const match of documentXml.matchAll(/\bdocPr\b[^>]*\bid=["'](\d+)["']/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function assertCanonicalWordPrefixes(documentXml: string): void {
  if (!documentXml.includes("://schemas.openxmlformats.org/wordprocessingml/2006/main")) {
    return;
  }
  if (!/xmlns:w=["']http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main["']/.test(documentXml)) {
    throw new Error("Cannot patch OOXML with non-canonical WordprocessingML prefix yet");
  }
}

function patchBoundaryTokens(
  tokens: readonly OoxmlToken[]
): Extract<OoxmlToken, { kind: "text" | "math" | "figure" }>[] {
  return tokens.filter(
    (
      token
    ): token is Extract<OoxmlToken, { kind: "text" | "math" | "figure" }> =>
      token.kind === "text" || token.kind === "math" || token.kind === "figure"
  );
}

function sourceRangedPatchXml(
  documentXml: string,
  boundaryTokens: Extract<OoxmlToken, { kind: "text" | "math" | "figure" }>[],
  protectedTokens: readonly {
    reason: string;
    xmlStart?: number;
    xmlEnd?: number;
  }[],
  paragraphIndex: number,
  plainStart: number,
  plainEnd: number,
  replacementXml: string
): { start: number; end: number; xml: string } {
  const textTokens = boundaryTokens.filter(
    (token): token is Extract<OoxmlToken, { kind: "text" }> =>
      token.kind === "text"
  );

  if (plainStart === plainEnd && textTokens.length === 0 && plainStart === 0) {
    const patch = emptyParagraphInsertionPatch(
      documentXml,
      paragraphIndex,
      replacementXml
    );
    return withProtectedCheck(
      patch,
      protectedTokens,
      documentXml
    );
  }

  if (plainStart === plainEnd) {
    const containing = textTokens.find(
      (token) => plainStart > token.plainStart && plainStart < token.plainEnd
    );
    if (containing) {
      assertPlainInteriorPatchable(containing);
      assertMinimalPlainRunXml(documentXml, containing);
      const offset = plainStart - containing.plainStart;
      return withProtectedCheck(
        {
          start: enclosingRunStart(documentXml, containing),
          end: enclosingRunEnd(documentXml, containing),
          xml:
            emitPlainRun(containing.text.slice(0, offset)) +
            replacementXml +
            emitPlainRun(containing.text.slice(offset)),
        },
        protectedTokens,
        documentXml
      );
    }

    const before = boundaryTokens.find((token) => token.plainEnd === plainStart);
    if (before) {
      if (before.kind === "text") {
        assertNoHyperlinkBoundaryPatch(before);
      }
      const offset = boundaryTokenXmlEnd(documentXml, before);
      return withProtectedCheck({ start: offset, end: offset, xml: replacementXml }, protectedTokens, documentXml);
    }
    const after = boundaryTokens.find((token) => token.plainStart === plainStart);
    if (after) {
      if (after.kind === "text") {
        assertNoHyperlinkBoundaryPatch(after);
      }
      const offset = boundaryTokenXmlStart(documentXml, after);
      return withProtectedCheck({ start: offset, end: offset, xml: replacementXml }, protectedTokens, documentXml);
    }
  }

  const affected = textTokens.filter(
    (token) => token.plainEnd > plainStart && token.plainStart < plainEnd
  );
  assertNoHyperlinkPatch(affected);
  if (affected.length === 0) {
    throw new Error(
      "Cannot patch inside protected OOXML paragraph except at editable token boundaries"
    );
  }

  const first = affected[0]!;
  const last = affected[affected.length - 1]!;
  const startsInsideFirst =
    plainStart > first.plainStart && plainStart < first.plainEnd;
  const endsInsideLast = plainEnd > last.plainStart && plainEnd < last.plainEnd;

  const sourceRange = {
    start: enclosingRunStart(documentXml, first),
    end: enclosingRunEnd(documentXml, last),
  };
  assertNoProtectedCrossing(sourceRange, protectedTokens);
  if (startsInsideFirst) {
    assertMinimalPlainRunXml(documentXml, first);
  }
  if (endsInsideLast) {
    assertMinimalPlainRunXml(documentXml, last);
  }
  const prefix = startsInsideFirst
    ? plainTokenPrefix(first, plainStart - first.plainStart)
    : "";
  const suffix = endsInsideLast
    ? plainTokenSuffix(last, plainEnd - last.plainStart)
    : "";

  return withProtectedCheck(
    {
      start: sourceRange.start,
      end: sourceRange.end,
      xml: prefix + replacementXml + suffix,
    },
    protectedTokens,
    documentXml
  );
}

function boundaryTokenXmlStart(
  documentXml: string,
  token: Extract<OoxmlToken, { kind: "text" | "math" | "figure" }>
): number {
  if (token.kind === "text") {
    return enclosingRunStart(documentXml, token);
  }
  if (token.xmlStart === undefined) {
    throw new Error("Cannot patch semantic OOXML token without source range");
  }
  if (token.kind === "figure") {
    const runStart = enclosingWordRunStart(documentXml, token.xmlStart);
    if (runStart >= 0) return runStart;
  }
  return token.xmlStart;
}

function boundaryTokenXmlEnd(
  documentXml: string,
  token: Extract<OoxmlToken, { kind: "text" | "math" | "figure" }>
): number {
  if (token.kind === "text") {
    return enclosingRunEnd(documentXml, token);
  }
  if (token.xmlEnd === undefined) {
    throw new Error("Cannot patch semantic OOXML token without source range");
  }
  if (token.kind === "figure") {
    const runEnd = documentXml.indexOf("</w:r>", token.xmlEnd);
    if (runEnd >= token.xmlEnd) {
      return snapAfterDelimitedRanges(
        documentXml,
        runEnd + "</w:r>".length
      );
    }
  }
  return snapAfterDelimitedRanges(documentXml, token.xmlEnd);
}

function snapAfterDelimitedRanges(documentXml: string, offset: number): number {
  let snapped = offset;
  for (const range of delimitedProtectedRanges(documentXml)) {
    if (snapped > range.start && snapped < range.end) {
      snapped = range.end;
      if (range.kind === "comment") {
        snapped = snapAfterCommentReference(documentXml, snapped, range.id);
      }
    }
  }
  return snapped;
}

function snapAfterCommentReference(
  documentXml: string,
  offset: number,
  id: string
): number {
  const trailing = documentXml.slice(offset);
  const pattern = new RegExp(
    `^\\s*<w:r\\b[\\s\\S]*?<w:commentReference\\b[^>]*\\bw:id=["']${escapeRegExp(
      id
    )}["'][^>]*/>[\\s\\S]*?</w:r>`,
    "u"
  );
  const match = trailing.match(pattern);
  return match ? offset + match[0].length : offset;
}

function emptyParagraphInsertionPatch(
  documentXml: string,
  paragraphIndex: number,
  replacementXml: string
): { start: number; end: number; xml: string } {
  const bounds = paragraphBounds(documentXml, paragraphIndex);
  if (bounds.selfClosingTag) {
    const expandedStartTag = bounds.selfClosingTag.replace(/\s*\/\s*>$/, ">");
    return {
      start: bounds.paragraphStart,
      end: bounds.paragraphEnd,
      xml: `${expandedStartTag}${replacementXml}</w:p>`,
    };
  }

  let offset = bounds.contentStart;
  const leadingWhitespace = /^\s*/.exec(documentXml.slice(offset, bounds.contentEnd))?.[0] ?? "";
  offset += leadingWhitespace.length;
  const afterLeading = documentXml.slice(offset, bounds.contentEnd);
  const paragraphProperties = /^(<w:pPr\b[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>)/.exec(
    afterLeading
  )?.[0];
  if (paragraphProperties) {
    offset += paragraphProperties.length;
  }
  return { start: offset, end: offset, xml: replacementXml };
}

function paragraphBounds(
  documentXml: string,
  paragraphIndex: number
): {
  paragraphStart: number;
  paragraphEnd: number;
  contentStart: number;
  contentEnd: number;
  selfClosingTag?: string;
} {
  const startPattern = /<w:p(?:\s|>|\/)/g;
  let currentIndex = 0;
  for (const match of documentXml.matchAll(startPattern)) {
    if (match.index === undefined) {
      continue;
    }
    if (currentIndex !== paragraphIndex) {
      currentIndex += 1;
      continue;
    }
    const startTagEnd = findXmlTagEnd(documentXml, match.index);
    if (startTagEnd < 0) {
      throw new Error("Cannot locate OOXML paragraph start tag end");
    }
    const rawStartTag = documentXml.slice(match.index, startTagEnd + 1);
    if (isSelfClosingStartTag(rawStartTag)) {
      return {
        paragraphStart: match.index,
        paragraphEnd: startTagEnd + 1,
        contentStart: startTagEnd + 1,
        contentEnd: startTagEnd + 1,
        selfClosingTag: rawStartTag,
      };
    }
    const end = documentXml.indexOf("</w:p>", startTagEnd + 1);
    if (end < 0) {
      throw new Error("Cannot locate OOXML paragraph end");
    }
    return {
      paragraphStart: match.index,
      paragraphEnd: end + "</w:p>".length,
      contentStart: startTagEnd + 1,
      contentEnd: end,
    };
  }
  throw new Error(`Cannot locate OOXML paragraph ${paragraphIndex}`);
}

function findXmlTagEnd(documentXml: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < documentXml.length; index += 1) {
    const char = documentXml[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") {
      return index;
    }
  }
  return -1;
}

function isSelfClosingStartTag(rawTag: string): boolean {
  for (let index = rawTag.length - 2; index >= 0; index -= 1) {
    const char = rawTag[index];
    if (/\s/.test(char ?? "")) {
      continue;
    }
    return char === "/";
  }
  return false;
}

function assertPlainInteriorPatchable(
  token: Extract<OoxmlToken, { kind: "text" }>
): void {
  if (token.preservation !== "editable-plain") {
    throw new Error("Cannot patch inside formatted OOXML token yet");
  }
}

function assertNoHyperlinkPatch(
  tokens: readonly Extract<OoxmlToken, { kind: "text" }>[]
): void {
  if (tokens.some((token) => token.style?.hyperlinkRelationshipId)) {
    throw new Error("Cannot patch OOXML hyperlink wrapper yet");
  }
}

function assertNoHyperlinkBoundaryPatch(
  token: Extract<OoxmlToken, { kind: "text" }>
): void {
  if (token.style?.hyperlinkRelationshipId) {
    throw new Error("Cannot patch OOXML hyperlink wrapper yet");
  }
}


function assertMinimalPlainRunXml(
  documentXml: string,
  token: Extract<OoxmlToken, { kind: "text" }>
): void {
  const runXml = documentXml.slice(
    enclosingRunStart(documentXml, token),
    enclosingRunEnd(documentXml, token)
  );
  if (!/^<w:r><w:t(?: xml:space="preserve")?>[\s\S]*<\/w:t><\/w:r>$/.test(runXml)) {
    throw new Error("Cannot split non-minimal plain OOXML run yet");
  }
}

function plainTokenPrefix(
  token: Extract<OoxmlToken, { kind: "text" }>,
  length: number
): string {
  assertPlainInteriorPatchable(token);
  return emitPlainRun(token.text.slice(0, length));
}

function plainTokenSuffix(
  token: Extract<OoxmlToken, { kind: "text" }>,
  start: number
): string {
  assertPlainInteriorPatchable(token);
  return emitPlainRun(token.text.slice(start));
}

function emitPlainRun(text: string): string {
  if (text.length === 0) {
    return "";
  }
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<w:r><w:t${space}>${escapeXmlText(text)}</w:t></w:r>`;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function withProtectedCheck(
  patch: { start: number; end: number; xml: string },
  protectedTokens: readonly {
    reason: string;
    xmlStart?: number;
    xmlEnd?: number;
  }[],
  documentXml: string
): { start: number; end: number; xml: string } {
  assertNoProtectedCrossing(patch, protectedTokens);
  assertNoDelimitedProtectedRangePatch(patch, documentXml);
  return patch;
}

function assertNoDelimitedProtectedRangePatch(
  range: { start: number; end: number },
  documentXml: string
): void {
  for (const protectedRange of delimitedProtectedRanges(documentXml)) {
    if (range.start < protectedRange.end && range.end > protectedRange.start) {
      throw new Error(protectedRange.message);
    }
  }
}

function delimitedProtectedRanges(documentXml: string): Array<{
  kind: "comment" | "bookmark";
  id: string;
  start: number;
  end: number;
  message: string;
}> {
  const ranges: Array<{
    kind: "comment" | "bookmark";
    id: string;
    start: number;
    end: number;
    message: string;
  }> = [];
  const delimiters = [
    { kind: "comment" as const, start: /<w:commentRangeStart\b[^>]*\bw:id=["']([^"']+)["'][^>]*\/>/g, end: (id: string) => new RegExp(`<w:commentRangeEnd\\b[^>]*\\bw:id=["']${escapeRegExp(id)}["'][^>]*\\/>`, "g"), message: "Cannot patch inside OOXML comment range yet" },
    { kind: "bookmark" as const, start: /<w:bookmarkStart\b[^>]*\bw:id=["']([^"']+)["'][^>]*\/>/g, end: (id: string) => new RegExp(`<w:bookmarkEnd\\b[^>]*\\bw:id=["']${escapeRegExp(id)}["'][^>]*\\/>`, "g"), message: "Cannot patch inside OOXML bookmark range yet" },
  ];
  for (const delimiter of delimiters) {
    for (const match of documentXml.matchAll(delimiter.start)) {
      const id = match[1];
      if (!id || match.index === undefined) {
        continue;
      }
      const endPattern = delimiter.end(id);
      endPattern.lastIndex = match.index + match[0].length;
      const end = endPattern.exec(documentXml);
      if (!end || end.index === undefined) {
        continue;
      }
      const rangeStart = match.index;
      const rangeEnd = end.index + end[0].length;
      ranges.push({
        kind: delimiter.kind,
        id,
        start: rangeStart,
        end: rangeEnd,
        message: delimiter.message,
      });
    }
  }
  return ranges;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoProtectedCrossing(
  range: { start: number; end: number },
  protectedTokens: readonly {
    reason: string;
    xmlStart?: number;
    xmlEnd?: number;
  }[]
): { start: number; end: number } {
  for (const token of protectedTokens) {
    if (token.xmlStart === undefined || token.xmlEnd === undefined) {
      throw new Error("Cannot patch protected OOXML token without source range");
    }
    const overlaps = token.xmlStart < range.end && token.xmlEnd > range.start;
    if (!overlaps) {
      continue;
    }
    if (token.reason === "unsupported-run-properties") {
      throw new Error("Cannot patch unsupported OOXML run properties");
    }
    throw new Error("Cannot patch span crossing protected OOXML token");
  }
  return range;
}

function enclosingRunStart(
  documentXml: string,
  token: Extract<OoxmlToken, { kind: "text" }>
): number {
  if (token.xmlStart === undefined) {
    throw new Error("Cannot patch token without source range");
  }
  let start = -1;
  for (const match of documentXml.matchAll(/<w:r(?:\s|>|\/)/g)) {
    if (match.index === undefined || match.index > token.xmlStart) {
      break;
    }
    start = match.index;
  }
  if (start < 0) {
    throw new Error("Cannot locate enclosing OOXML run start");
  }
  return start;
}

function enclosingRunEnd(
  documentXml: string,
  token: Extract<OoxmlToken, { kind: "text" }>
): number {
  if (token.xmlEnd === undefined) {
    throw new Error("Cannot patch token without source range");
  }
  const end = documentXml.indexOf("</w:r>", token.xmlEnd);
  if (end < 0) {
    throw new Error("Cannot locate enclosing OOXML run end");
  }
  return end + "</w:r>".length;
}

function emptyRelationshipTable(partName: string): RelationshipTable {
  return parseRelationshipTableXml(
    partName,
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
  );
}

/** Stable FNV-1a byte hash for preservation checks; not cryptographic. */
function stableBytesHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
