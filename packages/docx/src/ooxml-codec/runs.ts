import {
  formattedRunsToMarkdown,
  inlineSegmentsToFormattedRuns,
  markdownToFormattedRuns,
  parseInlineSegments,
} from "../inline-codec/index.js";
import type { FormattedRun } from "../inline-codec/index.js";
import { latexToOmmlXml, mathMarkdown } from "./math.js";
import type { OoxmlRelationship } from "./index.js";
import type { RelationshipAllocator } from "./relationships.js";

export interface FormattingPlanToOoxmlRunsInput {
  markdown: string;
  allocator?: RelationshipAllocator;
  baseRunPropertiesXml?: string;
}

export interface FormattingPlanToOoxmlRunsResult {
  xml: string;
  plainText: string;
  markdownText: string;
  relationshipsAdded: readonly OoxmlRelationship[];
}

export function formattingPlanToOoxmlRuns(
  input: FormattingPlanToOoxmlRunsInput
): FormattingPlanToOoxmlRunsResult {
  const relationshipsAdded: OoxmlRelationship[] = [];
  const runs = markdownToFormattedRuns(input.markdown);
  const xml = runs
    .map((run) => {
      if (run.hyperlink) {
        if (!input.allocator) {
          throw new Error(
            `Cannot emit OOXML hyperlink without relationship allocator: ${run.hyperlink}`
          );
        }
        const relationship = input.allocator.addExternalHyperlink(
          run.hyperlink
        );
        relationshipsAdded.push(relationship);
        return `<w:hyperlink r:id="${escapeXmlAttribute(
          relationship.id
        )}">${emitRun(run, input.baseRunPropertiesXml)}</w:hyperlink>`;
      }

      return emitRun(run, input.baseRunPropertiesXml);
    })
    .join("");

  return {
    xml,
    plainText: runs.map((run) => run.text).join(""),
    markdownText: formattedRunsToMarkdown(runs),
    relationshipsAdded,
  };
}

export async function formattingPlanToSemanticOoxmlRuns(
  input: FormattingPlanToOoxmlRunsInput
): Promise<FormattingPlanToOoxmlRunsResult> {
  const relationshipsAdded: OoxmlRelationship[] = [];
  let xml = "";
  let plainText = "";
  let markdownText = "";

  for (const segment of parseInlineSegments(input.markdown)) {
    if (segment.kind === "math") {
      xml += await latexToOmmlXml(segment.latex, segment.displayMode);
      plainText += segment.latex;
      markdownText += mathMarkdown(segment.latex, segment.displayMode);
      continue;
    }

    const runs = inlineSegmentsToFormattedRuns([segment]);
    for (const run of runs) {
      if (run.hyperlink) {
        if (!input.allocator) {
          throw new Error(
            `Cannot emit OOXML hyperlink without relationship allocator: ${run.hyperlink}`
          );
        }
        const relationship = input.allocator.addExternalHyperlink(
          run.hyperlink
        );
        relationshipsAdded.push(relationship);
        xml += `<w:hyperlink r:id="${escapeXmlAttribute(
          relationship.id
        )}">${emitRun(run, input.baseRunPropertiesXml)}</w:hyperlink>`;
      } else {
        xml += emitRun(run, input.baseRunPropertiesXml);
      }
    }
    plainText += runs.map((run) => run.text).join("");
    markdownText += formattedRunsToMarkdown(runs);
  }

  return { xml, plainText, markdownText, relationshipsAdded };
}

function emitRun(run: FormattedRun, baseRunPropertiesXml?: string): string {
  const runProperties = emitRunProperties(run, baseRunPropertiesXml);
  const space = /^\s|\s$/.test(run.text) ? ' xml:space="preserve"' : "";
  return `<w:r>${runProperties}<w:t${space}>${escapeXmlText(
    run.text
  )}</w:t></w:r>`;
}

function emitRunProperties(
  run: FormattedRun,
  baseRunPropertiesXml?: string
): string {
  const properties = [
    baseRunPropertiesXml,
    run.bold ? "<w:b/>" : undefined,
    run.italic ? "<w:i/>" : undefined,
    run.strikethrough ? "<w:strike/>" : undefined,
    run.underline ? '<w:u w:val="single"/>' : undefined,
    run.code ? '<w:rStyle w:val="Code"/>' : undefined,
  ].filter(Boolean);

  return properties.length > 0 ? `<w:rPr>${properties.join("")}</w:rPr>` : "";
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
