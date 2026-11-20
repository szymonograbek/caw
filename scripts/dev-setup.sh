#!/bin/sh
# Writes this checkout's gitignored .env.local so each worktree keeps its own Omen state.
# Idempotent: rerunning replaces the managed keys and keeps any others.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
env_file="$root/.env.local"
omen_home="$root/.omen-dev"

mkdir -p "$omen_home"
touch "$env_file"

kept=$(grep -v '^OMEN_HOME=' "$env_file" || true)
{
  if [ -n "$kept" ]; then
    printf '%s\n' "$kept"
  fi
  printf 'OMEN_HOME=%s\n' "$omen_home"
} > "$env_file"

printf 'OMEN_HOME=%s\n' "$omen_home"
