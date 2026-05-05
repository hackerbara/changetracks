import JSZip from "jszip";
import type {
  ContentTypeIndex,
  OoxmlPackageCapabilities,
  OoxmlPackageSnapshot,
  OoxmlPart,
  RelationshipGraph,
} from "./index.js";
import {
  parseRelationshipPartNameToSourcePartName,
  parseRelationshipGraph,
  relationshipPartNameForSourcePartName,
  serializeRelationshipTableXml,
} from "./relationships.js";
import type { ParsedRelationshipTable } from "./relationships.js";

export type OoxmlPackageInput = Uint8Array | ArrayBuffer | string;

const CONTENT_TYPES_PART = "[Content_Types].xml";
const ROOT_RELATIONSHIPS_PART = "_rels/.rels";
const OFFICE_DOCUMENT_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

const FULL_PACKAGE_CAPABILITIES: OoxmlPackageCapabilities = {
  hasFullPackage: true,
  canPreserveUntouchedParts: true,
  canAllocateRelationships: true,
};

export async function decodeOoxmlPackage(
  input: OoxmlPackageInput
): Promise<OoxmlPackageSnapshot> {
  const zip = await JSZip.loadAsync(
    input,
    typeof input === "string" ? { base64: true } : undefined
  );
  const contentTypesPart = zip.file(CONTENT_TYPES_PART);
  const contentTypesText = contentTypesPart
    ? await contentTypesPart.async("text")
    : "";
  const contentTypes = parseContentTypes(contentTypesText);

  const parts = new Map<string, OoxmlPart>();
  const hashes = new Map<string, string>();

  const fileNames = Object.keys(zip.files)
    .filter((name) => !zip.files[name]?.dir)
    .sort();

  for (const name of fileNames) {
    const file = zip.file(name);
    if (!file) {
      continue;
    }

    const bytes = await file.async("uint8array");
    const contentType = getContentTypeForPart(name, contentTypes);
    const hash = stableBytesHash(bytes);
    const part: OoxmlPart = {
      name,
      contentType,
      bytes,
      hash,
    };

    if (isTextPart(name, contentType)) {
      part.text = await file.async("text");
    }

    parts.set(name, part);
    hashes.set(name, hash);
  }

  const relationships = parseRelationshipGraph(parts);
  const documentPartName =
    findDocumentPartName(relationships) ?? "word/document.xml";

  return {
    source: "full-package",
    freshnessVersion: "decoded",
    parts,
    relationships,
    contentTypes,
    documentPartName,
    rootRelationshipsPartName: ROOT_RELATIONSHIPS_PART,
    hashes,
    capabilities: FULL_PACKAGE_CAPABILITIES,
  };
}

export async function encodeOoxmlPackage(
  snapshot: OoxmlPackageSnapshot
): Promise<Uint8Array> {
  const zip = new JSZip();
  const relationshipPartUpdates = relationshipPartUpdatesForSnapshot(snapshot);
  const partNames = new Set([
    ...snapshot.parts.keys(),
    ...relationshipPartUpdates.keys(),
  ]);

  for (const partName of [...partNames].sort()) {
    const part = snapshot.parts.get(partName);
    const relationshipBytes = relationshipPartUpdates.get(partName);
    if (relationshipBytes) {
      zip.file(partName, toArrayBuffer(relationshipBytes));
      continue;
    }

    if (isRelationshipsPart(partName)) {
      const sourcePartName =
        parseRelationshipPartNameToSourcePartName(partName);
      if (!snapshot.relationships.byPart.has(sourcePartName)) {
        continue;
      }
    }

    if (part?.bytes === undefined) {
      throw new Error(`Cannot encode OOXML part without bytes: ${partName}`);
    }

    zip.file(partName, toArrayBuffer(part.bytes));
  }

  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function isRelationshipsPart(partName: string): boolean {
  return partName === ROOT_RELATIONSHIPS_PART || partName.endsWith(".rels");
}

function relationshipPartUpdatesForSnapshot(
  snapshot: OoxmlPackageSnapshot
): Map<string, Uint8Array> {
  const updates = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();

  for (const [sourcePartName, table] of snapshot.relationships.byPart) {
    const parsedTable = table as Partial<ParsedRelationshipTable>;
    const canonicalXml = serializeRelationshipTableXml(table);
    if (parsedTable.originalCanonicalXml === canonicalXml) {
      continue;
    }

    const relationshipPartName =
      parsedTable.relationshipPartName ??
      relationshipPartNameForSourcePartName(sourcePartName);
    updates.set(relationshipPartName, encoder.encode(canonicalXml));
  }

  return updates;
}

function parseContentTypes(xml: string): ContentTypeIndex {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();

  for (const tag of xml.matchAll(/<Default\b[^>]*>/g)) {
    const attrs = parseXmlAttributes(tag[0]);
    const extension = attrs.Extension ?? attrs.extension;
    const contentType = attrs.ContentType ?? attrs.contentType;
    if (extension && contentType) {
      defaults.set(extension, contentType);
    }
  }

  for (const tag of xml.matchAll(/<Override\b[^>]*>/g)) {
    const attrs = parseXmlAttributes(tag[0]);
    const partName = attrs.PartName ?? attrs.partName;
    const contentType = attrs.ContentType ?? attrs.contentType;
    if (partName && contentType) {
      overrides.set(stripLeadingSlash(partName), contentType);
    }
  }

  return { defaults, overrides };
}

function findDocumentPartName(
  relationships: RelationshipGraph
): string | undefined {
  const rootRelationships = relationships.byPart.get(
    ROOT_RELATIONSHIPS_PART
  )?.relationships;
  if (!rootRelationships) {
    return undefined;
  }

  for (const relationship of rootRelationships.values()) {
    if (
      relationship.type === OFFICE_DOCUMENT_RELATIONSHIP_TYPE ||
      relationship.type.endsWith("/officeDocument")
    ) {
      return stripLeadingSlash(relationship.target);
    }
  }

  return undefined;
}

function getContentTypeForPart(
  partName: string,
  contentTypes: ContentTypeIndex
): string | undefined {
  const override = contentTypes.overrides.get(partName);
  if (override) {
    return override;
  }

  const extension = partName.includes(".")
    ? partName.slice(partName.lastIndexOf(".") + 1)
    : "";
  return extension ? contentTypes.defaults.get(extension) : undefined;
}

function isTextPart(
  partName: string,
  contentType: string | undefined
): boolean {
  return (
    partName.endsWith(".xml") ||
    partName.endsWith(".rels") ||
    contentType?.includes("xml") === true ||
    contentType?.startsWith("text/") === true
  );
}

function parseXmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(
    /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  )) {
    attrs[match[1]] = decodeXmlAttribute(match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
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
