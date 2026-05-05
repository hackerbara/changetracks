import { computeCurrentText, splitBodyAndFootnotes } from "@changedown/core";
import { createOoxmlPackageCodec } from "./codec.js";
import { createEmptyOoxmlValidationResult, stableBytesHash } from "./index.js";
import { markdownTableToOoxml, parseMarkdownTable } from "./tables.js";
import type { ApplyPackageDeltaInput, CodecDiagnostic, CodecProjection } from "./codec.js";
import type {
  OoxmlPackageSnapshot,
  OoxmlPart,
  OoxmlRegionProjection,
  OoxmlTableProjection,
  OoxmlToken,
} from "./index.js";

export interface RenderTransitionForCompareInput {
  priorProjection: CodecProjection;
  oldWireSource: string;
  newWireSource: string;
  ooxmlSnapshot: OoxmlPackageSnapshot;
  intent: {
    author: string;
    changeId: string;
    commentText?: string;
    commentInitials?: string;
    compareTarget: "current" | "new";
  };
}

export interface CompareWitnessHint {
  kind: "paragraph" | "table" | "comment" | "revision";
  sourceLine?: number;
  paragraphIndex?: number;
  tableIndex?: number;
}

export interface RenderTransitionForCompareResult {
  revisedPackage: OoxmlPackageSnapshot;
  expectedProjection: CodecProjection;
  witnessHints: readonly CompareWitnessHint[];
  diagnostics: readonly CodecDiagnostic[];
}

export type SourceTransitionTopology =
  | {
      kind: "inline-insert";
      start: number;
      insertedMarkdown: string;
    }
  | {
      kind: "block-insert";
      start: number;
      insertedMarkdown: string;
      blockKind: "paragraphs" | "table" | "math";
    }
  | {
      kind: "replace";
      start: number;
      oldMarkdown: string;
      newMarkdown: string;
    }
  | {
      kind: "delete";
      start: number;
      oldMarkdown: string;
    };

interface ProjectionBlock {
  readonly kind: "paragraph" | "table";
  readonly start: number;
  readonly end: number;
  readonly markdownText: string;
  readonly xmlStart: number;
  readonly region?: OoxmlRegionProjection;
  readonly table?: OoxmlTableProjection;
}

export function normalizeSourceForWordTransition(source: string): string {
  return source.endsWith("\n") ? source : `${source}\n`;
}

export function classifySourceTransition(
  oldSourceInput: string,
  newSourceInput: string
): SourceTransitionTopology {
  const oldSource = normalizeSourceForWordTransition(oldSourceInput);
  const newSource = normalizeSourceForWordTransition(newSourceInput);

  const oldAsContiguousBlock = newSource.indexOf(oldSource);
  if (oldSource.length > 0 && oldAsContiguousBlock >= 0 && newSource !== oldSource) {
    const insertedMarkdown =
      newSource.slice(0, oldAsContiguousBlock) +
      newSource.slice(oldAsContiguousBlock + oldSource.length);
    const insertionStart = oldAsContiguousBlock === 0 ? oldSource.length : 0;
    return classifyInsertion(insertionStart, insertedMarkdown, oldSource, newSource);
  }

  const prefix = commonPrefixLength(oldSource, newSource);
  const suffix = commonSuffixLength(oldSource, newSource, prefix);
  const oldMiddle = oldSource.slice(prefix, oldSource.length - suffix);
  const newMiddle = newSource.slice(prefix, newSource.length - suffix);

  if (oldMiddle.length === 0 && newMiddle.length > 0) {
    return classifyInsertion(prefix, newMiddle, oldSource, newSource);
  }

  if (oldMiddle.length > 0 && newMiddle.length === 0) {
    return { kind: "delete", start: prefix, oldMarkdown: oldMiddle };
  }

  return { kind: "replace", start: prefix, oldMarkdown: oldMiddle, newMarkdown: newMiddle };
}

