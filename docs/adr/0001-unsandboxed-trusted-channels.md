# Run unsandboxed with no access control

Caw runs the Harness directly on the host with permissions bypassed, and replies to every message in the Conversations it is in. There is no sandbox, allowlist, or approval flow. The trust boundary is membership of the chat platform's channels: only trusted people are ever present there. We chose this over NanoClaw's container-per-session model because Caw is a personal agent meant to act on the user's real machine, and isolation would defeat that.

## Consequences

Anyone who can post in a Conversation Caw is in can run arbitrary commands as the host user. Access control or approvals, if ever needed, belong in a Plugin, not in core.
