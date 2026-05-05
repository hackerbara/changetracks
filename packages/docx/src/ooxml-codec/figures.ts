import { resolveRelationshipTarget } from "./relationships.js";
import type { OoxmlFigureToken, OoxmlRelationship } from "./index.js";

export interface ProjectOoxmlFigureTokenInput {
  partName: string;
  path: string;
  xml: string;
  xmlStart?: number;
  xmlEnd?: number;
  relationships: ReadonlyMap<string, OoxmlRelationship>;
  mediaHashes: ReadonlyMap<string, string>;
  contentTypes: ReadonlyMap<string, string>;
}

export interface BuildInlineDrawingXmlInput {
  relationshipId: string;
  altText: string;
  docPrId: number;
  widthEmu?: number;
  heightEmu?: number;
}

export function projectOoxmlFigureToken(
  input: ProjectOoxmlFigureTokenInput
): OoxmlFigureToken {
  const relationshipIds = embeddedRelationshipIds(input.xml);
  const mediaParts = relationshipIds
    .map((id) => {
      const relationship = input.relationships.get(id);
      return relationshipTargetToMediaPart(
        input.partName,
        relationship,
        input.contentTypes
      );
    })
    .filter((partName): partName is string => partName !== undefined);
  const primaryMediaPartName = mediaParts[0];
  const fallbackMediaPartNames = mediaParts.slice(1);
  const docPr = parseDocPr(input.xml);
  const extentEmu = parseExtent(input.xml);
  const markdownSrc = primaryMediaPartName
    ? mediaPartToMarkdownSrc(primaryMediaPartName)
    : "media/unknown-image";
  const altText = docPr.descr ?? docPr.name;
  const markdown = imageMarkdown(altText ?? "", markdownSrc);

  return {
    kind: "figure",
    partName: input.partName,
    path: input.path,
    drawingXml: input.xml,
    inline: hasStartTag(input.xml, "inline", WORDPROCESSING_DRAWING_NS, "wp"),
    relationshipIds,
    primaryMediaPartName,
    fallbackMediaPartNames:
      fallbackMediaPartNames.length > 0 ? fallbackMediaPartNames : undefined,
    contentTypes: Object.fromEntries(
      mediaParts.map((partName) => [
        partName,
        input.contentTypes.get(partName) ?? "",
      ])
    ),
    mediaHash: primaryMediaPartName
      ? input.mediaHashes.get(primaryMediaPartName)
      : undefined,
    markdownSrc,
    altText,
    title: docPr.title,
    description: docPr.descr,
    extentEmu,
    plainStart: 0,
    plainEnd: markdown.length,
    markdownStart: 0,
    markdownEnd: markdown.length,
    xmlStart: input.xmlStart,
    xmlEnd: input.xmlEnd,
    preservation: "semantic-preserved",
  };
}

export function buildInlineDrawingXml(input: BuildInlineDrawingXmlInput): string {
  const width = input.widthEmu ?? 914400;
  const height = input.heightEmu ?? 914400;
  const docPrId = Math.max(1, Math.trunc(input.docPrId));
  const altText = escapeAttr(input.altText);
  return `<w:r><w:drawing><wp:inline xmlns:wp="${WORDPROCESSING_DRAWING_NS}" xmlns:r="${OOXML_RELATIONSHIPS_NS}" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${docPrId}" name="Picture ${docPrId}" descr="${altText}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${altText}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${escapeAttr(input.relationshipId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

const OOXML_RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WORDPROCESSING_DRAWING_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";

export function imageMarkdown(alt: string, src: string): string {
  return `![${escapeMarkdownImageAlt(alt)}](<${escapeMarkdownAngleDestination(
    src
  )}>)`;
}

function escapeMarkdownImageAlt(alt: string): string {
  return alt
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]")
    .replace(/[\r\n]+/g, " ");
}

function escapeMarkdownAngleDestination(src: string): string {
  return src
    .replace(/\\/g, "\\\\")
    .replace(/\)/g, "\\)")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function embeddedRelationshipIds(xml: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const relationshipPrefixes = relationshipNamespacePrefixes(xml);
  const hasExplicitR = namespacePrefixDeclared(xml, "r");
  for (const match of xml.matchAll(
    /\b([A-Za-z_][\w.-]*):(embed|link|id)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  )) {
    const prefix = match[1];
    const isRelationshipPrefix = relationshipPrefixes.has(prefix);
    const isUndeclaredRFallback = prefix === "r" && !hasExplicitR;
    if (!isRelationshipPrefix && !isUndeclaredRFallback) {
      continue;
    }
    const id = decodeXmlAttribute(match[3] ?? match[4] ?? "");
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function namespacePrefixDeclared(xml: string, prefix: string): boolean {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bxmlns:${escapedPrefix}\\s*=`).test(xml);
}

