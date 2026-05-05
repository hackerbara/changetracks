export class ContentTypesEditor {
  private constructor(
    private readonly defaults: Map<string, string>,
    private readonly overrides: Map<string, string>,
  ) {}

  static parse(xml: string): ContentTypesEditor {
    const defaults = new Map<string, string>();
    const overrides = new Map<string, string>();

    for (const tag of xml.matchAll(/<Default\b[^>]*>/g)) {
      const attrs = parseAttrs(tag[0]);
      const extension = attrs.Extension;
      const contentType = attrs.ContentType;
      if (extension && contentType) {
        defaults.set(normalizeExtension(extension), contentType);
      }
    }

    for (const tag of xml.matchAll(/<Override\b[^>]*>/g)) {
      const attrs = parseAttrs(tag[0]);
      const partName = attrs.PartName;
      const contentType = attrs.ContentType;
      if (partName && contentType) {
        overrides.set(stripSlash(partName), contentType);
      }
    }

    return new ContentTypesEditor(defaults, overrides);
  }

  ensureDefault(extension: string, contentType: string): void {
    const normalizedExtension = normalizeExtension(extension);
    if (!this.defaults.has(normalizedExtension)) {
      this.defaults.set(normalizedExtension, contentType);
    }
  }

  ensureOverride(partName: string, contentType: string): void {
    this.overrides.set(stripSlash(partName), contentType);
  }

  serialize(): string {
    const defaults = [...this.defaults.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([Extension, ContentType]) =>
          `<Default Extension="${escapeAttr(Extension)}" ContentType="${escapeAttr(ContentType)}"/>`,
      )
      .join("");
    const overrides = [...this.overrides.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([PartName, ContentType]) =>
          `<Override PartName="/${escapeAttr(PartName)}" ContentType="${escapeAttr(ContentType)}"/>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}${overrides}</Types>`;
  }
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? "";
    if (name) {
      attrs[name] = unescapeAttr(value);
    }
  }
  return attrs;
}

function normalizeExtension(value: string): string {
  return value.startsWith(".") ? value.slice(1).toLowerCase() : value.toLowerCase();
}

function stripSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
