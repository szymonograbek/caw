# The `caw` CLI is the only control surface

Everything that controls Caw (plugins, settings, schedules, Conversations) is done through the `caw` CLI, both by the user in a terminal and by the agent via its shell. The agent learns the CLI from `caw guide`, a built-in, versioned manual, pointed to by one tiny core skill. We rejected exposing control as Harness tools or Discord slash commands: a single CLI keeps one implementation, and docs that ship with the binary can't drift out of date the way a separately maintained skill would.
