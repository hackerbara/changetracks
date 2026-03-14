import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ImportOptions, ImportStats } from '../types.js';
import { runPandoc } from './pandoc-runner.js';
import {
  extractComments,
  extractCommentRanges,
} from './comment-extractor.js';
import { astToMarkup } from './ast-to-markup.js';
import {
  extractMedia,
  renameMediaFolder,
  inventoryImages,
} from './media-extractor.js';
import type { PandocAst } from './pandoc-runner.js';
import type { ImageInfo } from '../shared/image-types.js';

export async function importDocx(
  docxPath: string,
  options?: ImportOptions
): Promise<{ markdown: string; stats: ImportStats; mediaDir?: string; images?: ImageInfo[] }> {
  const mergeSubstitutions = options?.mergeSubstitutions ?? true;
  const comments = options?.comments ?? true;

  // Step 1: Get AST and extract media in a single pandoc call (when enabled)
  let ast: PandocAst;
  let finalMediaDir: string | undefined;
  let images: ImageInfo[] | undefined;

  if (options?.extractMedia !== false) {
    const outputDir = options?.mediaDir
      ?? fs.mkdtempSync(path.join(os.tmpdir(), 'changetracks-media-'));
    const result = extractMedia(docxPath, outputDir, options?.pandocPath);
    if (result) {
      ast = result.ast;
      const basename = path.basename(docxPath, path.extname(docxPath));
      finalMediaDir = renameMediaFolder(result.extractDir, basename);
      images = inventoryImages(finalMediaDir);
    } else {
      // Media extraction failed — fall back to AST-only pandoc call
      ast = runPandoc(docxPath, options?.pandocPath).ast;
    }
  } else {
    ast = runPandoc(docxPath, options?.pandocPath).ast;
  }

  // Step 3: Extract comments from DOCX ZIP (if comments enabled)
  // Read the file once and pass the buffer to both extractors
  let commentData:
    | {
        allComments: Map<string, import('./comment-extractor.js').DocxComment>;
        rangedIds: Set<string>;
        replies: Map<string, string[]>;
      }
    | undefined;

  if (comments) {
    const fileBuffer = fs.readFileSync(docxPath);
    const allComments = await extractComments(fileBuffer);
    if (allComments.size > 0) {
      const { rangedIds, replies } = await extractCommentRanges(
        fileBuffer,
        allComments
      );
      commentData = { allComments, rangedIds, replies };
    }
  }

  // Step 4: Convert AST to CriticMarkup
  const result = astToMarkup(ast, {
    mergeSubstitutions,
    comments,
    commentData,
  });

  // Step 5: Rewrite image paths from absolute pandoc temp paths to relative media folder paths.
  // Pandoc emits absolute paths like /tmp/.../extractDir/media/hash.png in the AST.
  // After renameMediaFolder, files live at <basename>_media/hash.png relative to the output.
  // The markdown must use the relative folder name so images work portably.
  let { markdown } = result;
  if (finalMediaDir) {
    const mediaDirName = path.basename(finalMediaDir);
    markdown = markdown.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_match, alt, src) => {
        const filename = path.basename(src);
        return `![${alt}](${mediaDirName}/${filename})`;
      },
    );
  }

  return { markdown, stats: result.stats, mediaDir: finalMediaDir, images };
}