function relationshipNamespacePrefixes(xml: string): Set<string> {
  const prefixes = new Set<string>();
  for (const match of xml.matchAll(
    /\bxmlns:([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  )) {
    if (
      decodeXmlAttribute(match[2] ?? match[3] ?? "") === OOXML_RELATIONSHIPS_NS
    ) {
      prefixes.add(match[1]);
    }
  }
  return prefixes;
}

function relationshipTargetToPart(
  sourcePartName: string,
  relationship?: OoxmlRelationship
): string | undefined {
  if (!relationship || relationship.targetMode === "External") {
    return undefined;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(relationship.target)) {
    return undefined;
  }
  return resolveRelationshipTarget(sourcePartName, relationship.target);
}

function relationshipTargetToMediaPart(
  sourcePartName: string,
  relationship: OoxmlRelationship | undefined,
  contentTypes: ReadonlyMap<string, string>
): string | undefined {
  if (!relationship || !isImageRelationshipType(relationship.type)) {
    return undefined;
  }
  const partName = relationshipTargetToPart(sourcePartName, relationship);
  if (!partName) {
    return undefined;
  }
  const contentType = contentTypes.get(partName);
  if (contentType && !contentType.startsWith("image/")) {
    return undefined;
  }
  return partName;
}

function isImageRelationshipType(type: string): boolean {
  return /\/image$/.test(type) || type === "image";
}

function mediaPartToMarkdownSrc(partName: string): string {
  return partName.replace(/^word\//, "");
}

function parseDocPr(xml: string): {
  name?: string;
  descr?: string;
  title?: string;
} {
  const tag = findStartTag(xml, "docPr", WORDPROCESSING_DRAWING_NS, "wp") ?? "";
  return {
    name: attr(tag, "name"),
    descr: attr(tag, "descr"),
    title: attr(tag, "title"),
  };
}

function parseExtent(
  xml: string
): { width: number; height: number } | undefined {
  const tag = findStartTag(xml, "extent", WORDPROCESSING_DRAWING_NS, "wp");
  if (!tag) {
    return undefined;
  }
  const width = Number(attr(tag, "cx"));
  const height = Number(attr(tag, "cy"));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }
  return { width, height };
}

function findStartTag(
  xml: string,
  localName: string,
  namespaceUri: string,
  fallbackPrefix?: string
): string | undefined {
  const prefixes = namespacePrefixes(xml, namespaceUri);
  const hasExplicitFallbackPrefix =
    fallbackPrefix !== undefined && namespacePrefixDeclared(xml, fallbackPrefix);

  for (const match of xml.matchAll(
    /<\s*([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)\b/g
  )) {
    if (match.index === undefined || match[2] !== localName) {
      continue;
    }
    const prefix = match[1];
    const isNamespacePrefix = prefixes.has(prefix);
    const isFallbackPrefix =
      fallbackPrefix !== undefined &&
      prefix === fallbackPrefix &&
      !hasExplicitFallbackPrefix;
    if (!isNamespacePrefix && !isFallbackPrefix) {
      continue;
    }
    const tagEnd = findXmlTagEnd(xml, match.index);
    if (tagEnd < 0) {
      return undefined;
    }
    return xml.slice(match.index, tagEnd + 1);
  }
  return undefined;
}

function hasStartTag(
  xml: string,
  localName: string,
  namespaceUri: string,
  fallbackPrefix?: string
): boolean {
  return (
    findStartTag(xml, localName, namespaceUri, fallbackPrefix) !== undefined
  );
}

function namespacePrefixes(xml: string, namespaceUri: string): Set<string> {
  const prefixes = new Set<string>();
  for (const match of xml.matchAll(
    /\bxmlns:([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  )) {
    if (decodeXmlAttribute(match[2] ?? match[3] ?? "") === namespaceUri) {
      prefixes.add(match[1]);
    }
  }
  return prefixes;
}

function findXmlTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < xml.length; index += 1) {
    const char = xml[index];
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

function attr(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`
  ).exec(tag);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? undefined : decodeXmlAttribute(value);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/g, (entity: string, hex: string) =>
      decodeNumericXmlEntity(entity, Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (entity: string, decimal: string) =>
      decodeNumericXmlEntity(entity, Number.parseInt(decimal, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function decodeNumericXmlEntity(entity: string, codePoint: number): string {
  if (!isValidXmlCodePoint(codePoint)) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
}

function isValidXmlCodePoint(codePoint: number): boolean {
  return (
    Number.isInteger(codePoint) &&
    (codePoint === 0x9 ||
      codePoint === 0xa ||
      codePoint === 0xd ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff))
  );
}
