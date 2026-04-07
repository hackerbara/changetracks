#!/bin/bash
# Copy canonical preview.css from preview package to vscode extension.
# Run as part of the build step — vsce package requires files inside
# the extension directory.
# Can be called from any directory; resolves paths relative to monorepo root.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
cp "$ROOT/packages/preview/media/preview.css" "$ROOT/packages/vscode-extension/media/preview.css"
echo "Copied preview.css → packages/vscode-extension/media/preview.css"
