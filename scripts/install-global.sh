#!/bin/sh
# Installs the compiled `omen` binary (from `bun run build`) onto PATH.
# Target: $OMEN_INSTALL_DIR, else Bun's global bin ($BUN_INSTALL/bin, default ~/.bun/bin).
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
binary="$root/dist/omen"
target_dir="${OMEN_INSTALL_DIR:-${BUN_INSTALL:-$HOME/.bun}/bin}"

[ -x "$binary" ] || { echo "No $binary. Run \`bun run build\` first." >&2; exit 1; }

mkdir -p "$target_dir"
# Copy to a temp name, then rename: replacing a running binary in place can crash it.
cp "$binary" "$target_dir/.omen.new"
mv -f "$target_dir/.omen.new" "$target_dir/omen"

echo "Installed $target_dir/omen ($("$target_dir/omen" --version))"

case ":$PATH:" in
  *":$target_dir:"*) ;;
  *) echo "Note: $target_dir is not on your PATH. Add it to use \`omen\` from any shell." ;;
esac
