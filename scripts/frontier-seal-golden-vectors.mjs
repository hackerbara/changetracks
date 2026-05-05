#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function leanExpectedRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-seal-root-'));
  const file = join(dir, 'PrintRoot.lean');
  writeFileSync(file, `import FrontierSeals.Examples.AcceptedInsertion\n\ndef main : IO Unit := do\n  IO.println FrontierSeals.Examples.AcceptedInsertion.expectedRoot.bytes\n`);
  try {
    return execFileSync('lake', ['env', 'lean', '--run', file], {
      cwd: 'formal/frontier-seals',
      encoding: 'utf8'
    }).trimEnd();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const vector = {
  name: 'accepted-insertion-v1',
  projection: 'Current',
  currentBody: 'The API should use GraphQL for the public interface.',
  body0: 'The API should use  for the public interface.',
  events: [
    {
      parent: 'cn-7',
      localOrdinal: 0,
      globalOrdinal: 0,
      actor: '@ai:codex',
      timestamp: '2026-05-03T20:01:00Z',
      kind: 'proposal',
      op: {
        kind: 'ins',
        lineHint: 1,
        lineHash: 'a7',
        prefix: 'should use ',
        exact: 'GraphQL',
        suffix: ' for the public',
        text: 'GraphQL'
      },
      payload: []
    },
    {
      parent: 'cn-7',
      localOrdinal: 1,
      globalOrdinal: 1,
      actor: '@hackerbara',
      timestamp: '2026-05-03T20:04:00Z',
      kind: 'decision',
      op: null,
      payload: ['approved: @hackerbara 2026-05-03T20:04:00Z Correct replacement']
    }
  ],
  trustPolicy: {
    acceptedKids: ['k1'],
    signatureAssumptionAccepted: true
  },
  seal: {
    id: 's-9',
    actor: '@hackerbara',
    timestamp: '2026-05-03T20:06:00Z',
    scope: 'dseal',
    suite: 'structural-debug-only',
    kid: 'k1',
    keyFingerprint: 'fingerprint-k1',
    root: leanExpectedRoot(),
    sig: 'abstract-signature'
  },
  expectedVerifyResult: {
    sealRootMatches: true,
    kidAccepted: true,
    scopeOk: true,
    signatureAssumptionOk: true,
    scrubOk: true,
    finalBodyMatches: true,
    valid: true
  }
};

console.log(JSON.stringify(vector, null, 2));