export async function renderTransitionForCompare(
  input: RenderTransitionForCompareInput
): Promise<RenderTransitionForCompareResult> {
  let oldCurrentBody = normalizeBodyForProjectionComparison(
    currentBodyFromWireSource(input.oldWireSource)
  );
  let newCurrentBody = normalizeBodyForProjectionComparison(
    currentBodyFromWireSource(input.newWireSource)
  );
  const priorBody = normalizeBodyForProjectionComparison(
    input.priorProjection.bodyMarkdown
  );
  if (
    oldCurrentBody !== priorBody &&
    oldCurrentBody.startsWith("\n") &&
    oldCurrentBody.slice(1) === priorBody
  ) {
    // A cold-start Word source keeps a leading blank line as the patchable
    // paragraph anchor. After the first compare proposal, the native Word body
    // no longer has that paragraph, but the L2 wire source still carries the
    // blank anchor before the proposed block. Remove it from both sides before
    // computing the source transition; it is routing scaffolding, not document
    // content.
    oldCurrentBody = oldCurrentBody.slice(1);
    if (newCurrentBody.startsWith("\n")) {
      newCurrentBody = newCurrentBody.slice(1);
    }
  }

  if (
    oldCurrentBody !== priorBody &&
    priorBody === "" &&
    oldCurrentBody.length > 0 &&
    (hasMarkdownBlockStructure(newCurrentBody) ||
      hasSupersedeMetadata(input.newWireSource))
  ) {
    // Supersede chains can leave Word's native body temporarily blank after
    // rejecting the previous native proposal while ChangeDown source has
    // already advanced to the pending replacement. In that state the next
    // source-transition must rebase onto the native body we actually have
    // rather than insisting that the previous pending source already landed.
    // The metadata guard lets a single-paragraph supersede rebase without
    // turning ordinary stale-source mismatches into blind whole-body inserts.
    oldCurrentBody = "";
  }

  if (oldCurrentBody !== priorBody) {
    throw new Error(
      `stale oldWireSource for Word source-transition render:\nexpected prior body:\n${priorBody}\nactual old current body:\n${oldCurrentBody}`
    );
  }

  const topology = classifySourceTransition(oldCurrentBody, newCurrentBody);
  const codec = createOoxmlPackageCodec();
  if (priorBody === "" && hasMarkdownBlockStructure(newCurrentBody)) {
    const revisedPackage = replaceEmptyBodyWithMarkdownBlocks(
      input.ooxmlSnapshot,
      newCurrentBody
    );
    const expectedProjection = codec.project({ snapshot: revisedPackage });
    const actualBody = normalizeBodyForProjectionComparison(
      expectedProjection.bodyMarkdown
    );
    if (
      actualBody !== newCurrentBody &&
      !isInitialBlankBodyEquivalent({
        priorBody,
        expectedBody: newCurrentBody,
        actualBody,
      })
    ) {
      throw new Error(
        `Whole-body projection validation failed after source transition render:\nexpected:\n${newCurrentBody}\nactual:\n${actualBody}`
      );
    }
    return {
      revisedPackage,
      expectedProjection,
      witnessHints: [{ kind: "paragraph", paragraphIndex: 0 }],
      diagnostics: [],
    };
  }
  const workingSnapshot = ensurePatchableBodyAnchor(
    input.ooxmlSnapshot,
    input.priorProjection
  );
  const workingProjection =
    workingSnapshot === input.ooxmlSnapshot
      ? input.priorProjection
      : codec.project({ snapshot: workingSnapshot });
  if (
    topology.kind === "replace" &&
    hasMarkdownBlockStructure(newCurrentBody) &&
    hasLeadingEmptyParagraphRegion(workingProjection)
  ) {
    const revisedPackage = replaceEmptyBodyWithMarkdownBlocks(
      input.ooxmlSnapshot,
      newCurrentBody
    );
    const expectedProjection = codec.project({ snapshot: revisedPackage });
    const actualBody = normalizeBodyForProjectionComparison(
      expectedProjection.bodyMarkdown
    );
    if (actualBody !== newCurrentBody) {
      throw new Error(
        `Whole-body projection validation failed after source transition render:\nexpected:\n${newCurrentBody}\nactual:\n${actualBody}`
      );
    }
    return {
      revisedPackage,
      expectedProjection,
      witnessHints: [{ kind: "paragraph", paragraphIndex: 0 }],
      diagnostics: [],
    };
  }
  const region = findRegionForSourceOffset(workingProjection, topology.start);
  const delta = topologyToOoxmlDelta(workingSnapshot, region, topology);
  let patch;
  try {
    patch = await codec.applyDelta(delta);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("Invalid OOXML patch span") &&
      hasMarkdownBlockStructure(newCurrentBody)
    ) {
      const revisedPackage = replaceEmptyBodyWithMarkdownBlocks(
        input.ooxmlSnapshot,
        newCurrentBody
      );
      patch = {
        snapshot: revisedPackage,
        changedParts: [input.ooxmlSnapshot.documentPartName],
        validation: createEmptyOoxmlValidationResult(),
      };
    } else {
      throw err;
    }
  }
  const expectedProjection = codec.project({ snapshot: patch.snapshot });
  const actualBody = normalizeBodyForProjectionComparison(
    expectedProjection.bodyMarkdown
  );

  if (
    actualBody !== newCurrentBody &&
    !isInitialBlankBodyEquivalent({
      priorBody,
      expectedBody: newCurrentBody,
      actualBody,
    })
  ) {
    throw new Error(
      `Whole-body projection validation failed after source transition render:\nexpected:\n${newCurrentBody}\nactual:\n${actualBody}`
    );
  }

  return {
    revisedPackage: patch.snapshot,
    expectedProjection,
    witnessHints: sourceTransitionWitnessHints(region, topology),
    diagnostics: [],
  };
}

