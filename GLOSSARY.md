# Caw

A minimal daemon that lets people talk to agent harnesses through chat platforms, with behavior extended by plugins.

## Language

### Messaging

**Channel**:
An integration with a chat platform through which messages arrive and replies are sent (e.g. Discord).
_Avoid_: Adapter, connector, platform, transport

**Conversation**:
One addressable place inside a Channel where messages are exchanged: a Discord text channel, thread, or DM.
_Avoid_: Chat, room, Discord channel (when meaning the concept)

**Reply mode**:
How a Conversation maps messages to Sessions: `threaded` (each top-level message opens a new thread with its own Session) or `inline` (the Conversation is one Session; a thread a person opens forks a new Session).
_Avoid_: Session mode, thread policy

### Agents

**Harness**:
An agent runtime that Caw drives on the user's behalf (e.g. the Claude Agent SDK).
_Avoid_: Provider, backend, model, engine

**Session**:
One resumable Harness session bound to a Conversation.
_Avoid_: Thread (Discord meaning), run, chat

**Turn**:
One cycle of the Harness working on input until it stops and waits for more.
_Avoid_: Run, request, step

**Steer**:
A message delivered into a Turn already in progress, which the agent takes into account without the Turn restarting.
_Avoid_: Queue, interrupt, follow-up

**Fork**:
A new Session that starts from a copy of another Session's history; the original is unaffected.
_Avoid_: Branch, clone

**Harness profile**:
The named set of Harness settings (environment, flags, config directory) a Conversation uses; each Session is permanently tied to the profile it started with.
_Avoid_: Config, account, flags

**Workspace**:
The directory a Conversation's Sessions run in, holding its instructions and memory.
_Avoid_: Cwd, project, folder

### Extension

**Plugin**:
A unit of behavior installed into Caw that reacts to hooks, alters what flows between Channels and Harnesses, or exposes tools to the Harness.
_Avoid_: Extension, addon, module

**Event**:
A notification of something that happened in Caw, which Plugins can observe but not change.
_Avoid_: Hook, signal, notification

**Interceptor**:
A Plugin's handler at a named interception point that can change, block, or take over what is about to happen.
_Avoid_: Hook, middleware, filter

### Built-in plugins

**Memory**:
A short, durable fact the agent saved about a Conversation or globally; pinned Memories are always in context, the rest are looked up on demand.
_Avoid_: Note, fact, knowledge

**Schedule**:
A recurring or one-off prompt delivered to a Conversation at a set time.
_Avoid_: Cron, job, task, reminder

### Control

**Guide**:
Caw's built-in manual, read via `caw guide [topic]`, from which the agent learns how to control Caw.
_Avoid_: Docs, help, caw skill
