import type { ImagePatchInfo, MediaInjection } from '../shared/image-types.js';
import JSZip from 'jszip';

/**
 * Wrap sentinel-marked <w:drawing> elements in <w:ins> or <w:del>.
 * Operates on the raw document.xml string.
 */
export function wrapTrackedImages(
  docXml: string,
  patches: ImagePatchInfo[],
): string {
  let result = docXml;

  for (const patch of patches) {
    const sentinelPattern = new RegExp(
      `(<w:r>)((?:(?!<\\/w:r>).)*?<wp:docPr[^>]*name="${patch.sentinelName}"[^>]*\\/>(?:(?!<\\/w:r>).)*?)(<\\/w:r>)`,
      's'
    );

    const wrapTag = patch.changeType === 'ins' ? 'w:ins' : 'w:del';

    result = result.replace(sentinelPattern, (_, open, inner, close) => {
      const cleanedInner = inner.replace(
        `name="${patch.sentinelName}"`,
        `name="Picture ${patch.revisionId}"`
      );
      return `<${wrapTag} w:id="${patch.revisionId}" w:author="${patch.author}" w:date="${patch.date}">${open}${cleanedInner}${close}</${wrapTag}>`;
    });
  }

  return result;
}

/**
 * Inject media files and their relationships into the DOCX ZIP.
 * Used for unsupported formats (TIFF, EMF, WMF) that can't go through ImageRun.
 */
export async function injectMediaFiles(
  zip: JSZip,
  injections: MediaInjection[],
): Promise<void> {
  if (injections.length === 0) return;

  for (const injection of injections) {
    zip.file(`word/media/${injection.filename}`, injection.data);
  }

  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    let rels = await relsFile.async('string');
    const rIdMatches = [...rels.matchAll(/rId(\d+)/g)];
    let maxRId = rIdMatches.length > 0
      ? Math.max(...rIdMatches.map((m) => parseInt(m[1], 10)))
      : 10;

    for (const injection of injections) {
      maxRId++;
      rels = rels.replace(
        '</Relationships>',
        `<Relationship Id="rId${maxRId}" ` +
        `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
        `Target="media/${injection.filename}"/></Relationships>`
      );
    }
    zip.file('word/_rels/document.xml.rels', rels);
  }

  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    let ct = await ctFile.async('string');
    for (const injection of injections) {
      const ext = injection.filename.split('.').pop()!;
      if (!ct.includes(`Extension="${ext}"`)) {
        ct = ct.replace(
          '</Types>',
          `<Default Extension="${ext}" ContentType="${injection.contentType}"/></Types>`
        );
      }
    }
    zip.file('[Content_Types].xml', ct);
  }
}
