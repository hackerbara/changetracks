#!/bin/sh
# ChangeDown Viewer — Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/hackerbara/changedown/main/scripts/install-viewer.sh | sh
#    or: VERSION=0.1.0 sh install-viewer.sh
#    or: sh install-viewer.sh            (installs latest)
set -e

REPO="hackerbara/changedown"
INSTALL_DIR="${CHANGEDOWN_INSTALL:-$HOME/.local/share/changedown}"
BIN_DIR="${CHANGEDOWN_BIN:-$HOME/.local/bin}"

# --- Platform detection ---
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin) ;;
  *) echo "Error: ChangeDown viewer is macOS-only (got $OS). Cross-platform support coming via Tauri."; exit 1 ;;
esac

case "$ARCH" in
  arm64)  ARCH_LABEL="arm64" ;;
  x86_64) ARCH_LABEL="x86_64" ;;
  *) echo "Error: Unsupported architecture: $ARCH"; exit 1 ;;
esac

# --- Resolve version ---
if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"v\?\([^"]*\)".*/\1/')
  if [ -z "$VERSION" ]; then
    echo "Error: Could not determine latest version. Set VERSION=x.y.z explicitly."
    exit 1
  fi
fi

ZIP_NAME="ChangeDown-${ARCH_LABEL}.zip"
ZIP_URL="https://github.com/$REPO/releases/download/v${VERSION}/${ZIP_NAME}"
SHA_URL="${ZIP_URL}.sha256"

echo ""
echo "  ChangeDown Viewer v${VERSION} (${ARCH_LABEL})"
echo "  ─────────────────────────────────"
echo ""

# --- Download ---
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

printf "  Downloading...   "
curl --fail --location --progress-bar --output "$TMP_DIR/$ZIP_NAME" "$ZIP_URL"
echo ""

# --- Verify SHA-256 (if available) ---
printf "  Verifying...     "
if curl -fsSL --output "$TMP_DIR/$ZIP_NAME.sha256" "$SHA_URL" 2>/dev/null; then
  EXPECTED=$(awk '{print $1}' "$TMP_DIR/$ZIP_NAME.sha256")
  ACTUAL=$(shasum -a 256 "$TMP_DIR/$ZIP_NAME" | awk '{print $1}')
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "FAIL"
    echo "  SHA-256 mismatch!"
    echo "    Expected: $EXPECTED"
    echo "    Got:      $ACTUAL"
    exit 1
  fi
  echo "ok (SHA-256)"
else
  echo "skipped (no checksum file)"
fi

# --- Extract ---
printf "  Extracting...    "
unzip -qo "$TMP_DIR/$ZIP_NAME" -d "$TMP_DIR"
echo "ok"

# --- Install ---
printf "  Installing...    "
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/ChangeDown.app"
mv "$TMP_DIR/ChangeDown.app" "$INSTALL_DIR/ChangeDown.app"
echo "ok"

# --- CLI launcher ---
printf "  CLI launcher...  "
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/changedown" << 'LAUNCHER'
#!/bin/sh
APP_DIR="${CHANGEDOWN_INSTALL:-$HOME/.local/share/changedown}"
APP="$APP_DIR/ChangeDown.app"
BIN="$APP/Contents/MacOS/ChangeDown"

if [ ! -x "$BIN" ]; then
  echo "Error: ChangeDown not found at $APP"
  echo "Run the installer: curl -fsSL https://raw.githubusercontent.com/hackerbara/changedown/main/scripts/install-viewer.sh | sh"
  exit 1
fi

exec "$BIN" "$@"
LAUNCHER
chmod +x "$BIN_DIR/changedown"
echo "ok"

# --- PATH check ---
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo ""
    echo "  Add to your shell profile:"
    echo "    export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo ""
echo "  Installed to: $INSTALL_DIR/ChangeDown.app"
echo "  CLI command:  changedown [file.md]"
echo ""
echo "  To open the app:    changedown"
echo "  To open a file:     changedown ~/docs/readme.md"
echo "  To open a folder:   changedown ~/docs/"
echo "  If downloaded via browser and blocked by Gatekeeper:"
echo "    xattr -cr ~/.local/share/changedown/ChangeDown.app"
echo ""
