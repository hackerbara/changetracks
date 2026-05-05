import type {
  OoxmlPackageSnapshot,
  OoxmlPart,
  OoxmlRelationship,
  OoxmlValidationResult,
  RelationshipGraph,
  RelationshipTable,
} from "./index.js";

const ROOT_RELATIONSHIPS_PART = "_rels/.rels";
const RELATIONSHIPS_XMLNS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const HYPERLINK_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

export interface ParsedRelationshipTable extends RelationshipTable {
  duplicateIds: readonly string[];
  relationshipPartName?: string;
  originalCanonicalXml?: string;
}

export function parseRelationshipGraph(
  parts: ReadonlyMap<string, OoxmlPart>
): RelationshipGraph {
  const byPart = new Map<string, RelationshipTable>();

  for (const [partName, part] of parts) {
    if (!isRelationshipsPart(partName) || part.text === undefined) {
      continue;
    }

    const sourcePartName = parseRelationshipPartNameToSourcePartName(partName);
    const table = parseRelationshipTableXml(sourcePartName, part.text);
    table.relationshipPartName = partName;
    table.originalCanonicalXml = serializeRelationshipTableXml(table);
    byPart.set(sourcePartName, table);
  }

  return { byPart };
}

export function parseRelationshipTableXml(
  sourcePartName: string,
  xml: string
): ParsedRelationshipTable {
  const relationships = new Map<string, OoxmlRelationship>();
  const duplicateIds: string[] = [];

  for (const tag of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const attrs = parseXmlAttributes(tag[0]);
    const id = attrs.Id ?? attrs.id;
    const type = attrs.Type ?? attrs.type;
    const target = attrs.Target ?? attrs.target;
    if (!id || !type || !target) {
      continue;
    }

    if (relationships.has(id) && !duplicateIds.includes(id)) {
      duplicateIds.push(id);
    }

    relationships.set(id, {
      id,
      type,
      target,
      targetMode: attrs.TargetMode ?? attrs.targetMode,
    });
  }

  return {
    partName: sourcePartName,
    relationships,
    duplicateIds,
  };
}

export function serializeRelationshipTableXml(
  table: RelationshipTable
): string {
  const relationships = [...table.relationships.values()].sort((a, b) =>
    compareRelationshipIds(a.id, b.id)
  );
  const body = relationships
    .map((relationship) => {
      const targetMode = relationship.targetMode
        ? ` TargetMode="${escapeXmlAttribute(relationship.targetMode)}"`
        : "";
      return (
        `<Relationship Id="${escapeXmlAttribute(relationship.id)}"` +
        ` Type="${escapeXmlAttribute(relationship.type)}"` +
        ` Target="${escapeXmlAttribute(relationship.target)}"${targetMode}/>`
      );
    })
    .join("");

  return `<Relationships xmlns="${RELATIONSHIPS_XMLNS}">${body}</Relationships>`;
}

export class RelationshipAllocator {
  private readonly partName: string;
  private readonly relationships: Map<string, OoxmlRelationship>;
  private readonly reservedIds = new Set<string>();

  constructor(table: RelationshipTable) {
    this.partName = table.partName;
    this.relationships = new Map(table.relationships);
  }

  allocateId(prefix = "rId"): string {
    let candidateNumber = 1;
    while (
      this.relationships.has(`${prefix}${candidateNumber}`) ||
      this.reservedIds.has(`${prefix}${candidateNumber}`)
    ) {
      candidateNumber += 1;
    }

    const id = `${prefix}${candidateNumber}`;
    this.reservedIds.add(id);
    return id;
  }

  addExternalHyperlink(target: string): OoxmlRelationship {
    return this.addRelationship({
      type: HYPERLINK_RELATIONSHIP_TYPE,
      target,
      targetMode: "External",
    });
  }

  addInternalRelationship(type: string, target: string): OoxmlRelationship {
    return this.addRelationship({ type, target });
  }

  toTable(): RelationshipTable {
    return {
      partName: this.partName,
      relationships: new Map(this.relationships),
    };
  }

