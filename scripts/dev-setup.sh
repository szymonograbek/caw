#!/bin/sh
# Writes this checkout's gitignored .env.local so each worktree keeps its own Caw state.
# Idempotent: rerunning replaces the managed keys and keeps any others.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
env_file="$root/.env.local"
caw_home="$root/.caw-dev"

mkdir -p "$caw_home"
touch "$env_file"

kept=$(grep -v '^CAW_HOME=' "$env_file" || true)
{
  if [ -n "$kept" ]; then
    printf '%s\n' "$kept"
  fi
  printf 'CAW_HOME=%s\n' "$caw_home"
} > "$env_file"

printf 'CAW_HOME=%s\n' "$caw_home"