function classifyInsertion(
  start: number,
  insertedMarkdown: string,
  oldSource = "",
  newSource = ""
): SourceTransitionTopology {
  const blockBoundaryBefore =
    oldSource.slice(Math.max(0, start - 2), start) === "\n\n" ||
    newSource.slice(Math.max(0, start - 2), start) === "\n\n";
  const blockBoundaryAfter =
    oldSource.slice(start, start + 2) === "\n\n" ||
    insertedMarkdown.endsWith("\n") ||
    insertedMarkdown.startsWith("\n");
  const hasBlockSyntax =
    isMarkdownTableBlock(insertedMarkdown) ||
    isDisplayMathBlock(insertedMarkdown) ||
    /\n/u.test(insertedMarkdown);
  if (
    hasBlockSyntax &&
    (blockBoundaryBefore || blockBoundaryAfter || /\n\s*\n/u.test(insertedMarkdown))
  ) {
    return {
      kind: "block-insert",
      start,
      insertedMarkdown,
      blockKind: isMarkdownTableBlock(insertedMarkdown)
        ? "table"
        : isDisplayMathBlock(insertedMarkdown)
          ? "math"
          : "paragraphs",
    };
  }
  return { kind: "inline-insert", start, insertedMarkdown };
}

function currentBodyFromWireSource(wireSource: string): string {
  const body = splitBodyAndFootnotes(wireSource.split("\n")).bodyLines.join("\n");
  return computeCurrentText(body);
}

function normalizeBodyForProjectionComparison(bodyMarkdown: string): string {
  // OOXML body projection is a Markdown body, not a file serialization; the
  // only non-semantic normalization allowed here is the final file newline
  // that ChangeDown wire sources commonly carry. Preserve all other trailing
  // whitespace because Markdown may make it meaningful.
  return bodyMarkdown.endsWith("\n")
    ? bodyMarkdown.slice(0, -1)
    : bodyMarkdown;
}

function isInitialBlankBodyEquivalent(input: {
  priorBody: string;
  expectedBody: string;
  actualBody: string;
}): boolean {
  // Compact insertion against a cold Word document that has accepted-history
  // footnotes can produce a wire body shaped like "\n{++first paragraph++}".
  // The leading blank is the patchable empty paragraph anchor, not a requested
  // visible paragraph. The compare target should be the first real paragraph.
  if (input.priorBody !== "") return false;
  if (!input.expectedBody.startsWith("\n")) return false;
  return input.expectedBody.replace(/^\n/u, "") === input.actualBody;
}

function hasMarkdownBlockStructure(markdown: string): boolean {
  return /\n\s*\n/u.test(markdown) || markdownBlocks(markdown).some((block) => parseMarkdownTable(block));
}

function hasSupersedeMetadata(wireSource: string): boolean {
  return /^\s*supersedes:\s*cn-\d+\s*$/mu.test(wireSource);
}

function hasLeadingEmptyParagraphRegion(projection: CodecProjection): boolean {
  const first = projection.regions
    .filter((region) => !isRegionInsideTable(region))
    .sort((left, right) => firstRegionXmlStart(left) - firstRegionXmlStart(right))[0];
  return first !== undefined && first.plainText === "" && first.markdownText === "";
}

