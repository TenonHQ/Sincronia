import { ParsedGmailIdentifier } from "./types";

/**
 * @description Parses a Gmail message or thread ID from a URL or raw ID.
 * @param input - A Gmail URL or raw message/thread ID.
 * @returns Parsed identifier with extracted messageId or threadId.
 *
 * @example
 * parseGmailIdentifier("18f1234abcd5678")
 * // => { messageId: "18f1234abcd5678", raw: "18f1234abcd5678" }
 *
 * @example
 * parseGmailIdentifier("https://mail.google.com/mail/u/0/#inbox/18f1234abcd5678")
 * // => { threadId: "18f1234abcd5678", raw: "https://mail.google.com/..." }
 */
export function parseGmailIdentifier(input: string): ParsedGmailIdentifier {
  if (!input || input.trim() === "") {
    throw new Error(
      "Gmail identifier is empty. Provide a message ID, thread ID, or Gmail URL."
    );
  }

  var cleaned = input.trim();

  // Handle Gmail URLs — validate hostname to prevent spoofed URLs
  if (cleaned.indexOf("http") === 0) {
    try {
      var parsedUrl = new URL(cleaned);
      if (parsedUrl.hostname === "mail.google.com" || parsedUrl.hostname.endsWith(".mail.google.com")) {
        return parseGmailUrl(cleaned, input);
      }
    } catch (e) {
      // Not a valid URL — fall through to raw ID parsing
    }
  }

  // Raw ID — Gmail message/thread IDs are hex strings (16+ chars)
  if (/^[a-fA-F0-9]+$/.test(cleaned)) {
    return { messageId: cleaned, raw: input };
  }

  // Could be a non-hex ID format
  if (/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
    return { messageId: cleaned, raw: input };
  }

  throw new Error(
    "Could not parse Gmail identifier: '" + input +
    "'. Expected a message ID, thread ID, or Gmail URL."
  );
}

function parseGmailUrl(url: string, raw: string): ParsedGmailIdentifier {
  // Gmail URLs look like:
  // https://mail.google.com/mail/u/0/#inbox/18f1234abcd5678
  // https://mail.google.com/mail/u/0/#all/18f1234abcd5678
  // https://mail.google.com/mail/u/0/#label/MyLabel/18f1234abcd5678

  // Extract the fragment (after #)
  var hashIndex = url.indexOf("#");
  if (hashIndex === -1) {
    throw new Error(
      "Could not extract ID from Gmail URL: '" + url +
      "'. Expected a URL with a # fragment containing the thread ID."
    );
  }

  var fragment = url.substring(hashIndex + 1);
  var segments = fragment.split("/").filter(function (s) {
    return s !== "";
  });

  // The thread ID is the last segment
  if (segments.length > 0) {
    var lastSegment = segments[segments.length - 1];
    if (/^[a-fA-F0-9]+$/.test(lastSegment)) {
      return { threadId: lastSegment, raw: raw };
    }
  }

  throw new Error(
    "Could not extract thread ID from Gmail URL: '" + url +
    "'. Expected a URL ending with a hex thread ID."
  );
}
