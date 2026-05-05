export type SemanticMarkdown =
  | { kind: "math"; latex: string; displayMode: boolean }
  | { kind: "figure"; alt: string; src: string }
  | { kind: "text" };

export function parseStandaloneSemanticMarkdown(
  markdown: string
): SemanticMarkdown {
  const trimmed = markdown.trim();
  const displayMath = /^\$\$([\s\S]+)\$\$$/.exec(trimmed);
  if (displayMath) {
    return { kind: "math", latex: displayMath[1]!, displayMode: true };
  }

  const inlineMath = /^\$([^$]+)\$$/.exec(trimmed);
  if (inlineMath) {
    return { kind: "math", latex: inlineMath[1]!, displayMode: false };
  }

  const image = /^!\[((?:\\.|[^\]])*)\]\((?:<([^>]*)>|([^)]+))\)$/.exec(trimmed);
  if (image) {
    return {
      kind: "figure",
      alt: unescapeMarkdownAlt(image[1]!),
      src: image[2] ?? image[3] ?? "",
    };
  }

  return { kind: "text" };
}

function unescapeMarkdownAlt(value: string): string {
  return value.replace(/\\([\\\[\]])/g, "$1");
}
