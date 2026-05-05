/**
 * ESLint rule: no-direct-tracked-file-write
 *
 * Forbids direct fs.writeFile / fs.writeFileSync / fs.promises.writeFile calls
 * in the directories that historically write tracked CriticMarkup files.
 * All such writes must go through writeTrackedFile() / writeTrackedFileSync()
 * from packages/cli/src/engine/write-tracked-file.ts.
 *
 * Per spec §3.7 / Tranche 6 Task 6.4.
 */

/** @type {import('eslint').Rule.RuleModule} */
const noDirectTrackedFileWrite = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid direct fs.writeFile / fs.writeFileSync / fs.promises.writeFile on tracked CriticMarkup files. Use writeTrackedFile() / writeTrackedFileSync() from @changedown/cli/engine instead.',
    },
    schema: [],
    messages: {
      directWrite:
        'Direct {{method}} on tracked files is forbidden. Use {{replacement}} from @changedown/cli/engine.',
    },
  },

  create(context) {
    const filename = context.getFilename();

    // Whitelist: write-tracked-file.ts itself wraps fs.writeFile internally.
    if (filename.endsWith('write-tracked-file.ts')) return {};

    // Only enforce in the directories that write tracked CriticMarkup files.
    const guardedPaths = [
      '/cli/src/engine/handlers/',
      '/cli/src/commands/',
      '/cli/src/index.ts',
      '/lsp-server/src/',
      '/core/src/host/services/',
    ];
    if (!guardedPaths.some((p) => filename.includes(p))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;

        const methodName = callee.property?.name;
        if (methodName !== 'writeFile' && methodName !== 'writeFileSync') return;

        const replacement =
          methodName === 'writeFileSync'
            ? 'writeTrackedFileSync()'
            : 'writeTrackedFile()';

        context.report({
          node,
          messageId: 'directWrite',
          data: { method: `fs.${methodName}`, replacement },
        });
      },
    };
  },
};

export default noDirectTrackedFileWrite;
