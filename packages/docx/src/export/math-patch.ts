import type { MathPatchInfo } from '../shared/math-types.js';

/**
 * Replace math placeholder text runs in document.xml with raw OMML XML.
 *
 * During export, math with cached OMML gets a placeholder MathRun like
 * `<m:t>_ct_math_0</m:t>`. This function replaces the entire containing
 * `<m:oMath>` element with the original OMML XML.
 *
 * Uses a split-based approach to avoid the regex spanning multiple <m:oMath>
 * elements when processing several patches sequentially.
 */
export function injectCachedMath(
  docXml: string,
  patches: MathPatchInfo[],
): string {
  for (const patch of patches) {
    const placeholderIdx = docXml.indexOf(patch.placeholder);
    if (placeholderIdx === -1) continue;

    // Find the <m:oMath (or <m:oMathPara) opening tag that encloses this placeholder
    const openTag = '<m:oMath';
    const openIdx = docXml.lastIndexOf(openTag, placeholderIdx);
    if (openIdx === -1) continue;

    // Find the matching </m:oMath> closing tag after the placeholder.
    // We need to handle the case where the enclosing element is <m:oMathPara>.
    // Determine whether the enclosing tag is <m:oMathPara> or <m:oMath>.
    const tagEnd = docXml.indexOf('>', openIdx);
    const openTagContent = docXml.slice(openIdx, tagEnd + 1);
    const isPara = openTagContent.startsWith('<m:oMathPara');
    const closeTag = isPara ? '</m:oMathPara>' : '</m:oMath>';

    const closeIdx = docXml.indexOf(closeTag, placeholderIdx);
    if (closeIdx === -1) continue;

    const endIdx = closeIdx + closeTag.length;
    docXml = docXml.slice(0, openIdx) + patch.ommlXml + docXml.slice(endIdx);
  }
  return docXml;
}
