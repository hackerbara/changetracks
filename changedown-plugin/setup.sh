#!/usr/bin/env bash
# Unified ChangeDown plugin setup for Claude Code and Cursor
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

usage() {
  echo "Usage: $0 [--cursor|--claude|--codex|--both]"
  echo ""
  echo "  --cursor   Install Cursor MCP config, hooks, and skill"
  echo "  --claude   Verify Claude Code plugin structure"
  echo "  --codex    Verify Codex plugin structure"
  echo "  --both     Do Cursor setup and verify Claude + Codex plugin structure"
  exit 1
}

setup_cursor() {
  echo "=== Setting up ChangeDown for Cursor ==="
  echo ""

  # Build check
  if [ ! -d "$SCRIPT_DIR/hooks-impl/dist" ]; then
    echo "Building hooks-impl..."
    (cd "$SCRIPT_DIR/hooks-impl" && npm run build)
  fi

  if [ ! -d "$SCRIPT_DIR/mcp-server/dist" ]; then
    echo "Building MCP server..."
    (cd "$SCRIPT_DIR/mcp-server" && npm run build)
  fi

  # Install hooks
  "$SCRIPT_DIR/cursor/install-hooks.sh"

  # Install skill
  "$SCRIPT_DIR/cursor/install-skill.sh"

  echo ""
  echo "=== Cursor setup complete ==="
  echo "Restart Cursor to activate hooks."
}

verify_claude() {
  echo "=== Verifying Claude Code plugin structure ==="
  echo ""

  local ok=true

  [ -f "$SCRIPT_DIR/.claude-plugin/plugin.json" ] && echo "  [OK] plugin.json" || { echo "  [MISSING] plugin.json"; ok=false; }
  [ -f "$SCRIPT_DIR/hooks/hooks.json" ] && echo "  [OK] hooks.json" || { echo "  [MISSING] hooks.json"; ok=false; }
  [ -d "$SCRIPT_DIR/mcp-server/dist" ] && echo "  [OK] mcp-server built" || { echo "  [MISSING] mcp-server/dist"; ok=false; }
  [ -d "$SCRIPT_DIR/hooks-impl/dist" ] && echo "  [OK] hooks-impl built" || { echo "  [MISSING] hooks-impl/dist"; ok=false; }
  [ -f "$SCRIPT_DIR/skills/changedown/SKILL.md" ] && echo "  [OK] SKILL.md" || { echo "  [MISSING] SKILL.md"; ok=false; }

  echo ""
  if $ok; then
    echo "=== Claude Code plugin structure verified ==="
  else
    echo "=== Some components missing. Run builds first. ==="
  fi
}

verify_codex() {
  echo "=== Verifying Codex plugin structure ==="
  local ok=true
  [ -f "$SCRIPT_DIR/.codex-plugin/plugin.json" ] && echo "  [OK] .codex-plugin/plugin.json" || { echo "  [MISSING] .codex-plugin/plugin.json"; ok=false; }
  [ -f "$SCRIPT_DIR/codex.mcp.json" ] && echo "  [OK] codex.mcp.json" || { echo "  [MISSING] codex.mcp.json"; ok=false; }
  [ -d "$SCRIPT_DIR/mcp-server/dist" ] && echo "  [OK] mcp-server built" || { echo "  [MISSING] mcp-server/dist"; ok=false; }
  [ -d "$SCRIPT_DIR/skills/changedown-codex" ] && echo "  [OK] Codex skill" || { echo "  [MISSING] skills/changedown-codex"; ok=false; }
  if grep -R '\${CLAUDE_PLUGIN_ROOT}' "$SCRIPT_DIR/.codex-plugin" "$SCRIPT_DIR/codex.mcp.json" >/dev/null 2>&1; then
    echo "  [FAIL] Codex plugin files contain Claude plugin placeholder"
    ok=false
  else
    echo "  [OK] no Claude plugin placeholder in Codex files"
  fi
  if $ok; then
    echo "=== Codex plugin structure verified ==="
  else
    echo "=== Codex plugin structure incomplete ==="
    return 1
  fi
}

# Parse arguments
case "${1:-}" in
  --cursor) setup_cursor ;;
  --claude) verify_claude ;;
  --codex)  verify_codex ;;
  --both)   setup_cursor; echo ""; verify_claude; echo ""; verify_codex ;;
  ""|*) usage; exit 1 ;;
esac
