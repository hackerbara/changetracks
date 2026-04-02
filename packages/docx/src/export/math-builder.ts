// packages/docx/src/export/math-builder.ts
//
// MathML-to-docx walker adapted from markdown-docx (MIT license)
// https://github.com/vace/markdown-docx/blob/main/src/extensions/mathml-to-docx.ts

import {
  Math as DocxMath,
  MathRun, MathFraction, MathRadical, MathSuperScript, MathSubScript,
  MathSubSuperScript, MathSum, MathIntegral,
  XmlComponent,
} from 'docx';
import type { MathComponent } from 'docx';
import { XMLParser } from 'fast-xml-parser';
import katex from 'katex';

// --- Public API ---

/**
 * Convert a LaTeX string to a docx Math paragraph child.
 * Uses KaTeX to render LaTeX → MathML, then walks the MathML tree
 * to build native docx MathComponent objects.
 *
 * Falls back to a plaintext MathRun if KaTeX cannot parse the LaTeX.
 */
export function latexToDocxMath(latex: string, displayMode: boolean): DocxMath {
  let children: MathComponent[];
  try {
    const mathml = katex.renderToString(latex, {
      output: 'mathml',
      displayMode,
      throwOnError: true,
    });
    children = mathmlToDocxChildren(mathml);
  } catch {
    // KaTeX parse failure — fall back to raw LaTeX as plaintext
    children = [new MathRun(latex)];
  }
  if (children.length === 0) {
    children = [new MathRun(latex)];
  }
  return new DocxMath({ children });
}

// --- Vendored MathML-to-docx walker (adapted from markdown-docx, MIT license) ---

// OMML Matrix helpers
class MathMatrixElement extends XmlComponent {
  constructor(children: MathComponent[]) {
    super('m:e');
    for (const child of children) this.root.push(child as unknown as XmlComponent);
  }
}

class MathMatrixRow extends XmlComponent {
  constructor(cells: MathComponent[][]) {
    super('m:mr');
    for (const cell of cells) this.root.push(new MathMatrixElement(cell) as unknown as XmlComponent);
  }
}

class MathMatrix extends XmlComponent {
  constructor(rows: MathComponent[][][]) {
    super('m:m');
    for (const row of rows) this.root.push(new MathMatrixRow(row) as unknown as XmlComponent);
  }
}

// Convert KaTeX MathML string to docx Math children
function mathmlToDocxChildren(mathml: string): MathComponent[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: 'text',
    preserveOrder: true,
    trimValues: false,
  });
  const json = parser.parse(mathml) as unknown[];
  const mathNode = findFirst(json, 'math');
  if (!mathNode) return [];
  const semantics = findFirst(childrenOf(mathNode), 'semantics');
  const root = semantics ? findFirst(childrenOf(semantics), 'mrow') || semantics : findFirst(childrenOf(mathNode), 'mrow') || mathNode;
  return walkChildren(childrenOf(root));
}

function walkChildren(nodes: unknown[]): MathComponent[] {
  let out: MathComponent[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const tag = tagName(n);

    // Handle NAry operators with limits
    if (tag === 'munderover' || tag === 'munder' || tag === 'mover') {
      const kids = childrenOf(n);
      const moNode = findFirst(kids, 'mo');
      const opText = moNode ? directText(childrenOf(moNode)) : '';
      const lower = tag !== 'mover' ? (kids[1] ? walkNode(kids[1]) : []) : [];
      const upper = tag !== 'munder' ? (kids[2] ? walkNode(kids[2]) : []) : [];
      const base = walkChildren(nodes.slice(i + 1));
      if (opText.includes('∑')) {
        out.push(new MathSum({ children: base, subScript: lower, superScript: upper }));
        break;
      }
      if (opText.includes('∫')) {
        out.push(new MathIntegral({ children: base, subScript: lower, superScript: upper }));
        break;
      }
    }

    // KaTeX often uses msubsup around the operator (mo)
    if (tag === 'msubsup') {
      const ks = childrenOf(n);
      const base = ks[0];
      if (tagName(base) === 'mo') {
        const op = directText(childrenOf(base));
        const lower = ks[1] ? walkNode(ks[1]) : [];
        const upper = ks[2] ? walkNode(ks[2]) : [];
        const body = walkChildren(nodes.slice(i + 1));
        if (op.includes('∑')) { out.push(new MathSum({ children: body, subScript: lower, superScript: upper })); break; }
        if (op.includes('∫')) { out.push(new MathIntegral({ children: body, subScript: lower, superScript: upper })); break; }
      }
    }

    out = out.concat(walkNode(n));
  }
  return out;
}

