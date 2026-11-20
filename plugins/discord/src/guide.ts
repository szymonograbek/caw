import type { GuidePage } from "@gloaming/sdk/plugin";

export const discordGuide: GuidePage = {
  topic: "discord",
  summary: "Replying on Discord: reply modes, reactions, and the /new and /stop commands",
  body: `Caw talks to Discord through the discord Channel. Write Discord markdown; long replies are split into 2000-character messages for you, and code blocks stay balanced across the split.

Reply modes (set per Conversation with \`caw conversation set\`):
- threaded (default in server channels): each top-level message opens a thread, and that thread has its own Session.
- inline (always in DMs): the Conversation is one Session and replies go in the main chat. A thread someone opens off a message forks the Session.

Reactions: the \`react\` tool takes a \`messageId\` (the \`id\` on a <message> tag) and an \`emoji\`. Only the emoji in the plugin's \`allowedReactions\` setting are accepted (default 👀 ✅ 👍 ❤️ 😂 🤔 🎉 ⚠️). A Turn may end with a reaction instead of a reply. In a thread, a message from the parent channel (such as the one that opened the thread) can be reacted to as well.

Slash commands people can use:
- /new starts a fresh Session in the Conversation.
- /stop interrupts the current Turn.`,
};