function replaceEmptyBodyWithMarkdownBlocks(
  snapshot: OoxmlPackageSnapshot,
  markdown: string
): OoxmlPackageSnapshot {
  const documentPart = snapshot.parts.get(snapshot.documentPartName);
  if (!documentPart?.text) {
    throw new Error(`Cannot replace OOXML body without text part: ${snapshot.documentPartName}`);
  }
  const bodyMatch = /<w:body\b[^>]*>[\s\S]*?<\/w:body>/u.exec(documentPart.text);
  if (!bodyMatch) {
    throw new Error("Cannot replace OOXML body without a Word body element");
  }
  const bodyStartTag = /^<w:body\b[^>]*>/u.exec(bodyMatch[0])?.[0];
  if (!bodyStartTag) {
    throw new Error("Cannot replace OOXML body without a Word body start tag");
  }
  const bodyInner = bodyMatch[0].slice(
    bodyStartTag.length,
    bodyMatch[0].length - "</w:body>".length
  );
  const sectPr = bodyInner.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/gu)?.join("") ?? "";
  const replacementBody = `${bodyStartTag}${markdownBlocksToOoxml(markdown)}${sectPr}</w:body>`;
  const nextDocumentXml =
    documentPart.text.slice(0, bodyMatch.index) +
    replacementBody +
    documentPart.text.slice(bodyMatch.index + bodyMatch[0].length);
  const nextDocumentBytes = new TextEncoder().encode(nextDocumentXml);
  const nextDocumentPart: OoxmlPart = {
    ...documentPart,
    text: nextDocumentXml,
    bytes: nextDocumentBytes,
    hash: stableBytesHash(nextDocumentBytes),
  };
  const parts = new Map(snapshot.parts);
  const hashes = new Map(snapshot.hashes);
  parts.set(snapshot.documentPartName, nextDocumentPart);
  hashes.set(snapshot.documentPartName, nextDocumentPart.hash);
  return {
    ...snapshot,
    freshnessVersion: `${snapshot.freshnessVersion}:body-replace`,
    parts,
    hashes,
  };
}

function markdownBlocksToOoxml(markdown: string): string {
  return markdownBlocks(markdown)
    .map((block) =>
      parseMarkdownTable(block)
        ? markdownTableToOoxml(block).xml
        : `<w:p><w:r><w:t${needsPreserveSpace(block) ? ' xml:space="preserve"' : ""}>${escapeXmlText(block)}</w:t></w:r></w:p>`
    )
    .join("");
}

function markdownBlocks(markdown: string): string[] {
  return markdown
    .replace(/^\n/u, "")
    .trimEnd()
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
}

