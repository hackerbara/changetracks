import { XMLParser } from "fast-xml-parser";
import type { OoxmlMathToken } from "./index.js";

export interface ProjectOoxmlMathTokenInput {
  partName: string;
  path: string;
  xml: string;
  xmlStart?: number;
  xmlEnd?: number;
  ordinal: number;
}

export function projectOoxmlMathToken(input: ProjectOoxmlMathTokenInput): OoxmlMathToken {
  const displayMode = hasOmmlElement(input.xml, "oMathPara");
  const unsupported = isUnsupportedOmml(input.xml);
  const latex = ommlToLatex(input.xml, input.ordinal);
  const markdown = mathMarkdown(latex, displayMode);
  return {
    kind: "math",
    partName: input.partName,
    path: input.path,
    displayMode,
    latex,
    ommlXml: input.xml,
    latexHash: stableStringHash(latex),
    plainStart: 0,
    plainEnd: markdown.length,
    markdownStart: 0,
    markdownEnd: markdown.length,
    xmlStart: input.xmlStart,
    xmlEnd: input.xmlEnd,
    preservation: unsupported ? "unsupported" : "semantic-preserved",
  };
}

export function mathMarkdown(latex: string, displayMode: boolean): string {
  return displayMode ? `$$${latex}$$` : `$${latex}$`;
}

export function ommlToLatex(ommlXml: string, ordinal = 0): string {
  void ordinal;
  if (isUnsupportedOmml(ommlXml)) {
    return stableOmmlPlaceholder(ommlXml);
  }
  const text = sanitizeLatex(walkOmmlEntries(ORDERED_PARSER.parse(ommlXml)));
  return text.trim() || stableOmmlPlaceholder(ommlXml);
}

export async function latexToOmmlXml(latex: string, displayMode: boolean): Promise<string> {
  const { latexToOmmlXml: buildLatexToOmmlXml } = await import("../export/math-builder.js");
  return buildLatexToOmmlXml(latex, displayMode);
}

function isUnsupportedOmml(ommlXml: string): boolean {
  void ommlXml;
  return false;
}

