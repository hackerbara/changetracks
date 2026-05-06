#!/usr/bin/env bash
#
# Wrapper around scripts/release.mjs that handles version bumping.
#
# Usage:
#   bash scripts/release-npm.sh                # patch bump (default)
#   bash scripts/release-npm.sh patch          # 0.4.3 → 0.4.4
#   bash scripts/release-npm.sh minor          # 0.4.3 → 0.5.0
#   bash scripts/release-npm.sh major          # 0.4.3 → 1.0.0
#   bash scripts/release-npm.sh 1.2.3          # explicit version
#
# Reads current version from packages/cli/package.json (the canonical
# monorepo version since release.mjs bumps every package to the same
# string). Confirms the target with you, then delegates to release.mjs
# which handles the rest: bumps every package + version.ts + plugin.json,
# builds, lints, runs tests, prompts before each publish step
# (npm via publish-npm.sh including @changedown/mcp by default,
# VS Code Marketplace, Open VSX, git tag).
#
set -euo pipefail
cd "$(dirname "$0")/.."

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
DIM='\033[2m'
RESET='\033[0m'

CURRENT=$(node -p "require('./packages/cli/package.json').version")
ARG="${1:-patch}"

case "$ARG" in
  patch|minor|major)
    TARGET=$(node -e "
      const [maj, min, pat] = '$CURRENT'.split('.').map(Number);
      const bump = '$ARG';
      if (bump === 'patch') console.log(\`\${maj}.\${min}.\${pat + 1}\`);
      else if (bump === 'minor') console.log(\`\${maj}.\${min + 1}.0\`);
      else if (bump === 'major') console.log(\`\${maj + 1}.0.0\`);
    ")
    ;;
  *)
    if [[ ! "$ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
      echo "ERROR: '$ARG' is not 'patch', 'minor', 'major', or a valid X.Y.Z(-tag) version" >&2
      exit 1
    fi
    TARGET="$ARG"
    ;;
esac

echo -e "${BOLD}ChangeDown npm release${RESET}"
echo -e "  current: ${DIM}$CURRENT${RESET}"
echo -e "  target:  ${GREEN}$TARGET${RESET}"
echo ""

if [[ "$TARGET" == "$CURRENT" ]]; then
  echo -e "${YELLOW}Note:${RESET} target version equals current version — release.mjs will still"
  echo -e "      bump sibling packages currently below this version (e.g. core/docx/mcp at 0.4.0)."
  echo ""
fi

read -p "Proceed? (y/N) " ANSWER
if [[ "$ANSWER" != "y" && "$ANSWER" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

exec node scripts/release.mjs --version="$TARGET"
