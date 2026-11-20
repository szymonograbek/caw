import { fromDefinition } from "@caw/core/loaded-plugin";
import claude from "@caw/plugin-claude";
import discord from "@caw/plugin-discord";
import memory from "@caw/plugin-memory";
import profiles from "@caw/plugin-profiles";
import scheduler from "@caw/plugin-scheduler";

/** The Plugins that ship with Caw, in their default Plugin order. */
export const builtins = [
  fromDefinition(discord),
  fromDefinition(claude),
  fromDefinition(memory),
  fromDefinition(scheduler),
  fromDefinition(profiles),
];
