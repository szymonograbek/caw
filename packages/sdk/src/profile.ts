import { Schema } from "effect";
import { HarnessName, ProfileName } from "./ids.ts";

/**
 * The named Harness settings a Conversation uses. A Session stays bound to
 * the profile it started with; changing a Conversation's profile makes its next
 * message start a new Session.
 */
export class Profile extends Schema.Class<Profile, { readonly brand: unique symbol }>("Profile")({
  name: ProfileName,
  harness: HarnessName,
  env: Schema.Record(Schema.String, Schema.String),
  model: Schema.Option(Schema.String),
  /** Overrides the Workspace directory as the Sessions' cwd. */
  cwd: Schema.Option(Schema.String),
  /** Claude `settingSources`; `None` means the Harness default (`user`, `project`, `local`). */
  settingSources: Schema.Option(Schema.Array(Schema.String)),
}) {}

export const defaultProfileName = ProfileName.make("default");