function walkNode(node: unknown): MathComponent[] {
  if (!node || typeof node !== 'object') return [];
  const tag = tagName(node);
  if (!tag) {
    const t = (node as Record<string, unknown>).text?.toString() || '';
    return t ? [new MathRun(t)] : [];
  }
  const kids = childrenOf(node);

  switch (tag) {
    case 'mrow':
      return walkChildren(kids);
    case 'mi':
    case 'mn':
    case 'mo':
      return textFrom(kids);
    case 'msup': {
      const [base, sup] = firstN(kids, 2);
      return [new MathSuperScript({ children: walkNode(base), superScript: walkNode(sup) })];
    }
    case 'msub': {
      const [base, sub] = firstN(kids, 2);
      return [new MathSubScript({ children: walkNode(base), subScript: walkNode(sub) })];
    }
    case 'msubsup': {
      const [base, sub, sup] = firstN(kids, 3);
      return [new MathSubSuperScript({ children: walkNode(base), subScript: walkNode(sub), superScript: walkNode(sup) })];
    }
    case 'mfrac': {
      const [num, den] = firstN(kids, 2);
      return [new MathFraction({ numerator: walkNode(num), denominator: walkNode(den) })];
    }
    case 'msqrt': {
      const [body] = firstN(kids, 1);
      return [new MathRadical({ children: walkNode(body) })];
    }
    case 'mroot': {
      const [body, degree] = firstN(kids, 2);
      return [new MathRadical({ children: walkNode(body), degree: walkNode(degree) })];
    }
    case 'mtable': {
      const rows = kids.filter((k) => tagName(k) === 'mtr');
      const rowsCells: MathComponent[][][] = rows.map((row) => {
        const cells = childrenOf(row).filter((c) => tagName(c) === 'mtd');
        return cells.map((cell) => walkChildren(childrenOf(cell)));
      });
      return [new MathMatrix(rowsCells) as unknown as MathComponent];
    }
    // Extended elements not in original vendor source.
    // NOTE: KaTeX does not produce <mfenced> (it uses <mo fence="true"> instead).
    // Retained as defensive coverage for non-KaTeX MathML sources.
    case 'mfenced': {
      const attrs = (node as Record<string, unknown>)[':@'] as Record<string, string> || {};
      const open = attrs.open || '(';
      const close = attrs.close || ')';
      const inner = walkChildren(kids);
      // Fallback: emit delimiters as MathRun text around content
      return [new MathRun(open), ...inner, new MathRun(close)];
    }
    case 'mphantom':
      return [new MathRun('')];
    case 'mspace':
      return [new MathRun(' ')];
    case 'mpadded':
      return walkChildren(kids);
    case 'menclose':
      return walkChildren(kids);
    case 'munderover':
    case 'munder':
    case 'mover': {
      const m = childrenOf(node);
      const op = textFrom(childrenOf(findFirst(m, 'mo') || {}));
      const low = tag !== 'mover' ? (m[1] ? walkNode(m[1]) : []) : [];
      const up = tag !== 'munder' ? (m[2] ? walkNode(m[2]) : []) : [];
      return op.concat(low).concat(up);
    }
    default:
      return walkChildren(kids);
  }
}

function tagName(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const keys = Object.keys(node as object).filter((k) => k !== 'text' && k !== ':@');
  return keys[0] || null;
}

function childrenOf(node: unknown): unknown[] {
  const tag = tagName(node);
  if (!tag) return [];
  const val = (node as Record<string, unknown>)[tag];
  return Array.isArray(val) ? val : (val ? [val] : []);
}

function textFrom(nodes: unknown[]): MathComponent[] {
  const texts = nodes.map((n) => ((n as Record<string, unknown>).text ?? '').toString()).join('');
  return texts ? [new MathRun(texts)] : [];
}

function directText(nodes: unknown[]): string {
  return nodes.map((n) => ((n as Record<string, unknown>).text ?? '').toString()).join('');
}

function findFirst(nodes: unknown[], name: string): unknown | null {
  for (const n of nodes) {
    if (tagName(n) === name) return n;
    const inner = findFirst(childrenOf(n), name);
    if (inner) return inner;
  }
  return null;
}

function firstN(nodes: unknown[], n: number): unknown[] {
  return nodes.slice(0, n);
}
