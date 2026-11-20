/** Discord's maximum length of a thread name. */
const THREAD_NAME_LIMIT = 100;

/** `name` on one line, cut to Discord's limit without splitting a character. */
export const threadName = (name: string): string => {
  let result = "";

  for (const character of name.replaceAll(/\s+/g, " ").trim()) {
    if (result.length + character.length > THREAD_NAME_LIMIT) {
      break;
    }

    result += character;
  }

  return result.length > 0 ? result : "Thread";
};
