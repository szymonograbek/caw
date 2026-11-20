import * as Fs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import type { ChannelMessage, ConversationPlace } from "@gloaming/caw-plugin-sdk/channel";
import { ConversationPlace as Place } from "@gloaming/caw-plugin-sdk/channel";
import {
  ChannelMessageId,
  ChannelName,
  ExternalConversationId,
  PluginName,
} from "@gloaming/caw-plugin-sdk/ids";
import { definePlugin, Caw } from "@gloaming/caw-plugin-sdk/plugin";
import { Profile } from "@gloaming/caw-plugin-sdk/profile";
import { DateTime, Duration, Effect, Layer, Option, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { coreLayer } from "../core-layer.ts";
import { DaemonConfig } from "../home/daemon-config.ts";
import { DaemonEnvironment } from "../home/daemon-environment.ts";
import { HostFiles } from "../home/host-files.ts";
import { CawHome } from "../home/caw-home.ts";
import { fromDefinition } from "../plugins/loaded-plugin.ts";
import { PluginHost } from "../plugins/plugin-host.ts";
import type { FakeChannel } from "./fake-channel.ts";
import type { FakeHarness } from "./fake-harness.ts";

/** A fresh `CAW_HOME` under the OS temp directory, removed with the scope. */
export const temporaryHome = Effect.acquireRelease(
  Effect.promise(() => Fs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "caw-core-"))),
  (path) => Effect.promise(() => Fs.rm(path, { recursive: true, force: true })),
);

export const testConfig = {
  idleTimeout: Duration.minutes(10),
  maxLiveSessions: 5,
  timezone: "Europe/Warsaw",
  historyLimit: 50,
};

/** Attachment downloads answer with the URL's text. */
const fakeHttp = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response(`bytes of ${request.url}`))),
);

/** Core over a home directory, with fixed config and no network. */
export const testCoreLayer = (home: string, config: typeof testConfig = testConfig) =>
  coreLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(CawHome, CawHome.at(home)),
        HostFiles.layer,
        Layer.succeed(DaemonConfig, config),
        Layer.succeed(DaemonEnvironment, { vars: { FROM_ENV: "1" } }),
        Layer.succeed(HttpClient.HttpClient, fakeHttp),
      ),
    ),
  );

/** A built-in Plugin that registers the fake Channel and Harness, and serves every profile name. */
const fakePlugin = (channel: FakeChannel, harness: FakeHarness) =>
  fromDefinition(
    definePlugin({
      name: PluginName.make("fake"),
      settings: Schema.Struct({}),
      migrations: [],
      guide: [],
      skillDir: Option.none(),
      layer: () =>
        Layer.effectDiscard(
          Effect.gen(function* () {
            const caw = yield* Caw;

            yield* caw.registerHarness(harness.harness);
            yield* caw.registerProfiles((name) =>
              Effect.succeedSome(
                new Profile({
                  name,
                  harness: harness.harness.name,
                  env: { PROFILE: name },
                  model: Option.none(),
                  cwd: Option.none(),
                  settingSources: Option.none(),
                  effort: Option.none(),
                }),
              ),
            );
            yield* caw.registerChannel(channel.channel);
          }),
        ),
    }),
  );

export const startPlugins = (channel: FakeChannel, harness: FakeHarness) =>
  PluginHost.use((host) => host.start([fakePlugin(channel, harness)]));

/** Waits, on the real clock, until `check` holds (2 s at most). */
export const eventually = <E, R>(check: Effect.Effect<boolean, E, R>) =>
  Effect.flatMap(check, (holds) =>
    holds
      ? Effect.void
      : TestClock.withLive(Effect.sleep("5 millis")).pipe(
          Effect.andThen(Effect.fail("condition never held")),
        ),
  ).pipe(Effect.retry({ times: 400 }), Effect.orDie);

const room = Place.Room();

export const thread = (parent: string): ConversationPlace =>
  Place.Thread({ parent: ExternalConversationId.make(parent) });

export const message = (
  conversation: string,
  id: string,
  text: string,
  place: ConversationPlace = room,
): ChannelMessage => ({
  channel: ChannelName.make("fake"),
  conversation: ExternalConversationId.make(conversation),
  place,
  messageId: ChannelMessageId.make(id),
  author: { id: "u1", name: "Ada" },
  text,
  sentAt: DateTime.makeUnsafe("2026-11-20T08:12:00Z"),
  replyTo: Option.none(),
  attachments: [],
});
