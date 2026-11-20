import type { GuidePage } from "@gloaming/caw-plugin-sdk/plugin";
import { Option, Result } from "effect";
import type { LoadedPlugin } from "../plugins/loaded-plugin.ts";
import { coreGuide } from "./core-guide.ts";

/** Who contributed a group of pages: `core` or a Plugin's name. */
interface GuideSection {
  readonly owner: string;
  readonly pages: ReadonlyArray<GuidePage>;
}

/** Core's pages first, then each Plugin's, in the order given. */
const sectionsOf = (plugins: ReadonlyArray<LoadedPlugin>): ReadonlyArray<GuideSection> => [
  { owner: "core", pages: coreGuide },
  ...plugins.flatMap((plugin) =>
    plugin.guide.length === 0 ? [] : [{ owner: plugin.name, pages: plugin.guide }],
  ),
];

const listing = (sections: ReadonlyArray<GuideSection>): string => {
  const width = Math.max(
    ...sections.flatMap((section) => section.pages.map((page) => page.topic.length)),
  );

  return [
    "Run `caw guide <topic>` to read a topic.",
    ...sections.flatMap((section) => [
      "",
      section.owner,
      ...section.pages.map((page) => `  ${page.topic.padEnd(width)}  ${page.summary}`),
    ]),
  ].join("\n");
};

/**
 * `caw guide [topic]`: the topic list, or one page. Fails with a message when
 * no page has that topic. Needs no daemon: pages are data on each Plugin.
 */
export const renderGuide = (
  plugins: ReadonlyArray<LoadedPlugin>,
  topic: Option.Option<string>,
): Result.Result<string, string> => {
  const sections = sectionsOf(plugins);

  if (Option.isNone(topic)) {
    return Result.succeed(listing(sections));
  }

  const page = sections
    .flatMap((section) => section.pages)
    .find((candidate) => candidate.topic === topic.value);

  return page === undefined
    ? Result.fail(`No guide topic "${topic.value}". Run \`caw guide\` to list topics.`)
    : Result.succeed(`${page.topic}: ${page.summary}\n\n${page.body}`);
};
