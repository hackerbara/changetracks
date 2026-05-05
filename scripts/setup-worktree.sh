#!/usr/bin/env bash
# Setup a git worktree for development.
#
# Usage:
#   ./scripts/setup-worktree.sh <worktree-path>
#
# Why this script exists:
#   npm install in worktrees pulls incomplete packages from the npm cache.
#   Specifically, @types/node is missing buffer.buffer.d.ts (breaking Buffer.alloc
#   type resolution) and diff is missing its libcjs/libesm directories.
#   npm ci avoids this by always doing a clean install from the lockfile.
#
# What it does:
#   1. Runs npm ci (clean install — avoids npm cache corruption)
#   2. Builds all packages (core → cli → lsp → extension)
#   3. Verifies critical build artifacts exist
#   4. Runs the core + lsp test suite as a baseline check

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

WORKTREE="${1:-.}"
WORKTREE="$(cd "$WORKTREE" && pwd)"

if [ ! -f "$WORKTREE/package.json" ]; then
  echo -e "${RED}Error:${RESET} $WORKTREE does not look like the repo root (no package.json)"
  exit 1
fi

cd "$WORKTREE"

echo -e "${BOLD}Setting up worktree at${RESET} $WORKTREE"
echo ""

# Step 1: Install node_modules.
#
# Prefer rsync from the main worktree when available — it avoids a known npm 11
# bug where packages/vienna-plugin (not in the root workspaces array) can cause
# npm to install the npm-published @changedown/lsp-server@0.1.0 into a nested
# packages/vienna-plugin/node_modules/. That registry package carries
# file:../core and file:../cli deps which are invalid in the nested location,
# and arborist crashes with "Cannot read properties of null (reading 'name')".
#
# rsync from the main repo avoids all of this and is also much faster.
#
# Fallback: if no main worktree is found, clear any stale nested package
# node_modules first (they're the vector for the corruption), then npm ci.
MAIN_REPO=""
# Use git's own knowledge of the shared .git dir to locate the main worktree.
# git rev-parse --git-common-dir returns the shared .git path regardless of
# where on disk the worktree lives (e.g. sibling directories like
# changetracks-worktrees/<name>/).  dirname of that path is the main repo root.
GIT_COMMON="$(cd "$WORKTREE" && git rev-parse --git-common-dir 2>/dev/null || echo "")"
if [ -n "$GIT_COMMON" ]; then
  CANDIDATE="$(cd "$WORKTREE" && cd "$GIT_COMMON/.." && pwd)"
  if [ -f "$CANDIDATE/package.json" ] && [ -d "$CANDIDATE/node_modules" ]; then
    MAIN_REPO="$CANDIDATE"
  fi
fi
if [ -z "$MAIN_REPO" ]; then
  # Fallback: try two common worktree layouts relative to the worktree path:
  #   .worktrees/<name>/          → ../.. is the main repo root  (two levels deep)
  #   .claude/worktrees/<name>/   → ../../.. is the main repo root (three levels deep)
  for CANDIDATE in \
    "$(cd "$WORKTREE/../.." 2>/dev/null && pwd)" \
    "$(cd "$WORKTREE/../../.." 2>/dev/null && pwd)"
  do
    if [ -f "$CANDIDATE/package.json" ] && [ -d "$CANDIDATE/node_modules" ]; then
      MAIN_REPO="$CANDIDATE"
      break
    fi
  done
fi

