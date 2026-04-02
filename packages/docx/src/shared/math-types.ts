export interface MathElement {
  /** Raw OMML XML string (<m:oMath>...</m:oMath> or <m:oMathPara>...</m:oMathPara>) */
  ommlXml: string;
  /** true for <m:oMathPara> (display), false for inline <m:oMath> */
  displayMode: boolean;
  /** Document-order index for correlation with Pandoc AST Math nodes */
  index: number;
}

/**
 * Sentinel prefix for math placeholders in generated DOCX XML.
 * Pattern: `_ct_math_N` where N is the placeholder index.
 */
export const MATH_PLACEHOLDER_PREFIX = '_ct_math_';

export interface MathPatchInfo {
  /** Placeholder text in document.xml to find and replace */
  placeholder: string;
  /** Raw OMML XML to inject (from cached equation-omml metadata) */
  ommlXml: string;
}
