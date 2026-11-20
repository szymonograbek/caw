#!/bin/sh
# Drives this checkout's Omen daemon for verification. Run from anywhere.
#   omen-verify.sh setup <token-file>   dev:setup + non-interactive install (Discord, Claude sonnet, all feature plugins)
#   omen-verify.sh launch               start the daemon in the background, wait until Discord is connected
#   omen-verify.sh doctor               read-only health check of this checkout's daemon
#   omen-verify.sh omen <args...>       run the omen CLI against this checkout's OMEN_HOME
#   omen-verify.sh threads              active threads under #smoke, newest last: "<id>\t<name>"
#   omen-verify.sh messages <channel-or-thread-id> [limit]   messages oldest first: "<id>\t<author>\t<reactions>\t<text>"
#   omen-verify.sh stop                 stop this checkout's daemon (never other processes)
set -eu

root=$(cd "$(dirname "$0")/../../../.." && pwd)
guild=$CAW_VERIFY_GUILD_ID
smoke=$CAW_VERIFY_CHANNEL_ID
api=https://discord.com/api/v10

[ -f "$root/.env.local" ] || sh "$root/scripts/dev-setup.sh" >/dev/null
OMEN_HOME=$(sed -n 's/^OMEN_HOME=//p' "$root/.env.local")
export OMEN_HOME

omen() { bun "$root/packages/cli/src/main.ts" "$@"; }

token() { sed -n 's/^DISCORD_TOKEN=//p' "$OMEN_HOME/.env"; }

rest() { curl -sf -H "Authorization: Bot $(token)" "$api$1"; }

case "${1:-}" in
  setup)
    [ -n "${2:-}" ] || { echo "usage: setup <token-file>" >&2; exit 2; }
    sh "$root/scripts/dev-setup.sh" >/dev/null
    omen install --yes --channel discord --discord-token-file "$2" \
      --harness claude --model sonnet --plugins memory,scheduler,profiles
    ;;
  launch)
    if omen status >/dev/null 2>&1; then echo "Already running:"; omen status; exit 0; fi
    mkdir -p "$OMEN_HOME"
    nohup sh -c "OMEN_HOME='$OMEN_HOME' exec bun '$root/packages/cli/src/main.ts' start" \
      > "$OMEN_HOME/start.out" 2>&1 &
    i=0
    until omen status 2>/dev/null | grep -Eq '^ +discord +running'; do
      i=$((i + 1))
      if [ "$i" -gt 30 ]; then echo "Not ready after 30s. Tail of start.out:" >&2; tail -20 "$OMEN_HOME/start.out" >&2; exit 1; fi
      sleep 1
    done
    omen status
    ;;
  doctor)
    echo "OMEN_HOME=$OMEN_HOME"
    [ -s "$OMEN_HOME/.env" ] && grep -q '^DISCORD_TOKEN=' "$OMEN_HOME/.env" && echo "token: present" || echo "token: MISSING (run setup)"
    omen status || exit 1
    omen profile list
    echo "bot: $(rest /users/@me | python3 -c 'import json,sys;print(json.load(sys.stdin)["username"])')"
    ;;
  omen)
    shift
    omen "$@"
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
    omen stop || true
    ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
