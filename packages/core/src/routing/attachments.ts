import * as NodePath from "node:path";
import type { ChannelMessage } from "@gloaming/caw-plugin-sdk/channel";
import { Context, Effect, Layer, Option } from "effect";
import { HttpClient } from "effect/http";
import { HostFiles } from "../home/host-files.ts";
import { CawHome } from "../home/caw-home.ts";
import type { AttachmentRef } from "./inbound-format.ts";
import { referencesOf } from "./inbound-format.ts";

/** Saves a message's attachments into its Workspace's `inbox/` so the agent reads them by path. */
export class Attachments extends Context.Service<
  Attachments,
  {
    /** A failed download is referenced by name only; the message still goes through. */
    readonly save: (
      workspace: string,
      message: ChannelMessage,
    ) => Effect.Effect<ReadonlyArray<AttachmentRef>>;
  }
>()("@caw/core/Attachments") {
  static readonly layer = Layer.effect(
    Attachments,
    Effect.gen(function* () {
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      const files = yield* HostFiles;
      const home = yield* CawHome;

      return {
        save: Effect.fn("Attachments.save")(function* (workspace: string, message: ChannelMessage) {
          const directory = home.inbox(workspace, message.messageId);
          const references = referencesOf(message);

          return yield* Effect.forEach(message.attachments, (attachment, index) => {
            const path = NodePath.join(directory, NodePath.basename(attachment.name));
            const reference = references[index];
            const kind = reference?.kind ?? "file";

            return Effect.gen(function* () {
              const response = yield* http.get(attachment.url);
              const bytes = yield* response.arrayBuffer;

              yield* files.ensureDirectory(directory);
              yield* files.writeBytes(path, new Uint8Array(bytes));

              const saved: AttachmentRef = {
                name: attachment.name,
                kind,
                savedTo: Option.some(path),
              };

              return saved;
            }).pipe(
              Effect.catch((error) =>
                Effect.logWarning("Attachment download failed", error).pipe(
                  Effect.as({ name: attachment.name, kind, savedTo: Option.none<string>() }),
                ),
              ),
            );
          });
        }),
      };
    }),
  );
}
