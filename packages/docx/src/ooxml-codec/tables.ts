import {
  createEmptyOoxmlValidationResult,
  formattingPlanToOoxmlRuns,
  parseRelationshipTableXml,
} from "./index.js";
import { projectFormattedRunsToMarkdown } from "../inline-codec/index.js";
import type { FormattedRun } from "../inline-codec/index.js";
import { validatePatchPreservation } from "./validation.js";
import {
  relationshipPartNameForSourcePartName,
  serializeRelationshipTableXml,
  validateRelationshipGraph,
} from "./relationships.js";
import { RelationshipAllocator } from "./relationships.js";
import type {
  OoxmlPackageSnapshot,
  OoxmlPart,
  OoxmlPatchResult,
  OoxmlRelationship,
  RelationshipGraph,
  RelationshipTable,
  RegionHandle,
} from "./index.js";

export type TableAlignment = "left" | "center" | "right" | undefined;

export interface MarkdownTableModel {
  headers: string[];
  alignments: TableAlignment[];
  rows: string[][];
}

export interface OoxmlTableProjection {
  partName: string;
  tableIndex: number;
  path: string;
  markdownText: string;
  model: MarkdownTableModel;
  xmlStart: number;
  xmlEnd: number;
  editable: boolean;
  diagnostics: readonly string[];
}

export interface MarkdownTableToOoxmlResult {
  xml: string;
  model: MarkdownTableModel;
  relationshipsAdded: readonly OoxmlRelationship[];
}

export interface ApplyOoxmlTableInsertionInput {
  snapshot: OoxmlPackageSnapshot;
  handle: RegionHandle;
  column: number;
  markdown: string;
}

export interface ApplyOoxmlTableRowInsertionInput {
  snapshot: OoxmlPackageSnapshot;
  handle: RegionHandle;
  markdown: string;
  position?: "before" | "after";
}

export function parseMarkdownTable(
  markdown: string
): MarkdownTableModel | undefined {
  const lines = markdown
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return undefined;
  }

  const headers = splitTableRow(lines[0]!);
  const alignments = parseDelimiterRow(lines[1]!);
  if (!alignments || headers.length === 0) {
    return undefined;
  }

  const bodyRows = lines.slice(2).map(splitTableRow);
  const columnCount = Math.max(
    headers.length,
    alignments.length,
    ...bodyRows.map((row) => row.length)
  );
  if (columnCount === 0) {
    return undefined;
  }

  return {
    headers: normalizeRow(headers, columnCount),
    alignments: normalizeAlignments(alignments, columnCount),
    rows: bodyRows.map((row) => normalizeRow(row, columnCount)),
  };
}

export function markdownTableToMarkdown(model: MarkdownTableModel): string {
  const columnCount = model.headers.length;
  const rows = [
    `| ${model.headers.map(escapeMarkdownTableCell).join(" | ")} |`,
    `| ${model.alignments
      .slice(0, columnCount)
      .map(alignmentDelimiter)
      .join(" | ")} |`,
    ...model.rows.map(
      (row) =>
        `| ${normalizeRow(row, columnCount)
          .map(escapeMarkdownTableCell)
          .join(" | ")} |`
    ),
  ];
  return rows.join("\n");
}

