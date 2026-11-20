#!/bin/sh
# Drives this checkout's Caw daemon for verification. Run from anywhere.
#   caw-verify.sh setup <token-file>   dev:setup + non-interactive install (Discord, Claude sonnet, all feature plugins)
#   caw-verify.sh launch               start the daemon in the background, wait until Discord is connected
#   caw-verify.sh doctor               read-only health check of this checkout's daemon
#   caw-verify.sh caw <args...>       run the caw CLI against this checkout's CAW_HOME
#   caw-verify.sh threads              active threads under #smoke, newest last: "<id>\t<name>"
#   caw-verify.sh messages <channel-or-thread-id> [limit]   messages oldest first: "<id>\t<author>\t<reactions>\t<text>"
#   caw-verify.sh stop                 stop this checkout's daemon (never other processes)
set -eu

root=$(cd "$(dirname "$0")/../../../.." && pwd)
guild=$CAW_VERIFY_GUILD_ID
smoke=$CAW_VERIFY_CHANNEL_ID
api=https://discord.com/api/v10

[ -f "$root/.env.local" ] || sh "$root/scripts/dev-setup.sh" >/dev/null
CAW_HOME=$(sed -n 's/^CAW_HOME=//p' "$root/.env.local")
export CAW_HOME

caw() { bun "$root/packages/cli/src/main.ts" "$@"; }

token() { sed -n 's/^DISCORD_TOKEN=//p' "$CAW_HOME/.env"; }

rest() { curl -sf -H "Authorization: Bot $(token)" "$api$1"; }

case "${1:-}" in
  setup)
    [ -n "${2:-}" ] || { echo "usage: setup <token-file>" >&2; exit 2; }
    sh "$root/scripts/dev-setup.sh" >/dev/null
    caw install --yes --channel discord --discord-token-file "$2" \
      --harness claude --model sonnet --plugins memory,scheduler,profiles
    ;;
  launch)
    if caw status >/dev/null 2>&1; then echo "Already running:"; caw status; exit 0; fi
    mkdir -p "$CAW_HOME"
    nohup sh -c "CAW_HOME='$CAW_HOME' exec bun '$root/packages/cli/src/main.ts' start" \
      > "$CAW_HOME/start.out" 2>&1 &
    i=0
    until caw status 2>/dev/null | grep -Eq '^ +discord +running'; do
      i=$((i + 1))
      if [ "$i" -gt 30 ]; then echo "Not ready after 30s. Tail of start.out:" >&2; tail -20 "$CAW_HOME/start.out" >&2; exit 1; fi
      sleep 1
    done
    caw status
    ;;
  doctor)
    echo "CAW_HOME=$CAW_HOME"
    [ -s "$CAW_HOME/.env" ] && grep -q '^DISCORD_TOKEN=' "$CAW_HOME/.env" && echo "token: present" || echo "token: MISSING (run setup)"
    caw status || exit 1
    caw profile list
    echo "bot: $(rest /users/@me | python3 -c 'import json,sys;print(json.load(sys.stdin)["username"])')"
    ;;
  caw)
    shift
    caw "$@"
    ;;
  threads)
    rest "/guilds/$guild/threads/active" | python3 -c '
import json, sys
threads = [t for t in json.load(sys.stdin)["threads"] if t["parent_id"] == sys.argv[1]]
for t in sorted(threads, key=lambda t: int(t["id"])):
    print(t["id"] + "\t" + t["name"])' "$smoke"
    ;;
  messages)
    [ -n "${2:-}" ] || { echo "usage: messages <channel-or-thread-id> [limit]" >&2; exit 2; }
    rest "/channels/$2/messages?limit=${3:-20}" | python3 -c '
import json, sys
for m in reversed(json.load(sys.stdin)):
    reactions = "".join(r["emoji"]["name"] for r in m.get("reactions", []))
    print("\t".join([m["id"], m["author"]["username"], reactions, m["content"].replace("\n", " / ")]))'
    ;;
  stop)
    caw stop || true
    ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
