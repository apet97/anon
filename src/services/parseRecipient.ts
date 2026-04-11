/**
 * Parses a Pumble slash-command argument of the shape
 *   `<<@USER_ID>> some message text`
 * into its component parts.
 *
 * Returns `null` if the prefix does not match, and returns the message
 * trimmed of surrounding whitespace. The message is allowed to be an
 * empty string — callers enforce their own "message is required"
 * validation so the error message can be specific to the command.
 */
export interface ParsedRecipient {
  userId: string;
  message: string;
}

const MENTION_PATTERN = /^<<@([^>]+)>>\s*([\s\S]*)/;

export function parseRecipient(text: string): ParsedRecipient | null {
  const match = text.match(MENTION_PATTERN);
  if (!match) return null;
  const userId = match[1] as string;
  const message = (match[2] as string).trim();
  return { userId, message };
}