export function markdownTableToOoxml(
  markdown: string,
  allocator?: RelationshipAllocator
): MarkdownTableToOoxmlResult {
  const model = parseMarkdownTable(markdown);
  if (!model) {
    throw new Error("Markdown is not a supported pipe table");
  }

  const relationshipsAdded: OoxmlRelationship[] = [];
  const columnCount = model.headers.length;
  const rows = [model.headers, ...model.rows];
  const grid = Array.from({ length: columnCount }, () => "<w:gridCol/>").join(
    ""
  );
  const rowXml = rows
    .map((row) => {
      const cells = normalizeRow(row, columnCount)
        .map((cell, columnIndex) => {
          const emitted = formattingPlanToOoxmlRuns({ markdown: cell, allocator });
          relationshipsAdded.push(...emitted.relationshipsAdded);
          const justification = paragraphJustificationXml(
            model.alignments[columnIndex]
          );
          return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${justification}${emitted.xml}</w:p></w:tc>`;
        })
        .join("");
      return `<w:tr>${cells}</w:tr>`;
    })
    .join("");

  return {
    model,
    relationshipsAdded,
    xml: `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml}</w:tbl>`,
  };
}

export function parseMarkdownTableRows(
  markdown: string,
  columnCount?: number
): string[][] | undefined {
  const lines = markdown
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;
  if (parseDelimiterRow(lines[0]!) !== undefined) return undefined;
  if (lines.some((line) => !line.includes("|"))) return undefined;
  const rows = lines.map(splitTableRow);
  const width = columnCount ?? Math.max(0, ...rows.map((row) => row.length));
  if (width === 0 || rows.some((row) => row.length === 0)) return undefined;
  return rows.map((row) => normalizeRow(row, width));
}

export function projectOoxmlTables(
  snapshot: OoxmlPackageSnapshot,
  partName = snapshot.documentPartName
): OoxmlTableProjection[] {
  const part = snapshot.parts.get(partName);
  if (!part?.text) {
    throw new Error(`Cannot project OOXML tables without text: ${partName}`);
  }
  const relationshipTable = snapshot.relationships.byPart.get(partName);
  const projections: OoxmlTableProjection[] = [];
  let tableIndex = 0;
  for (const range of topLevelTableRanges(part.text)) {
    const xml = part.text.slice(range.start, range.end);
    const projected = projectTableXml(xml, relationshipTable);
    projections.push({
      partName,
      tableIndex,
      path: `/w:tbl[${tableIndex + 1}]`,
      xmlStart: range.start,
      xmlEnd: range.end,
      ...projected,
    });
    tableIndex += 1;
  }
  return projections;
}

export function applyOoxmlTableInsertion(
  input: ApplyOoxmlTableInsertionInput
): OoxmlPatchResult {
  if (input.handle.paragraphIndex === undefined) {
    throw new Error("Cannot insert OOXML table without paragraph index");
  }
  const documentPart = input.snapshot.parts.get(input.handle.partName);
  if (!documentPart?.text) {
    throw new Error(
      `Cannot insert OOXML table into missing text part: ${input.handle.partName}`
    );
  }

  const parts = new Map(input.snapshot.parts);
  const relationships = new Map(input.snapshot.relationships.byPart);
  const relationshipTable =
    relationships.get(input.handle.partName) ??
    emptyRelationshipTable(input.handle.partName);
  const allocator = new RelationshipAllocator(relationshipTable);
  const splitMarkdown = splitLeadingMarkdownTable(input.markdown);
  const emitted = markdownTableToOoxml(splitMarkdown.tableMarkdown, allocator);
  const relationshipsAdded = [...emitted.relationshipsAdded];
  const trailingXml = splitMarkdown.trailingBlocks
    .map((block) => formattingPlanToOoxmlRuns({ markdown: block, allocator }))
    .map((emittedBlock) => {
      relationshipsAdded.push(...emittedBlock.relationshipsAdded);
      return `<w:p>${emittedBlock.xml}</w:p>`;
    })
    .join("");
  const insertedXml = emitted.xml + trailingXml;
  const bounds = paragraphBounds(documentPart.text, input.handle.paragraphIndex);
  const paragraphPlainText = paragraphText(documentPart.text.slice(bounds.start, bounds.end));
  const column = Math.max(0, Math.min(input.column, paragraphPlainText.length));
  const patch =
    paragraphPlainText.length === 0 && column === 0
      ? { start: bounds.start, end: bounds.end, xml: insertedXml }
      : column === 0
      ? { start: bounds.start, end: bounds.start, xml: insertedXml }
      : column === paragraphPlainText.length
      ? { start: bounds.end, end: bounds.end, xml: insertedXml }
      : undefined;
  if (!patch) {
    throw new Error("Cannot insert native OOXML table inside paragraph text");
  }

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
  } satisfies OoxmlPart);
  const hashes = new Map(input.snapshot.hashes);
  hashes.set(input.handle.partName, stableBytesHash(nextDocumentBytes));

  const changedParts = [input.handle.partName];
  if (relationshipsAdded.length > 0) {
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
    freshnessVersion: `${input.snapshot.freshnessVersion}:table-patched`,
    parts,
    relationships: { byPart: relationships } satisfies RelationshipGraph,
    hashes,
  };
  const preservation = validatePatchPreservation({
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
  const projectedTables = projectOoxmlTables(snapshot, input.handle.partName);
  const expectedMarkdownAfter = markdownTableToMarkdown(emitted.model);
  const actualMarkdownAfter = projectedTables.find(
    (table) => table.xmlStart >= patch.start && table.xmlEnd <= patch.start + patch.xml.length
  )?.markdownText;
  const validation = {
    ...createEmptyOoxmlValidationResult(),
    ok:
      preservation.protectedTokenErrors.length === 0 &&
      relationshipValidation.ok &&
      actualMarkdownAfter === expectedMarkdownAfter,
    changedParts,
    unchangedPartHashes: preservation.unchangedPartHashes,
    relationshipErrors: [
      ...relationshipValidation.relationshipErrors,
      ...preservation.relationshipErrors,
    ],
    protectedTokenErrors: preservation.protectedTokenErrors,
    warnings: preservation.warnings,
    expectedMarkdownAfter,
    actualMarkdownAfter,
  };

  return {
    snapshot,
    changedParts,
    relationshipChanges: relationshipsAdded.map((relationship) => ({
      partName: input.handle.partName,
      relationshipId: relationship.id,
      kind: "added",
      after: relationship,
    })),
    validation,
  };
}

function splitLeadingMarkdownTable(markdown: string): {
  tableMarkdown: string;
  trailingBlocks: string[];
} {
  const normalized = markdown.trim();
  const lines = normalized.split(/\r?\n/u);
  if (lines.length < 2 || !isMarkdownTableHeader(lines[0] ?? "", lines[1] ?? "")) {
    return { tableMarkdown: normalized, trailingBlocks: [] };
  }

  let tableEnd = 2;
  while (tableEnd < lines.length && isMarkdownTableRowLine(lines[tableEnd]!)) {
    tableEnd += 1;
  }

  return {
    tableMarkdown: lines.slice(0, tableEnd).join("\n"),
    trailingBlocks: lines
      .slice(tableEnd)
      .join("\n")
      .split(/\n\s*\n/u)
      .map((block) => block.trim())
      .filter(Boolean),
  };
}

function isMarkdownTableHeader(header: string, delimiter: string): boolean {
  return (
    isMarkdownTableRowLine(header) &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(delimiter)
  );
}

function isMarkdownTableRowLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line);
}

export function applyOoxmlTableRowInsertion(
  input: ApplyOoxmlTableRowInsertionInput
): OoxmlPatchResult {
  if (input.handle.paragraphIndex === undefined) {
    throw new Error("Cannot insert OOXML table rows without paragraph index");
  }
  const documentPart = input.snapshot.parts.get(input.handle.partName);
  if (!documentPart?.text) {
    throw new Error(
      `Cannot insert OOXML table rows into missing text part: ${input.handle.partName}`
    );
  }

  const paragraph = paragraphBounds(
    documentPart.text,
    input.handle.paragraphIndex
  );
  const tableRange = topLevelTableRanges(documentPart.text).find(
    (range) => range.start <= paragraph.start && paragraph.end <= range.end
  );
  if (!tableRange) {
    throw new Error("Cannot insert OOXML table rows outside a native table");
  }

  const tableXml = documentPart.text.slice(tableRange.start, tableRange.end);
  const relationshipTable = input.snapshot.relationships.byPart.get(
    input.handle.partName
  );
  const projected = projectTableXml(tableXml, relationshipTable);
  if (!projected.editable) {
    throw new Error(
      `Cannot insert OOXML table rows into unsupported table: ${projected.diagnostics.join(", ")}`
    );
  }
  const rows = parseMarkdownTableRows(input.markdown, projected.model.headers.length);
  if (!rows) {
    throw new Error("Markdown is not a supported pipe table row insertion");
  }

  const tableRelativeParagraphStart = paragraph.start - tableRange.start;
  const rowRanges = elementRanges(tableXml, "w:tr");
  const rowIndex = rowRanges.findIndex((range) =>
    range.start <= tableRelativeParagraphStart && tableRelativeParagraphStart <= range.end
  );
  if (rowIndex < 0) {
    throw new Error("Cannot locate addressed OOXML table row");
  }

  const relationships = new Map(input.snapshot.relationships.byPart);
  const relationshipTableForMutation =
    relationships.get(input.handle.partName) ??
    emptyRelationshipTable(input.handle.partName);
  const allocator = new RelationshipAllocator(relationshipTableForMutation);
  const relationshipsAdded: OoxmlRelationship[] = [];
  const rowXml = rows
    .map((row) =>
      tableRowToOoxml(row, projected.model.alignments, allocator, relationshipsAdded)
    )
    .join("");
  const targetRow = rowRanges[rowIndex]!;
  const insertAt = input.position === "before" ? targetRow.start : targetRow.end;
  const nextTableXml =
    tableXml.slice(0, insertAt) + rowXml + tableXml.slice(insertAt);
  const nextDocumentXml =
    documentPart.text.slice(0, tableRange.start) +
    nextTableXml +
    documentPart.text.slice(tableRange.end);

  const parts = new Map(input.snapshot.parts);
  const hashes = new Map(input.snapshot.hashes);
  const documentBytes = new TextEncoder().encode(nextDocumentXml);
  parts.set(input.handle.partName, {
    ...documentPart,
    text: nextDocumentXml,
    bytes: documentBytes,
    hash: stableBytesHash(documentBytes),
  } satisfies OoxmlPart);
  hashes.set(input.handle.partName, stableBytesHash(documentBytes));

  const changedParts = [input.handle.partName];
  if (relationshipsAdded.length > 0) {
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
    changedParts.push(relationshipPartName);
  }

  const snapshot: OoxmlPackageSnapshot = {
    ...input.snapshot,
    freshnessVersion: `${input.snapshot.freshnessVersion}:table-row-patched`,
    parts,
    relationships: { byPart: relationships } satisfies RelationshipGraph,
    hashes,
  };
  const relationshipValidation = validateRelationshipGraph(snapshot);
  const actualMarkdownAfter = projectOoxmlTables(snapshot, input.handle.partName).find(
    (table) => table.xmlStart === tableRange.start
  )?.markdownText;
  const nextModel: MarkdownTableModel = {
    ...projected.model,
    rows: [
      ...projected.model.rows.slice(0, Math.max(0, rowIndex)),
      ...(input.position === "before" ? rows : []),
      ...projected.model.rows.slice(Math.max(0, rowIndex)),
      ...(input.position === "before" ? [] : rows),
    ],
  };
  // rowIndex includes the header row, while model.rows excludes it.
  if (rowIndex === 0) {
    nextModel.rows = input.position === "before"
      ? [...rows, ...projected.model.rows]
      : [...rows, ...projected.model.rows];
  } else {
    const bodyIndex = rowIndex - 1;
    nextModel.rows = [
      ...projected.model.rows.slice(0, input.position === "before" ? bodyIndex : bodyIndex + 1),
      ...rows,
      ...projected.model.rows.slice(input.position === "before" ? bodyIndex : bodyIndex + 1),
    ];
  }
  const expectedMarkdownAfter = markdownTableToMarkdown(nextModel);
  const validation = {
    ...createEmptyOoxmlValidationResult(),
    ok: relationshipValidation.ok && actualMarkdownAfter === expectedMarkdownAfter,
    changedParts,
    unchangedPartHashes: {},
    relationshipErrors: relationshipValidation.relationshipErrors,
    protectedTokenErrors: [],
    warnings: [],
    expectedMarkdownAfter,
    actualMarkdownAfter,
  };

  return {
    snapshot,
    changedParts,
    relationshipChanges: relationshipsAdded.map((relationship) => ({
      partName: input.handle.partName,
      relationshipId: relationship.id,
      kind: "added" as const,
      after: relationship,
    })),
    validation,
  };
}

function tableRowToOoxml(
  row: readonly string[],
  alignments: readonly TableAlignment[],
  allocator: RelationshipAllocator,
  relationshipsAdded: OoxmlRelationship[]
): string {
  const cells = normalizeRow(row, alignments.length)
    .map((cell, columnIndex) => {
      const emitted = formattingPlanToOoxmlRuns({ markdown: cell, allocator });
      relationshipsAdded.push(...emitted.relationshipsAdded);
      const justification = paragraphJustificationXml(alignments[columnIndex]);
      return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${justification}${emitted.xml}</w:p></w:tc>`;
    })
    .join("");
  return `<w:tr>${cells}</w:tr>`;
}

function projectTableXml(
  xml: string,
  relationshipTable?: RelationshipTable
): Pick<OoxmlTableProjection, "markdownText" | "model" | "editable" | "diagnostics"> {
  const diagnostics: string[] = [];
  if (/<w:(?:gridSpan|vMerge|hMerge|tbl)\b/u.test(xml.replace(/^<w:tbl\b/, ""))) {
    diagnostics.push("complex table structure is not editable yet");
  }
  const rows = childElementXml(xml, "w:tr").map((rowXml) =>
    childElementXml(rowXml, "w:tc").map((cellXml) =>
      projectCellMarkdown(cellXml, relationshipTable, diagnostics)
    )
  );
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  const headers = normalizeRow(rows[0] ?? [], columnCount);
  const bodyRows = rows.slice(1).map((row) => normalizeRow(row, columnCount));
  const alignments = inferAlignments(xml, columnCount);
  const model = { headers, alignments, rows: bodyRows };
  return {
    model,
    markdownText: markdownTableToMarkdown(model),
    editable: diagnostics.length === 0 && columnCount > 0,
    diagnostics,
  };
}

function projectCellMarkdown(
  cellXml: string,
  relationshipTable: RelationshipTable | undefined,
  diagnostics: string[]
): string {
  const paragraphs = childElementXml(cellXml, "w:p");
  if (paragraphs.length > 1) {
    diagnostics.push("multi-paragraph table cells are not editable yet");
  }
  const paragraphXml = paragraphs[0] ?? "";
  return projectInlineMarkdown(paragraphXml, relationshipTable, diagnostics);
}

function projectInlineMarkdown(
  xml: string,
  relationshipTable: RelationshipTable | undefined,
  diagnostics: string[]
): string {
  const runs: FormattedRun[] = [];
  let cursor = 0;
  for (const hyperlink of elementRanges(xml, "w:hyperlink")) {
    appendRunsFromXml(xml.slice(cursor, hyperlink.start), runs, undefined, diagnostics);
    const hyperlinkXml = xml.slice(hyperlink.start, hyperlink.end);
    const rId = /r:id=["']([^"']+)["']/u.exec(hyperlinkXml)?.[1];
    const target = rId
      ? relationshipTable?.relationships.get(rId)?.target ?? rId
      : undefined;
    appendRunsFromXml(hyperlinkXml, runs, target, diagnostics);
    cursor = hyperlink.end;
  }
  appendRunsFromXml(xml.slice(cursor), runs, undefined, diagnostics);
  return projectFormattedRunsToMarkdown(runs).markdownText;
}

function appendRunsFromXml(
  xml: string,
  runs: FormattedRun[],
  hyperlink: string | undefined,
  diagnostics: string[]
): void {
  for (const runXml of childElementXml(xml, "w:r")) {
    const rPr = childElementXml(runXml, "w:rPr")[0] ?? "";
    if (/<w:(?:color|highlight|shd|vertAlign|smallCaps|caps)\b/u.test(rPr)) {
      diagnostics.push("unsupported run properties inside table cell");
    }
    const text = childElementXml(runXml, "w:t").map(textContent).join("");
    if (text.length === 0) {
      continue;
    }
    runs.push({
      text,
      ...(rPr.includes("<w:b") ? { bold: true } : undefined),
      ...(rPr.includes("<w:i") ? { italic: true } : undefined),
      ...(rPr.includes("<w:strike") || rPr.includes("<w:dstrike")
        ? { strikethrough: true }
        : undefined),
      ...(rPr.includes("<w:u") ? { underline: true } : undefined),
      ...(rPr.includes('w:val="Code"') || rPr.includes("w:val='Code'")
        ? { code: true }
        : undefined),
      ...(hyperlink ? { hyperlink } : undefined),
    });
  }
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      cell += char === "|" ? "|" : `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  if (escaped) {
    cell += "\\";
  }
  cells.push(cell.trim());
  return cells;
}

function parseDelimiterRow(line: string): TableAlignment[] | undefined {
  const cells = splitTableRow(line);
  const alignments: TableAlignment[] = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/u.test(cell.trim())) {
      return undefined;
    }
    const trimmed = cell.trim();
    alignments.push(
      trimmed.startsWith(":") && trimmed.endsWith(":")
        ? "center"
        : trimmed.endsWith(":")
        ? "right"
        : "left"
    );
  }
  return alignments;
}

function normalizeRow(row: readonly string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

function normalizeAlignments(
  alignments: readonly TableAlignment[],
  columnCount: number
): TableAlignment[] {
  return Array.from({ length: columnCount }, (_, index) => alignments[index] ?? "left");
}

function alignmentDelimiter(alignment: TableAlignment): string {
  return alignment === "center" ? ":---:" : alignment === "right" ? "---:" : "---";
}

function paragraphJustificationXml(alignment: TableAlignment): string {
  if (!alignment || alignment === "left") {
    return "";
  }
  return `<w:pPr><w:jc w:val="${alignment}"/></w:pPr>`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function topLevelTableRanges(documentXml: string): Array<{ start: number; end: number }> {
  const body = elementRanges(documentXml, "w:body")[0];
  if (!body) {
    return [];
  }
  return elementRanges(documentXml.slice(body.start, body.end), "w:tbl").map((range) => ({
    start: body.start + range.start,
    end: body.start + range.end,
  }));
}

function childElementXml(xml: string, tag: string): string[] {
  const source = innerElementXml(xml);
  const escaped = escapeRegExp(tag);
  const pattern = new RegExp(
    `<${escaped}\\b[^>]*\\/>|<${escaped}\\b[^>]*>[\\s\\S]*?<\\/${escaped}>`,
    "gu"
  );
  return [...source.matchAll(pattern)].map((match) => match[0]);
}

function innerElementXml(xml: string): string {
  const tags = scanTags(xml);
  const first = tags[0];
  const last = tags[tags.length - 1];
  if (!first || !last || xml.slice(first.start, first.end).startsWith("</")) {
    return xml;
  }
  if (isSelfClosingTag(xml.slice(first.start, first.end))) {
    return "";
  }
  return xml.slice(first.end, last.start);
}

function elementRanges(xml: string, tag: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const stack: number[] = [];
  for (const range of scanTags(xml)) {
    const raw = xml.slice(range.start, range.end);
    if (new RegExp(`^<${escapeRegExp(tag)}(?:\\s|>|/)`, "u").test(raw)) {
      if (isSelfClosingTag(raw)) {
        ranges.push({ start: range.start, end: range.end });
      } else {
        stack.push(range.start);
      }
    } else if (new RegExp(`^</${escapeRegExp(tag)}(?:\\s|>)`, "u").test(raw)) {
      const start = stack.pop();
      if (start !== undefined) {
        ranges.push({ start, end: range.end });
      }
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function scanTags(xml: string): Array<{ start: number; end: number }> {
  const tags: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start < 0) break;
    let quote: '"' | "'" | undefined;
    let end = start + 1;
    for (; end < xml.length; end += 1) {
      const char = xml[end];
      if (quote) {
        if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === ">") {
        end += 1;
        break;
      }
    }
    if (end <= xml.length && xml[end - 1] === ">") {
      tags.push({ start, end });
    }
    cursor = Math.max(end, start + 1);
  }
  return tags;
}

function paragraphBounds(
  documentXml: string,
  paragraphIndex: number
): { start: number; end: number } {
  let index = 0;
  for (const range of elementRanges(documentXml, "w:p")) {
    if (index === paragraphIndex) {
      return range;
    }
    index += 1;
  }
  throw new Error(`Cannot locate OOXML paragraph ${paragraphIndex}`);
}

function paragraphText(paragraphXml: string): string {
  return elementRanges(paragraphXml, "w:t")
    .map((range) => textContent(paragraphXml.slice(range.start, range.end)))
    .join("");
}

function textContent(xml: string): string {
  return decodeXmlText(xml.replace(/^<[^>]+>/u, "").replace(/<\/[^>]+>$/u, ""));
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function inferAlignments(xml: string, columnCount: number): TableAlignment[] {
  const firstRow = childElementXml(xml, "w:tr")[0] ?? "";
  const firstRowCells = childElementXml(firstRow, "w:tc");
  return Array.from({ length: columnCount }, (_, index) => {
    const cell = firstRowCells[index] ?? "";
    const jc = /<w:jc\b[^>]*\bw:val=["']([^"']+)["']/u.exec(cell)?.[1];
    return jc === "center" ? "center" : jc === "right" ? "right" : "left";
  });
}

function isSelfClosingTag(rawTag: string): boolean {
  for (let index = rawTag.length - 2; index >= 0; index -= 1) {
    const char = rawTag[index];
    if (/\s/.test(char ?? "")) continue;
    return char === "/";
  }
  return false;
}

function emptyRelationshipTable(partName: string): RelationshipTable {
  return parseRelationshipTableXml(
    partName,
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
