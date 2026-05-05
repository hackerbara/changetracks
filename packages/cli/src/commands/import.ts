import * as fs from 'node:fs';
import * as path from 'node:path';
import { importDocx } from '@changedown/docx';
import type { ImportOptions } from '@changedown/docx';
import { writeTrackedFile } from '../engine/write-tracked-file.js';

export interface ImportCliOptions {
  output?: string;
  comments?: boolean;
}

export async function handleImport(
  file: string,
  opts: ImportCliOptions
): Promise<void> {
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }

  const importOpts: ImportOptions = {
    comments: opts.comments ?? true,
  };

  const { markdown, stats } = await importDocx(file, importOpts);

  const baseName = path.basename(file, path.extname(file));
  const outputPath = opts.output ?? `${baseName}-changedown.md`;

  await writeTrackedFile(outputPath, markdown);

  const totalChanges = stats.insertions + stats.deletions + stats.substitutions;
  console.log(`Imported: ${file} -> ${outputPath}`);
  console.log(`  Changes: ${totalChanges} (${stats.insertions} ins, ${stats.deletions} del, ${stats.substitutions} sub)`);
  console.log(`  Comments: ${stats.comments}`);
  if (stats.authors.length > 0) {
    console.log(`  Authors: ${stats.authors.join(', ')}`);
  }
}
