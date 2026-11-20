import type { GuidePage } from "@omen/sdk/plugin";

export const scheduleGuide: GuidePage = {
  topic: "schedule",
  summary: "Schedules: prompts delivered to a Conversation on a cron or at one time",
  body: `A Schedule delivers a prompt to a Conversation at set times. Each run arrives as a
<task> message and follows the Conversation's Reply mode: a new thread when
\`threaded\`, the main Session when \`inline\`. Write the prompt as an instruction to
your future self, with everything that run needs to know.

Commands:
  omen schedule add (--cron "<expr>" | --at <ISO datetime>) --prompt "<text>"
                    [--conversation <id>] [--timezone <IANA zone>]
      --cron takes 5 fields (minute hour day month weekday), or 6 with seconds
      first. --at takes e.g. 2026-11-21T09:00 (read in --timezone) or a time with an
      offset such as 2026-11-21T09:00+01:00. --timezone defaults to the host's zone;
      pass the zone from your <context timezone="..."/> so times mean what the
      person meant.
      The Conversation defaults to the top-level Conversation you are in: the
      main channel, even when you run this from a thread. Pass --conversation
      <id> to target a thread or another Conversation, only when the person
      wants runs there; OMEN_CONVERSATION_ID holds this thread's id.
  omen schedule list [--all | --conversation <id>]
      Schedules of this top-level Conversation and its threads (or every one, or
      exactly one Conversation's), soonest first, with ids.
  omen schedule remove <id>

Examples:
  omen schedule add --cron "0 9 * * 1-5" --timezone Europe/Warsaw \\
    --prompt "Post today's calendar and anything urgent in my inbox."
  omen schedule add --at 2026-11-21T17:30 --timezone Europe/Warsaw \\
    --prompt "Remind me to call the bank."

A one-off Schedule is removed after it runs. If Omen was down when runs were due,
it delivers at most one catch-up run per Schedule, and only when the latest missed
run was due within the last 24 hours.`,
};