function hasOmmlElement(ommlXml: string, localName: string): boolean {
  const escapedLocalName = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<[A-Za-z_][\\w.-]*:${escapedLocalName}(?:\\s|>|/)`).test(
    ommlXml
  );
}

function stableOmmlPlaceholder(ommlXml: string): string {
  return `\\mathrm{OOXMLMath}_{${stableStringHash(ommlXml)}}`;
}

const ORDERED_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function walkOmmlEntries(entries: unknown): string {
  if (!Array.isArray(entries)) {
    return "";
  }

  return entries.map(walkOmmlEntry).join("");
}

function walkOmmlEntry(entry: unknown): string {
  if (!entry || typeof entry !== "object") {
    return "";
  }

  const record = entry as Record<string, unknown>;
  const tag = Object.keys(record).find((key) => key !== ":@" && key !== "#text");
  if (!tag) {
    const text = record["#text"];
    return typeof text === "string" || typeof text === "number"
      ? normalizeMathText(decodeXmlText(String(text)))
      : "";
  }

  const localName = tag.includes(":") ? tag.split(":").pop()! : tag;
  const children = Array.isArray(record[tag]) ? record[tag] : [];
  switch (localName) {
    case "t":
      return walkOmmlEntries(children);
    case "instrText":
    case "fldChar":
    case "proofErr":
    case "bookmarkStart":
    case "bookmarkEnd":
      return "";
    case "oMathPara":
    case "oMath":
    case "r":
    case "num":
    case "den":
    case "e":
    case "sup":
    case "sub":
    case "deg":
      return walkOmmlEntries(children);
    case "eqArr":
      return equationArrayLatex(children);
    case "f":
      return `\\frac{${walkFirstLocalChild(children, "num")}}{${walkFirstLocalChild(
        children,
        "den"
      )}}`;
    case "sSup":
      return `${latexGroup(walkFirstLocalChild(children, "e").trim())}^{${walkFirstLocalChild(
        children,
        "sup"
      ).trim()}}`;
    case "sSub":
      return `${latexGroup(walkFirstLocalChild(children, "e").trim())}_{${walkFirstLocalChild(
        children,
        "sub"
      ).trim()}}`;
    case "sSubSup":
      return `${latexGroup(walkFirstLocalChild(children, "e").trim())}_{${walkFirstLocalChild(
        children,
        "sub"
      ).trim()}}^{${walkFirstLocalChild(children, "sup").trim()}}`;
    case "rad": {
      const degree = walkFirstLocalChild(children, "deg");
      const body = walkFirstLocalChild(children, "e");
      return degree ? `\\sqrt[${degree}]{${body}}` : `\\sqrt{${body}}`;
    }
    case "acc": {
      const body = walkFirstLocalChild(children, "e").trim();
      const accent = findDescendantAttr(children, "chr", "m:val");
      if (accent === "⃗" && !body.startsWith("\\vec{")) {
        const subscriptedBase = /^([A-Za-z]|\\[A-Za-z]+)_\{(.+)\}$/.exec(body);
        return subscriptedBase
          ? `\\vec{${subscriptedBase[1]}}_{${subscriptedBase[2]}}`
          : `\\vec{${body}}`;
      }
      if (!accent && body && !body.startsWith("\\hat{")) {
        return `\\hat{${body}}`;
      }
      return body;
    }
    case "d": {
      const body = walkFirstLocalChild(children, "e").trim();
      if (/SEQ Equation/.test(body)) return "";
      const rawOpen = findDescendantAttr(children, "begChr", "m:val");
      const rawClose = findDescendantAttr(children, "endChr", "m:val");
      const open = rawOpen === undefined && rawClose === undefined ? "(" : normalizeDelimiter(rawOpen ?? "");
      const close = rawOpen === undefined && rawClose === undefined ? ")" : normalizeDelimiter(rawClose ?? "");
      const matrixEnv = matrixEnvironmentForDelimiters(open, close);
      if (matrixEnv && body.startsWith("\\begin{matrix}") && body.endsWith("\\end{matrix}")) {
        return body.replace("\\begin{matrix}", `\\begin{${matrixEnv}}`).replace("\\end{matrix}", `\\end{${matrixEnv}}`);
      }
      return `${open}${body}${close}`;
    }
    case "nary": {
      const op =
        findDescendantAttr(children, "chr", "m:val") ?? "∑";
      const command = op === "∫" ? "\\int" : op === "∏" ? "\\prod" : "\\sum";
      const sub = walkFirstLocalChild(children, "sub");
      const sup = walkFirstLocalChild(children, "sup");
      const body = walkFirstLocalChild(children, "e");
      return `${command}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""}${body ? ` ${body}` : ""}`;
    }
    case "func": {
      const name = walkFirstLocalChild(children, "fName");
      const body = walkFirstLocalChild(children, "e");
      return `\\${name}${body ? `{${body}}` : ""}`;
    }
    case "fName":
      return walkOmmlEntries(children).trim();
    case "m":
      return matrixLatex(children);
    case "mr":
      return matrixRowLatex(children);
    default:
      return walkOmmlEntries(children);
  }
}

function equationArrayLatex(entries: unknown[]): string {
  const rows = entries
    .filter((entry) => entryLocalName(entry) === "e")
    .map((entry) => walkOmmlEntry(entry).trim())
    .filter(Boolean);
  if (rows.length <= 1) return rows[0] ?? "";
  return `\\begin{aligned}${rows.join(" \\\\ ")}\\end{aligned}`;
}

function matrixLatex(entries: unknown[]): string {
  const rows = entries
    .filter((entry) => entryLocalName(entry) === "mr")
    .map((row) => matrixRowLatex(childrenOfEntry(row)));
  return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
}

function matrixRowLatex(entries: unknown[]): string {
  return entries
    .filter((entry) => entryLocalName(entry) === "e")
    .map((cell) => walkOmmlEntry(cell))
    .join(" & ");
}

function matrixEnvironmentForDelimiters(
  open: string,
  close: string
): string | undefined {
  if (open === "(" && close === ")") return "pmatrix";
  if (open === "[" && close === "]") return "bmatrix";
  if (open === "{" && close === "}") return "Bmatrix";
  if (open === "|" && close === "|") return "vmatrix";
  if (open === "‖" && close === "‖") return "Vmatrix";
  return undefined;
}

function normalizeDelimiter(delimiter: string): string {
  switch (delimiter) {
    case "⟨":
      return "\\langle ";
    case "⟩":
      return " \\rangle";
    default:
      return normalizeMathText(delimiter);
  }
}

function walkFirstLocalChild(entries: unknown[], localName: string): string {
  const child = entries.find((entry) => entryLocalName(entry) === localName);
  return child ? walkOmmlEntry(child) : "";
}

function entryLocalName(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const tag = Object.keys(entry as Record<string, unknown>).find(
    (key) => key !== ":@" && key !== "#text"
  );
  return tag?.includes(":") ? tag.split(":").pop() : tag;
}

function childrenOfEntry(entry: unknown): unknown[] {
  if (!entry || typeof entry !== "object") return [];
  const record = entry as Record<string, unknown>;
  const tag = Object.keys(record).find(
    (key) => key !== ":@" && key !== "#text"
  );
  return tag && Array.isArray(record[tag]) ? record[tag] : [];
}

function entryAttrs(entry: unknown): Record<string, string> {
  if (!entry || typeof entry !== "object") return {};
  const attrs = (entry as Record<string, unknown>)[":@"];
  return attrs && typeof attrs === "object" ? (attrs as Record<string, string>) : {};
}

function findDescendantAttr(
  entries: unknown[],
  localName: string,
  attrName: string
): string | undefined {
  for (const entry of entries) {
    if (entryLocalName(entry) === localName) {
      const attrs = entryAttrs(entry);
      const value =
        attrs[attrName] ??
        attrs[`@_${attrName}`] ??
        (attrName.includes(":")
          ? attrs[`@_${attrName}`] ?? attrs[`@_${attrName.split(":").pop()}`]
          : undefined);
      if (typeof value === "string") return value;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const tag = Object.keys(record).find(
        (key) => key !== ":@" && key !== "#text"
      );
      const children = tag && Array.isArray(record[tag]) ? record[tag] : [];
      const found = findDescendantAttr(children, localName, attrName);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function latexGroup(value: string): string {
  return /^[A-Za-z0-9]+$/.test(value) || /^\\[A-Za-z]+$/.test(value)
    ? value
    : `{${value}}`;
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeMathText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/μ/g, "\\mu")
    .replace(/λ/g, "\\lambda")
    .replace(/Δ/g, "\\Delta")
    .replace(/Γ/g, "\\Gamma")
    .replace(/α/g, "\\alpha")
    .replace(/β/g, "\\beta")
    .replace(/γ/g, "\\gamma")
    .replace(/ρ/g, "\\rho")
    .replace(/σ/g, "\\sigma")
    .replace(/ℏ/g, "\\hbar")
    .replace(/π/g, "\\pi")
    .replace(/∞/g, "\\infty")
    .replace(/≤/g, "\\le")
    .replace(/≥/g, "\\ge")
    .replace(/≠/g, "\\ne")
    .replace(/→/g, "\\to")
    .replace(/⟨/g, "\\langle")
    .replace(/⟩/g, "\\rangle")
    .replace(/↑/g, "\\uparrow")
    .replace(/↓/g, "\\downarrow")
    .replace(/†/g, "\\dagger")
    .replace(/∘/g, "\\circ")
    .replace(/⋅/g, "\\cdot")
    .replace(/×/g, "\\times");
}

function sanitizeLatex(latex: string): string {
  return latex
    .replace(/#\s*SEQ Equation\s*\\\*\s*ARABIC\s*\d*/g, "")
    .replace(/#\s*$/g, "")
    .replace(/\^\{\^\{\\dagger\}\}/g, "^{\\dagger}")
    .replace(
      /(\\(?:alpha|beta|gamma|Delta|Gamma|lambda|mu|pi|rho|sigma|hbar|langle|rangle))(?=[A-Za-z])/g,
      "$1 "
    )
    .replace(/(\\(?:uparrow|downarrow))(?=\\(?:uparrow|downarrow))/g, "$1 ")
    .replace(/\s+}/g, "}")
    .replace(/\{\s+/g, "{");
}

export function stableStringHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
