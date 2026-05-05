import * as fs from 'node:fs';
import * as path from 'node:path';

export interface JsonMergeOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface JsonMergeResult {
  touched: boolean;
  file: string;
  backupPath?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function deepMergeJson(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMergeJson(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function mergeJsonFile(file: string, patch: Record<string, unknown>, options: JsonMergeOptions = {}): JsonMergeResult {
  let existing: Record<string, unknown> = {};
  const existed = fs.existsSync(file);
  let oldText = '';

  if (existed) {
    oldText = fs.readFileSync(file, 'utf8');
    try {
      const parsed: unknown = JSON.parse(oldText);
      if (!isPlainObject(parsed)) {
        throw new Error(`Cannot merge ${file}: existing file is not a JSON object`);
      }
      existing = parsed;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Cannot merge ${file}: existing file is not valid JSON`);
      }
      throw err;
    }
  }

  const merged = deepMergeJson(existing, patch);
  const newText = JSON.stringify(merged, null, 2) + '\n';
  if (oldText === newText) return { touched: false, file };

  if (options.dryRun) {
    options.log?.(`[dry-run] write ${file}`);
    return { touched: true, file };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backupPath: string | undefined;
  if (existed) {
    backupPath = `${file}.changedown-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backupPath);
  }
  fs.writeFileSync(file, newText, 'utf8');
  return { touched: true, file, backupPath };
}
