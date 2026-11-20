import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { coreLayer } from "./core-layer.ts";
import { DaemonConfig } from "./home/daemon-config.ts";
import { DaemonEnvironment } from "./home/daemon-environment.ts";
import { HostFiles } from "./home/host-files.ts";
import { OmenHome } from "./home/omen-home.ts";

const platform = Layer.mergeAll(OmenHome.layer, HostFiles.layer);

const environment = DaemonEnvironment.configProvider.pipe(
  Layer.provideMerge(DaemonEnvironment.layer),
);

/**
 * Core over this host: `OMEN_HOME`, `<home>/.env` overlaid by the process
 * environment, `OMEN_*` config and real HTTP. The daemon and the CLI's
 * daemon-less commands both run on it.
 */
export const hostCoreLayer = coreLayer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(DaemonConfig.layer, FetchHttpClient.layer).pipe(
      Layer.provideMerge(environment.pipe(Layer.provideMerge(platform))),
    ),
  ),
);
