import * as NodePath from "node:path";
import { Match, Option } from "effect";

/** What the service runs: `<cli> start` with Omen's environment. */
export interface ServiceTarget {
  readonly userHome: string;
  readonly omenHome: string;
  /** The command that starts the CLI (see `Invocation.cli`). */
  readonly cli: ReadonlyArray<string>;
  /** Baked in, so the agent's shell finds the same tools as the installing shell. */
  readonly path: string;
  readonly userId: Option.Option<number>;
}

/** A service definition for this platform, and the commands that manage it. */
export interface ServiceFile {
  readonly path: string;
  readonly contents: string;
  /** Load the written file and start Omen. */
  readonly load: ReadonlyArray<ReadonlyArray<string>>;
  /** Stop Omen and unload the service; they fail when it is not loaded. */
  readonly unload: ReadonlyArray<ReadonlyArray<string>>;
  /**
   * Exits 0 while the service manager still holds the service. Unloading
   * finishes after `unload` returns (launchd refuses a new bootstrap until then).
   */
  readonly loaded: ReadonlyArray<string>;
  /** Where the service's output goes, e.g. to point at when Omen does not start. */
  readonly logs: string;
}

const label = "omen";

const xml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const string = (value: string) => `<string>${xml(value)}</string>`;

const launchdPlist = (target: ServiceTarget): ServiceFile => {
  const path = NodePath.join(target.userHome, "Library", "LaunchAgents", `${label}.plist`);
  const log = NodePath.join(target.omenHome, "logs", "service.log");
  const domain = `gui/${Option.getOrElse(target.userId, () => 0)}`;

  return {
    path,
    contents: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${string(label)}
  <key>ProgramArguments</key>
  <array>
    ${[...target.cli, "start"].map(string).join("\n    ")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OMEN_HOME</key>
    ${string(target.omenHome)}
    <key>PATH</key>
    ${string(target.path)}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  ${string(log)}
  <key>StandardErrorPath</key>
  ${string(log)}
</dict>
</plist>
`,
    load: [["launchctl", "bootstrap", domain, path]],
    unload: [["launchctl", "bootout", `${domain}/${label}`]],
    loaded: ["launchctl", "print", `${domain}/${label}`],
    logs: log,
  };
};

const quoted = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const systemdUnit = (target: ServiceTarget): ServiceFile => {
  const path = NodePath.join(target.userHome, ".config", "systemd", "user", `${label}.service`);

  return {
    path,
    contents: `[Unit]
Description=Omen
After=network-online.target

[Service]
ExecStart=${[...target.cli, "start"].map(quoted).join(" ")}
Environment=${quoted(`OMEN_HOME=${target.omenHome}`)} ${quoted(`PATH=${target.path}`)}
Restart=on-failure

[Install]
WantedBy=default.target
`,
    load: [
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", `${label}.service`],
    ],
    unload: [["systemctl", "--user", "stop", `${label}.service`]],
    loaded: ["systemctl", "--user", "is-active", "--quiet", `${label}.service`],
    logs: `journalctl --user -u ${label}`,
  };
};

/** `None` on a platform Omen has no service manager support for. */
export const serviceFile = (platform: string, target: ServiceTarget): Option.Option<ServiceFile> =>
  Match.value(platform).pipe(
    Match.when("darwin", () => Option.some(launchdPlist(target))),
    Match.when("linux", () => Option.some(systemdUnit(target))),
    Match.orElse(() => Option.none()),
  );
