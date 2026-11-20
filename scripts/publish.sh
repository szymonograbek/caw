#!/bin/sh
# Publishes the two public packages to npm:
#   @gloaming/caw            the `caw` CLI, bundled into one file (core and built-in plugins included)
#   @gloaming/caw-plugin-sdk the TypeScript sources plugins import
# Both take their version from their workspace package.json. npm asks for 2FA per package.
# Pass --dry-run to build and check the packages without publishing.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist/npm"
rm -rf "$out"
mkdir -p "$out/caw" "$out/caw-plugin-sdk"

bun run --cwd "$root" verify

# The CLI: one bundled script that runs on Bun. Its dependencies are bundled in.
bun build "$root/packages/cli/src/main.ts" --target=bun --minify --outfile "$out/caw/caw.js"
cp "$root/README.md" "$out/caw/README.md"
bun -e '
	const [source, target] = process.argv.slice(1);
	const cli = await Bun.file(source).json();
	await Bun.write(target, JSON.stringify({
		name: cli.name,
		version: cli.version,
		description: "Talk to Claude Code from Discord. A small daemon that runs on your own computer.",
		license: "UNLICENSED",
		type: "module",
		bin: { caw: "caw.js" },
		files: ["caw.js", "README.md"],
		engines: { bun: ">=1.4.4" },
	}, null, 2) + "\n");
' "$root/packages/cli/package.json" "$out/caw/package.json"

# The SDK: its sources as they are, without tests. Bun runs TypeScript directly.
cp -R "$root/packages/sdk/src" "$out/caw-plugin-sdk/src"
find "$out/caw-plugin-sdk/src" -name '*.test.ts' -delete
bun -e '
	const [source, target] = process.argv.slice(1);
	const { private: _, ...sdk } = await Bun.file(source).json();
	await Bun.write(target, JSON.stringify({
		...sdk,
		description: "The SDK for writing Caw plugins.",
		license: "UNLICENSED",
		files: ["src"],
		engines: { bun: ">=1.4.4" },
	}, null, 2) + "\n");
' "$root/packages/sdk/package.json" "$out/caw-plugin-sdk/package.json"

for package in caw-plugin-sdk caw; do
	(cd "$out/$package" && npm publish --access public "$@")
done
