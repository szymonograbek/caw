import { fromDefinition } from "@omen/core/loaded-plugin";
import claude from "@omen/plugin-claude";
import discord from "@omen/plugin-discord";
import memory from "@omen/plugin-memory";
import profiles from "@omen/plugin-profiles";
import scheduler from "@omen/plugin-scheduler";

/** The Plugins that ship with Omen, in their default Plugin order. */
export const builtins = [
  fromDefinition(discord),
  fromDefinition(claude),
  fromDefinition(memory),
  fromDefinition(scheduler),
  fromDefinition(profiles),
];
