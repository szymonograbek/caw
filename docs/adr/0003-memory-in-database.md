# Memories are database records, not markdown files

Memories are stored as bounded rows in Caw's sqlite database (capped count and size per scope, pinned ones injected at Session open) rather than as markdown files in the Workspace. This keeps all of Caw's state in one portable place, makes the caps enforceable, and stops memory growing stale and unbounded; `caw memory export` gives a human-readable copy when needed.
