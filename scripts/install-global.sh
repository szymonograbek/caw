#!/bin/sh
# Installs the compiled `caw` binary (from `bun run build`) onto PATH.
# Target: $CAW_INSTALL_DIR, else Bun's global bin ($BUN_INSTALL/bin, default ~/.bun/bin).
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
binary="$root/dist/caw"
target_dir="${CAW_INSTALL_DIR:-${BUN_INSTALL:-$HOME/.bun}/bin}"

[ -x "$binary" ] || { echo "No $binary. Run \`bun run build\` first." >&2; exit 1; }

mkdir -p "$target_dir"
# Copy to a temp name, then rename: replacing a running binary in place can crash it.
cp "$binary" "$target_dir/.caw.new"
mv -f "$target_dir/.caw.new" "$target_dir/caw"

echo "Installed $target_dir/caw ($("$target_dir/caw" --version))"

case ":$PATH:" in
  *":$target_dir:"*) ;;
  *) echo "Note: $target_dir is not on your PATH. Add it to use \`caw\` from any shell." ;;
esac
