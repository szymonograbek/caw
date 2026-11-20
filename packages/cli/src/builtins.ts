import { fromDefinition } from "@gloaming/core/loaded-plugin";
import claude from "@gloaming/plugin-claude";
import discord from "@gloaming/plugin-discord";
import memory from "@gloaming/plugin-memory";
import profiles from "@gloaming/plugin-profiles";
import scheduler from "@gloaming/plugin-scheduler";

/** The Plugins that ship with Caw, in their default Plugin order. */
export const builtins = [
  fromDefinition(discord),
  fromDefinition(claude),
  fromDefinition(memory),
  fromDefinition(scheduler),
  fromDefinition(profiles),
];