function needsPreserveSpace(text: string): boolean {
  return /^\s|\s$/u.test(text);
}

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function commonPrefixLength(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(a: string, b: string, prefixLength: number): number {
  let index = 0;
  while (
    index < a.length - prefixLength &&
    index < b.length - prefixLength &&
    a[a.length - 1 - index] === b[b.length - 1 - index]
  ) {
    index += 1;
  }
  return index;
}

function isMarkdownTableBlock(markdown: string): boolean {
  const lines = markdown.trim().split(/\r?\n/u);
  return (
    lines.length >= 2 &&
    /^\s*\|.*\|\s*$/u.test(lines[0] ?? "") &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(lines[1] ?? "")
  );
}

function isDisplayMathBlock(markdown: string): boolean {
  const trimmed = markdown.trim();
  return trimmed.startsWith("$$") && trimmed.endsWith("$$");
}

function findRegionForSourceOffset(
  projection: CodecProjection,
  sourceOffset: number
): OoxmlRegionProjection {
  const blocks = projectionBlocks(projection);
  const paragraphBlocks = blocks.filter(
    (block): block is ProjectionBlock & { region: OoxmlRegionProjection } =>
      block.kind === "paragraph" && block.region !== undefined
  );
  if (paragraphBlocks.length === 0) {
    throw new Error("Cannot map source transition to an OOXML paragraph region");
  }

  const containing = paragraphBlocks.find(
    (block) => sourceOffset >= block.start && sourceOffset <= block.end
  );
  if (containing) {
    return containing.region;
  }

  const previous = [...paragraphBlocks]
    .reverse()
    .find((block) => sourceOffset >= block.end);
  return (previous ?? paragraphBlocks[0]!).region;
}

function topologyToOoxmlDelta(
  snapshot: OoxmlPackageSnapshot,
  region: OoxmlRegionProjection,
  topology: SourceTransitionTopology
): ApplyPackageDeltaInput {
  const adjustedTopology = expandTopologyAcrossSemanticToken(region, topology);
  if (adjustedTopology.kind === "inline-insert") {
    return {
      snapshot,
      regionHandle: region.handle,
      kind: "insert",
      plainStart: sourceOffsetToRegionPlainOffset(region, adjustedTopology.start),
      markdown: adjustedTopology.insertedMarkdown,
    };
  }

  if (adjustedTopology.kind === "block-insert") {
    return {
      snapshot,
      regionHandle: region.handle,
      kind: "insert",
      plainStart: sourceOffsetToRegionPlainOffset(region, adjustedTopology.start),
      markdown: markdownForPatch(region, adjustedTopology),
      blockKind: adjustedTopology.blockKind === "table" ? "table" : undefined,
    };
  }

  if (adjustedTopology.kind === "delete") {
    const start = sourceOffsetToRegionPlainOffset(region, adjustedTopology.start);
    return {
      snapshot,
      regionHandle: region.handle,
      kind: "delete",
      plainStart: start,
      plainEnd: start + adjustedTopology.oldMarkdown.length,
    };
  }

  const start = sourceOffsetToRegionPlainOffset(region, adjustedTopology.start);
  return {
    snapshot,
    regionHandle: region.handle,
    kind: "substitute",
    plainStart: start,
    plainEnd: start + adjustedTopology.oldMarkdown.length,
    markdown: adjustedTopology.newMarkdown,
  };
}

function expandTopologyAcrossSemanticToken(
  region: OoxmlRegionProjection,
  topology: SourceTransitionTopology
): SourceTransitionTopology {
  if (topology.kind === "block-insert") {
    return topology;
  }

  const block = projectionBlockForRegion(region);
  const regionSourceStart = block?.start ?? 0;
  const localStart = Math.max(0, topology.start - regionSourceStart);
  const localEnd =
    topology.kind === "inline-insert"
      ? localStart
      : localStart + topology.oldMarkdown.length;
  const token = region.tokens.find(
    (
      candidate
    ): candidate is Extract<OoxmlToken, { kind: "math" | "figure" }> =>
      (candidate.kind === "math" || candidate.kind === "figure") &&
      semanticTokenIntersectsMarkdownRange(candidate, localStart, localEnd)
  );
  if (!token) {
    return topology;
  }

  const tokenMarkdown = region.markdownText.slice(
    token.markdownStart,
    token.markdownEnd
  );
  const replaceStart = regionSourceStart + token.markdownStart;
  if (topology.kind === "inline-insert") {
    const insertionOffset = Math.max(
      0,
      Math.min(tokenMarkdown.length, localStart - token.markdownStart)
    );
    return {
      kind: "replace",
      start: replaceStart,
      oldMarkdown: tokenMarkdown,
      newMarkdown:
        tokenMarkdown.slice(0, insertionOffset) +
        topology.insertedMarkdown +
        tokenMarkdown.slice(insertionOffset),
    };
  }

  const replacementStart = Math.max(
    0,
    Math.min(tokenMarkdown.length, localStart - token.markdownStart)
  );
  const replacementEnd = Math.max(
    replacementStart,
    Math.min(tokenMarkdown.length, localEnd - token.markdownStart)
  );
  return {
    kind: "replace",
    start: replaceStart,
    oldMarkdown: tokenMarkdown,
    newMarkdown:
      tokenMarkdown.slice(0, replacementStart) +
      (topology.kind === "replace" ? topology.newMarkdown : "") +
      tokenMarkdown.slice(replacementEnd),
  };
}

function semanticTokenIntersectsMarkdownRange(
  token: Extract<OoxmlToken, { kind: "math" | "figure" }>,
  start: number,
  end: number
): boolean {
  if (start === end) {
    return start > token.markdownStart && start < token.markdownEnd;
  }
  return token.markdownEnd > start && token.markdownStart < end;
}

function markdownForPatch(
  region: OoxmlRegionProjection,
  topology: Extract<SourceTransitionTopology, { kind: "block-insert" }>
): string {
  if (topology.blockKind === "table") {
    return topology.insertedMarkdown.trim();
  }

  const paragraphMarkdown = topology.insertedMarkdown
    .trim()
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n");
  const plainOffset = sourceOffsetToRegionPlainOffset(region, topology.start);
  if (plainOffset === 0) {
    return `${paragraphMarkdown}\n`;
  }
  if (plainOffset === region.plainText.length) {
    return `\n${paragraphMarkdown}`;
  }
  return topology.insertedMarkdown;
}

function sourceOffsetToRegionPlainOffset(
  region: OoxmlRegionProjection,
  sourceOffset: number
): number {
  const block = projectionBlockForRegion(region);
  const start = block?.start ?? 0;
  return Math.max(0, Math.min(region.plainText.length, sourceOffset - start));
}

function projectionBlockForRegion(region: OoxmlRegionProjection): ProjectionBlock | undefined {
  return lastProjectionBlocks.find((block) => block.region === region);
}

let lastProjectionBlocks: readonly ProjectionBlock[] = [];

function projectionBlocks(projection: CodecProjection): readonly ProjectionBlock[] {
  const tables = (projection as CodecProjection & { tables?: readonly OoxmlTableProjection[] }).tables ?? [];
  const unordered = [
    ...projection.regions
      .filter((region) => region.markdownText.length > 0 || region.plainText.length === 0)
      .filter((region) => !isRegionInsideTable(region))
      .map((region) => ({
        kind: "paragraph" as const,
        markdownText: region.markdownText,
        xmlStart: firstRegionXmlStart(region),
        region,
      })),
    ...tables.map((table) => ({
      kind: "table" as const,
      markdownText: table.markdownText,
      xmlStart: table.xmlStart,
      table,
    })),
  ].sort((left, right) => left.xmlStart - right.xmlStart);

  let offset = 0;
  lastProjectionBlocks = unordered.map((block, index) => {
    const start = offset;
    const end = start + block.markdownText.length;
    offset = end + (index === unordered.length - 1 ? 0 : 2);
    return { ...block, start, end };
  });
  return lastProjectionBlocks;
}

function sourceTransitionWitnessHints(
  region: OoxmlRegionProjection,
  topology: SourceTransitionTopology
): CompareWitnessHint[] {
  return [
    {
      kind:
        topology.kind === "block-insert" && topology.blockKind === "table"
          ? "table"
          : "paragraph",
      paragraphIndex: region.handle.paragraphIndex,
    },
  ];
}

function ensurePatchableBodyAnchor(
  snapshot: OoxmlPackageSnapshot,
  projection: CodecProjection
): OoxmlPackageSnapshot {
  if (projection.regions.length > 0) {
    return snapshot;
  }

  const documentPart = snapshot.parts.get(snapshot.documentPartName);
  if (!documentPart?.text) {
    throw new Error(`Cannot create OOXML body anchor without text part: ${snapshot.documentPartName}`);
  }
  const bodyMatch = /<w:body\b[^>]*>[\s\S]*?<\/w:body>/u.exec(documentPart.text);
  if (!bodyMatch) {
    throw new Error("Cannot create OOXML body anchor without a Word body element");
  }
  const bodyStartTag = /^<w:body\b[^>]*>/u.exec(bodyMatch[0])?.[0];
  if (!bodyStartTag) {
    throw new Error("Cannot create OOXML body anchor without a Word body start tag");
  }

  const bodyInner = bodyMatch[0].slice(
    bodyStartTag.length,
    bodyMatch[0].length - "</w:body>".length
  );
  const replacementBody = `${bodyStartTag}<w:p><w:r><w:t></w:t></w:r></w:p>${bodyInner}</w:body>`;
  const nextDocumentXml =
    documentPart.text.slice(0, bodyMatch.index) +
    replacementBody +
    documentPart.text.slice(bodyMatch.index + bodyMatch[0].length);
  const nextDocumentBytes = new TextEncoder().encode(nextDocumentXml);
  const nextDocumentPart: OoxmlPart = {
    ...documentPart,
    text: nextDocumentXml,
    bytes: nextDocumentBytes,
    hash: stableBytesHash(nextDocumentBytes),
  };
  const parts = new Map(snapshot.parts);
  const hashes = new Map(snapshot.hashes);
  parts.set(snapshot.documentPartName, nextDocumentPart);
  hashes.set(snapshot.documentPartName, nextDocumentPart.hash);
  return {
    ...snapshot,
    freshnessVersion: `${snapshot.freshnessVersion}:body-anchor`,
    parts,
    hashes,
  };
}

function firstRegionXmlStart(region: OoxmlRegionProjection): number {
  return Math.min(
    ...region.tokens.map((token) => token.xmlStart ?? Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER
  );
}

function isRegionInsideTable(region: OoxmlRegionProjection): boolean {
  return /\/w:tbl\[/.test(region.containerPath) || /\/w:tbl\[/.test(region.handle.path);
}
