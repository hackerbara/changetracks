#!/usr/bin/env tsx

/**
 * extract-reasons.ts
 *
 * One-shot extraction tool: parses ChangeDown markdown docs under docs/ and
 * extracts AI-authored "reason" text (comments, approvals, rejections,
 * discussion entries) into SQLite (data/reasons.db) and JSON (data/reasons.json).
 *
 * If data/reason-explorer.html exists, embeds the JSON into it as a
 * <script id="reason-data"> block.
 *
 * Run with: npx tsx scripts/extract-reasons.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { gzipSync } from 'zlib';

import Database from 'better-sqlite3';
import { parseForFormat, ChangeType, ChangeStatus, initHashline } from '@changedown/core';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'reasons.db');
const JSON_PATH = path.join(DATA_DIR, 'reasons.json');
const HTML_PATH = path.join(DATA_DIR, 'reason-explorer.html');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk a directory recursively and collect .md file paths. */
function walkMd(dir: string, skip: string[], results: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip.includes(full)) {
        walkMd(full, skip, results);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

// (git date filter removed — we now scan for CriticMarkup markers directly,
//  which catches gitignored dirs like docs/research/ that git log can't see)

/** Map ChangeType to short string. Uses the existing changeTypeToAbbrev() but
 *  overrides Highlight→"highlight" and Comment→"comment" to match spec. */
function typeString(type: ChangeType): string {
  switch (type) {
    case ChangeType.Insertion: return 'ins';
    case ChangeType.Deletion: return 'del';
    case ChangeType.Substitution: return 'sub';
    case ChangeType.Highlight: return 'highlight';
    case ChangeType.Comment: return 'comment';
  }
}

/** Map ChangeStatus to lowercase string. */
function statusString(status: ChangeStatus): string {
  switch (status) {
    case ChangeStatus.Proposed: return 'proposed';
    case ChangeStatus.Accepted: return 'accepted';
    case ChangeStatus.Rejected: return 'rejected';
  }
}

/** Detect format from whether the file is L3 (has footnote-native blocks). */
function detectFormat(text: string): string {
  // isL3Format is not exported directly, but parseForFormat uses it internally.
  // We can detect L3 by checking for the footnote block marker pattern.
  return /^\[#cn-/m.test(text) ? 'l3' : 'l2';
}

// ---------------------------------------------------------------------------
// Types for collected data
// ---------------------------------------------------------------------------

interface ReasonRow {
  reasonId: number;
  file: string;
  directory: string;
  format: string;
  changeId: string;
  changeType: string;
  changeStatus: string;
  changeAuthor: string | null;
  changeDate: string | null;
  oldText: string | null;
  newText: string | null;
  reasonKind: string;
  reasonAuthor: string | null;
  reasonDate: string | null;
  reasonText: string | null;
  reasonLabel: string | null;
  // Pre-computed fields for Phase 2 visualizations
  reasonCategory: string | null;
  storyId: string | null;
  storyLabel: string | null;
}

// ---------------------------------------------------------------------------
// Pre-computation: Reason Categories (keyword-based taxonomy)
// ---------------------------------------------------------------------------

const CATEGORY_RULES: Array<{ category: string; keywords: RegExp }> = [
  { category: 'security',      keywords: /\b(security|vulnerab|password|credential|auth|token|encrypt|secret|plaintext|injection|xss|csrf)\b/i },
  { category: 'architecture',  keywords: /\b(architect|pattern|abstraction|decouple|modular|separation|single.?responsib|interface|encapsulat|hexagonal|composit|refactor)\b/i },
  { category: 'correctness',   keywords: /\b(correct|fix|bug|error|wrong|broken|invalid|mismatch|inconsisten|accurate|typo|mistake)\b/i },
  { category: 'clarity',       keywords: /\b(clar|ambigu|confus|readab|explicit|vague|unclear|mislead|simplif|understandab|wording)\b/i },
  { category: 'scope',         keywords: /\b(scope|yagni|mvp|out.of.scope|unnecessary|speculative|premature|over.engineer|too.broad|too.specific|belongs.in)\b/i },
  { category: 'compliance',    keywords: /\b(complian|legal|regulat|policy|requirement|standard|spec|adr|decision|convention|format)\b/i },
  { category: 'performance',   keywords: /\b(perform|latency|throughput|optimi|efficien|cache|batch|async|parallel|slow|fast)\b/i },
  { category: 'best-practice', keywords: /\b(best.practice|convention|idiom|pattern|standard|canonical|recommended|modern|deprecat)\b/i },
  { category: 'documentation', keywords: /\b(document|explain|context|reader|audience|guide|example|usage|reference)\b/i },
];

function classifyReasons(rows: ReasonRow[]) {
  for (const row of rows) {
    const text = row.reasonText ?? '';
    let matched = false;
    for (const rule of CATEGORY_RULES) {
      if (rule.keywords.test(text)) {
        row.reasonCategory = rule.category;
        matched = true;
        break;
      }
    }
    if (!matched) {
      row.reasonCategory = 'other';
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-computation: Story grouping (file + date proximity)
// ---------------------------------------------------------------------------

function assignStories(rows: ReasonRow[]) {
  // Group by file, then by date — reasons in the same file on the same day are one story
  const byFileDate = new Map<string, ReasonRow[]>();
  for (const row of rows) {
    const date = row.reasonDate ?? row.changeDate ?? 'unknown';
    const key = `${row.file}::${date}`;
    if (!byFileDate.has(key)) byFileDate.set(key, []);
    byFileDate.get(key)!.push(row);
  }

  let storyIdx = 0;
  for (const [key, group] of byFileDate) {
    if (group.length < 1) continue;
    storyIdx++;
    const [file, date] = key.split('::');
    const shortFile = file.replace('docs/', '').replace(/\.md$/, '');
    const label = `${shortFile} (${date})`;
    const id = `story-${storyIdx}`;
    for (const row of group) {
      row.storyId = id;
      row.storyLabel = label;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Initialize xxhash-wasm for L3 format parsing
  await initHashline();

  // Ensure data/ exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 1. Collect .md files from docs/ AND repo root
  const skipDirs = [
    path.join(DOCS_DIR, 'test-fixtures'),
    path.join(ROOT, 'node_modules'),
    path.join(ROOT, '.worktrees'),
    path.join(ROOT, '.superpowers'),
    path.join(ROOT, '.claude'),
  ];
  const docsFiles = walkMd(DOCS_DIR, skipDirs);
  // Root-level .md files (ARCHITECTURE.md, README.md, etc.)
  const rootFiles = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(ROOT, f));
  const allMdFiles = [...docsFiles, ...rootFiles];

  // 2. Filter to files that contain CriticMarkup (more reliable than git date filter,
  //    since gitignored dirs like docs/research/ don't appear in git log)
  const CM_MARKER = /\{\+\+|\{--|{~~|\{>>|\[\^cn-/;
  const filteredFiles = allMdFiles.filter(absPath => {
    try {
      const text = fs.readFileSync(absPath, 'utf8');
      return CM_MARKER.test(text);
    } catch {
      return false;
    }
  });

  console.log(`Found ${allMdFiles.length} .md files, ${filteredFiles.length} contain CriticMarkup`);

  // 3. Set up SQLite
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE files (
      id INTEGER PRIMARY KEY, path TEXT UNIQUE, directory TEXT,
      format TEXT, change_count INTEGER, extracted_at TEXT
    );
    CREATE TABLE changes (
      id INTEGER PRIMARY KEY, file_id INTEGER REFERENCES files(id),
      change_id TEXT, type TEXT, status TEXT, author TEXT,
      date TEXT, old_text TEXT, new_text TEXT, level INTEGER
    );
    CREATE TABLE reasons (
      id INTEGER PRIMARY KEY, change_pk INTEGER REFERENCES changes(id),
      kind TEXT, author TEXT, date TEXT, text TEXT, label TEXT,
      category TEXT, story_id TEXT, story_label TEXT
    );
    CREATE INDEX idx_reasons_kind ON reasons(kind);
    CREATE INDEX idx_reasons_author ON reasons(author);
    CREATE INDEX idx_changes_type ON changes(type);
    CREATE INDEX idx_changes_file_id ON changes(file_id);
    CREATE INDEX idx_files_directory ON files(directory);
  `);

  const insertFile = db.prepare(
    `INSERT INTO files (path, directory, format, change_count, extracted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       directory=excluded.directory, format=excluded.format,
       change_count=excluded.change_count, extracted_at=excluded.extracted_at`
  );
  const insertChange = db.prepare(
    `INSERT INTO changes (file_id, change_id, type, status, author, date, old_text, new_text, level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertReason = db.prepare(
    `INSERT INTO reasons (change_pk, kind, author, date, text, label)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // 4. Parse files and collect data
  const allReasonRows: ReasonRow[] = [];
  let totalChanges = 0;
  let totalReasons = 0;
  const extractedAt = new Date().toISOString();

  const runTransaction = db.transaction(() => {
    for (const absPath of filteredFiles) {
      const relPath = path.relative(ROOT, absPath);
      const directory = path.dirname(relPath);

      let text: string;
      try {
        text = fs.readFileSync(absPath, 'utf8');
      } catch (err) {
        console.warn(`  SKIP (read error): ${relPath}: ${err}`);
        continue;
      }

      let doc: ReturnType<typeof parseForFormat>;
      try {
        doc = parseForFormat(text);
      } catch (err) {
        console.warn(`  SKIP (parse error): ${relPath}: ${err}`);
        continue;
      }

      const changes = doc.getChanges();
      const format = detectFormat(text);
      let fileReasonCount = 0;

      // Insert file row
      insertFile.run(relPath, directory, format, changes.length, extractedAt);
      const fileId = (db.prepare('SELECT id FROM files WHERE path = ?').get(relPath) as { id: number }).id;

      for (const change of changes) {
        const author = change.metadata?.author ?? change.inlineMetadata?.author ?? null;
        const date = change.metadata?.date ?? change.inlineMetadata?.date ?? null;
        const oldText = change.originalText ?? null;
        const newText = change.modifiedText ?? null;

        const changeResult = insertChange.run(
          fileId,
          change.id,
          typeString(change.type),
          statusString(change.status),
          author,
          date,
          oldText,
          newText,
          change.level
        );
        const changePk = changeResult.lastInsertRowid as number;
        totalChanges++;

        const baseRow = {
          file: relPath,
          directory,
          format,
          changeId: change.id,
          changeType: typeString(change.type),
          changeStatus: statusString(change.status),
          changeAuthor: author,
          changeDate: date,
          oldText,
          newText,
        };

        // Extract reasons from metadata
        const meta = change.metadata;
        if (!meta) continue;

        // edit_reasoning — metadata.comment
        if (meta.comment) {
          insertReason.run(changePk, 'edit_reasoning', author, date, meta.comment, null);
          fileReasonCount++;
          totalReasons++;
          allReasonRows.push({
            ...baseRow,
            reasonId: 0, // will be overwritten after collecting
            reasonKind: 'edit_reasoning',
            reasonAuthor: author,
            reasonDate: date,
            reasonText: meta.comment,
            reasonLabel: null,
            reasonCategory: null,
            storyId: null,
            storyLabel: null,
          });
        }

        // approval
        if (meta.approvals) {
          for (const approval of meta.approvals) {
            if (!approval.reason) continue;
            const aAuthor = approval.author ?? null;
            const aDate = approval.timestamp?.date ?? approval.date ?? null;
            insertReason.run(changePk, 'approval', aAuthor, aDate, approval.reason, null);
            fileReasonCount++;
            totalReasons++;
            allReasonRows.push({
              ...baseRow,
              reasonId: 0,
              reasonKind: 'approval',
              reasonAuthor: aAuthor,
              reasonDate: aDate,
              reasonText: approval.reason,
              reasonLabel: null,
              reasonCategory: null,
              storyId: null,
              storyLabel: null,
            });
          }
        }

        // rejection
        if (meta.rejections) {
          for (const rejection of meta.rejections) {
            if (!rejection.reason) continue;
            const rAuthor = rejection.author ?? null;
            const rDate = rejection.timestamp?.date ?? rejection.date ?? null;
            insertReason.run(changePk, 'rejection', rAuthor, rDate, rejection.reason, null);
            fileReasonCount++;
            totalReasons++;
            allReasonRows.push({
              ...baseRow,
              reasonId: 0,
              reasonKind: 'rejection',
              reasonAuthor: rAuthor,
              reasonDate: rDate,
              reasonText: rejection.reason,
              reasonLabel: null,
              reasonCategory: null,
              storyId: null,
              storyLabel: null,
            });
          }
        }

        // discussion
        if (meta.discussion) {
          for (const comment of meta.discussion) {
            if (!comment.text) continue;
            const dAuthor = comment.author ?? null;
            const dDate = comment.timestamp?.date ?? comment.date ?? null;
            const dLabel = comment.label ?? null;
            insertReason.run(changePk, 'discussion', dAuthor, dDate, comment.text, dLabel);
            fileReasonCount++;
            totalReasons++;
            allReasonRows.push({
              ...baseRow,
              reasonId: 0,
              reasonKind: 'discussion',
              reasonAuthor: dAuthor,
              reasonDate: dDate,
              reasonText: comment.text,
              reasonLabel: dLabel,
              reasonCategory: null,
              storyId: null,
              storyLabel: null,
            });
          }
        }
      }

      console.log(`  ${relPath}: ${changes.length} changes, ${fileReasonCount} reasons`);
    }
  });

  runTransaction();

  // 5. Pre-compute categories and stories
  classifyReasons(allReasonRows);
  assignStories(allReasonRows);

  // Update DB with pre-computed fields
  const updateReason = db.prepare(
    'UPDATE reasons SET category = ?, story_id = ?, story_label = ? WHERE id = ?'
  );
  const updateTransaction = db.transaction(() => {
    const dbRows = db.prepare('SELECT id FROM reasons ORDER BY id').all() as { id: number }[];
    for (let i = 0; i < allReasonRows.length && i < dbRows.length; i++) {
      updateReason.run(
        allReasonRows[i].reasonCategory,
        allReasonRows[i].storyId,
        allReasonRows[i].storyLabel,
        dbRows[i].id,
      );
    }
  });
  updateTransaction();
  console.log('Pre-computed categories and stories');

  // 6. Back-fill reasonId using DB-assigned rowids
  const reasonRows = db.prepare('SELECT id FROM reasons ORDER BY id').all() as { id: number }[];
  for (let i = 0; i < allReasonRows.length && i < reasonRows.length; i++) {
    allReasonRows[i].reasonId = reasonRows[i].id;
  }

  // 6. Write JSON export
  fs.writeFileSync(JSON_PATH, JSON.stringify(allReasonRows, null, 2), 'utf8');
  console.log(`\nWrote ${JSON_PATH} (${allReasonRows.length} reason rows)`);

  // 7. Embed compressed gzip base64 into HTML (81% smaller than raw JSON)
  if (fs.existsSync(HTML_PATH)) {
    const rawJson = JSON.stringify(allReasonRows);
    const gzipped = gzipSync(rawJson);
    const b64 = gzipped.toString('base64');

    let html = fs.readFileSync(HTML_PATH, 'utf8');
    const scriptTag = `<script id="reason-data">window.__REASON_DATA_GZ = "${b64}";</script>`;
    if (html.includes('<script id="reason-data">')) {
      html = html.replace(/<script id="reason-data">[\s\S]*?<\/script>/, scriptTag);
    } else {
      if (html.includes('</body>')) {
        html = html.replace('</body>', `${scriptTag}\n</body>`);
      } else {
        html += '\n' + scriptTag + '\n';
      }
    }
    fs.writeFileSync(HTML_PATH, html, 'utf8');
    const savings = ((1 - b64.length / rawJson.length) * 100).toFixed(0);
    console.log(`Embedded compressed data: ${(rawJson.length/1024).toFixed(0)}KB → ${(b64.length/1024).toFixed(0)}KB (${savings}% smaller)`);
  } else {
    console.log(`(data/reason-explorer.html not found, skipping HTML embed)`);
  }

  db.close();

  // 8. Summary
  console.log(`\n--- Summary ---`);
  console.log(`Files processed: ${filteredFiles.length}`);
  console.log(`Total changes:   ${totalChanges}`);
  console.log(`Total reasons:   ${totalReasons}`);
  console.log(`  edit_reasoning: ${allReasonRows.filter(r => r.reasonKind === 'edit_reasoning').length}`);
  console.log(`  approval:       ${allReasonRows.filter(r => r.reasonKind === 'approval').length}`);
  console.log(`  rejection:      ${allReasonRows.filter(r => r.reasonKind === 'rejection').length}`);
  console.log(`  discussion:     ${allReasonRows.filter(r => r.reasonKind === 'discussion').length}`);
}

main();