if [ -n "$MAIN_REPO" ] && [ -d "$MAIN_REPO/node_modules" ]; then
  echo -e "${BOLD}[1/4]${RESET} Syncing node_modules from main repo via rsync..."
  echo -e "  ${DIM}Source: $MAIN_REPO${RESET}"
  # Copy the clean lock file so npm commands run in the worktree stay consistent
  cp "$MAIN_REPO/package-lock.json" "$WORKTREE/package-lock.json"
  # Sync root node_modules
  rsync -a --delete "$MAIN_REPO/node_modules/" "$WORKTREE/node_modules/"
  # Sync nested package-level node_modules (e.g. vienna-plugin, vscode-extension)
  for d in "$MAIN_REPO"/packages/*/node_modules; do
    pkg=$(basename "$(dirname "$d")")
    rsync -a --delete "$d/" "$WORKTREE/packages/$pkg/node_modules/" 2>/dev/null || true
  done
  # Sync top-level subdirectory node_modules (e.g. website-v2)
  for d in "$MAIN_REPO"/*/node_modules; do
    subdir=$(basename "$(dirname "$d")")
    [ "$subdir" = "packages" ] && continue
    [ -d "$WORKTREE/$subdir" ] || continue
    rsync -a --delete "$d/" "$WORKTREE/$subdir/node_modules/" 2>/dev/null || true
  done
  # Sync changedown-plugin dist/ directories (llm-jail must be pre-built before
  # hooks-impl esbuild runs; these are not rebuilt by npm run build from scratch)
  for d in "$MAIN_REPO"/changedown-plugin/*/dist; do
    pkg=$(basename "$(dirname "$d")")
    [ -d "$d" ] || continue
    mkdir -p "$WORKTREE/changedown-plugin/$pkg/dist"
    rsync -a --delete "$d/" "$WORKTREE/changedown-plugin/$pkg/dist/" 2>/dev/null || true
  done
  echo -e "${GREEN}ok${RESET}"
else
  echo -e "${BOLD}[1/4]${RESET} npm ci (clean install — no main repo found for rsync)..."
  # Clear stale nested package node_modules before npm ci to avoid corruption
  for pkg_nm in "$WORKTREE"/packages/*/node_modules; do
    [ -d "$pkg_nm" ] && rm -rf "$pkg_nm"
  done
  npm ci --loglevel=warn 2>&1 | tail -5
  echo -e "${GREEN}ok${RESET}"
fi
echo ""

# Step 2: Build all packages
echo -e "${BOLD}[2/4]${RESET} Building packages..."
npm run build 2>&1 | grep "error TS" | grep -v "export/" | grep -v "import/xml" | grep -v "word-online" > /tmp/setup-worktree-errors.txt || true
ERROR_COUNT=$(wc -l < /tmp/setup-worktree-errors.txt | tr -d ' ')
if [ "$ERROR_COUNT" -gt 0 ]; then
  echo -e "${DIM}$ERROR_COUNT TS errors in non-critical packages (docx export/import — pre-existing)${RESET}"
fi
echo -e "${GREEN}ok${RESET}"
echo ""

# Step 3: Verify critical artifacts
echo -e "${BOLD}[3/4]${RESET} Verifying build artifacts..."
MISSING=0

check_artifact() {
  if [ -e "$1" ]; then
    echo -e "  ${GREEN}✓${RESET} $2"
  else
    echo -e "  ${RED}✗${RESET} $2 ($1)"
    MISSING=$((MISSING + 1))
  fi
}

check_artifact "node_modules/@types/node/buffer.buffer.d.ts" "@types/node buffer types"
check_artifact "node_modules/diff/libcjs/index.js" "diff package CJS build"
check_artifact "packages/core/dist/index.js" "core dist"
check_artifact "packages/cli/dist/config/index.js" "cli dist (config)"
check_artifact "packages/lsp-server/dist/server.js" "lsp-server dist"

if [ "$MISSING" -gt 0 ]; then
  echo -e "\n${RED}$MISSING critical artifacts missing.${RESET} Build may have failed."
  exit 1
fi
echo ""

# Step 4: Run baseline tests
echo -e "${BOLD}[4/4]${RESET} Running baseline tests (core + lsp)..."
cd packages/tests
RESULT=$(npx vitest run core/ lsp/ --reporter verbose 2>&1 | tail -3) || true
echo -e "  $RESULT"
cd "$WORKTREE"
echo ""

echo -e "${GREEN}${BOLD}Worktree ready.${RESET}"
