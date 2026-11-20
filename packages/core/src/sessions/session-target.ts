import type { Channel } from "@gloaming/caw-plugin-sdk/channel";
import type { Conversation, Session } from "@gloaming/caw-plugin-sdk/conversation";
import type { SessionStart } from "@gloaming/caw-plugin-sdk/harness";
import type { Profile } from "@gloaming/caw-plugin-sdk/profile";

/** Everything a Session needs to run, decided by routing. */
export interface SessionTarget {
  readonly channel: Channel;
  /** Where replies go. */
  readonly conversation: Conversation;
  /** The top-level Conversation: owns the Workspace and profile. */
  readonly root: Conversation;
  readonly session: Session;
  readonly profile: Profile;
  /** How the Harness opens it when the Session is not live yet. */
  readonly start: SessionStart;
}