  private addRelationship(
    input: Omit<OoxmlRelationship, "id">
  ): OoxmlRelationship {
    const relationship: OoxmlRelationship = {
      id: this.allocateId(),
      ...input,
    };
    this.relationships.set(relationship.id, relationship);
    this.reservedIds.delete(relationship.id);
    return relationship;
  }
}

export function validateRelationshipGraph(
  snapshot: OoxmlPackageSnapshot
): OoxmlValidationResult {
  const relationshipErrors: string[] = [];

  for (const [sourcePartName, table] of snapshot.relationships.byPart) {
    const duplicateIds =
      (table as Partial<ParsedRelationshipTable>).duplicateIds ?? [];
    for (const duplicateId of duplicateIds) {
      relationshipErrors.push(
        `Duplicate relationship id ${duplicateId} in ${sourcePartName}`
      );
    }

    for (const relationship of table.relationships.values()) {
      if (relationship.targetMode === "External") {
        continue;
      }

      const targetPartName = resolveRelationshipTarget(
        sourcePartName,
        relationship.target
      );
      if (!snapshot.parts.has(targetPartName)) {
        relationshipErrors.push(
          `Missing relationship target ${targetPartName} from ${sourcePartName}#${relationship.id}`
        );
      }
    }
  }

  return {
    ok: relationshipErrors.length === 0,
    changedParts: [],
    unchangedPartHashes: {},
    relationshipErrors,
    protectedTokenErrors: [],
    witnessWarnings: [],
    warnings: [],
  };
}

export function parseRelationshipPartNameToSourcePartName(
  relationshipPartName: string
): string {
  if (relationshipPartName === ROOT_RELATIONSHIPS_PART) {
    return ROOT_RELATIONSHIPS_PART;
  }

  if (
    relationshipPartName.startsWith("_rels/") &&
    relationshipPartName.endsWith(".rels")
  ) {
    return relationshipPartName.slice("_rels/".length, -".rels".length);
  }

  const marker = "/_rels/";
  const markerIndex = relationshipPartName.lastIndexOf(marker);
  if (markerIndex === -1 || !relationshipPartName.endsWith(".rels")) {
    return relationshipPartName;
  }

  const directory = relationshipPartName.slice(0, markerIndex);
  const relatedFile = relationshipPartName.slice(
    markerIndex + marker.length,
    -".rels".length
  );
  return directory ? `${directory}/${relatedFile}` : relatedFile;
}

export function resolveRelationshipTarget(
  sourcePartName: string,
  target: string
): string {
  const strippedTarget = stripLeadingSlash(target);
  if (target.startsWith("/")) {
    return strippedTarget;
  }

  if (sourcePartName === ROOT_RELATIONSHIPS_PART) {
    return strippedTarget;
  }

  const sourceDirectory = sourcePartName.includes("/")
    ? sourcePartName.slice(0, sourcePartName.lastIndexOf("/"))
    : "";
  return normalizePackagePath(
    sourceDirectory ? `${sourceDirectory}/${strippedTarget}` : strippedTarget
  );
}

export function relationshipPartNameForSourcePartName(
  sourcePartName: string
): string {
  if (sourcePartName === ROOT_RELATIONSHIPS_PART) {
    return ROOT_RELATIONSHIPS_PART;
  }

  const slashIndex = sourcePartName.lastIndexOf("/");
  if (slashIndex === -1) {
    return `_rels/${sourcePartName}.rels`;
  }

  const directory = sourcePartName.slice(0, slashIndex);
  const fileName = sourcePartName.slice(slashIndex + 1);
  return `${directory}/_rels/${fileName}.rels`;
}

function isRelationshipsPart(partName: string): boolean {
  return partName === ROOT_RELATIONSHIPS_PART || partName.endsWith(".rels");
}

function compareRelationshipIds(a: string, b: string): number {
  const aNumeric = /^rId(\d+)$/.exec(a);
  const bNumeric = /^rId(\d+)$/.exec(b);
  if (aNumeric && bNumeric) {
    return Number(aNumeric[1]) - Number(bNumeric[1]);
  }
  return a.localeCompare(b);
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
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;");
}

function stripLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function normalizePackagePath(path: string): string {
  const output: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      output.pop();
      continue;
    }
    output.push(segment);
  }
  return output.join("/");
}
