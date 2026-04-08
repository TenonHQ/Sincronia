import {
  GmailEmail,
  GmailThread,
  FormatDigestParams,
  FormatThreadParams,
  FormatEmailSummaryParams,
} from "./types";

/**
 * @description Formats email data as a morning brief digest, optimized for LLM consumption.
 * @param params - Object with email arrays (unread, starred, actionRequired, vip), date, and optional accountLabel.
 * @returns Markdown-formatted string.
 */
export function formatDigest(params: FormatDigestParams): string {
  var lines: string[] = [];
  var label = params.accountLabel || "Email";

  lines.push("## " + label + " Digest — " + formatDateHeader(params.date));
  lines.push("");

  var hasContent = false;

  // VIP emails — highest priority
  if (params.vip.length > 0) {
    hasContent = true;
    lines.push("### VIP Unread (" + params.vip.length + ")");
    lines.push("");
    for (var v = 0; v < params.vip.length; v++) {
      lines.push(formatEmailLine(params.vip[v]));
    }
    lines.push("");
  }

  // Action required
  if (params.actionRequired.length > 0) {
    hasContent = true;
    lines.push("### Action Required (" + params.actionRequired.length + ")");
    lines.push("");
    for (var a = 0; a < params.actionRequired.length; a++) {
      lines.push(formatEmailLine(params.actionRequired[a]));
    }
    lines.push("");
  }

  // Starred
  if (params.starred.length > 0) {
    hasContent = true;
    lines.push("### Starred (" + params.starred.length + ")");
    lines.push("");
    for (var s = 0; s < params.starred.length; s++) {
      lines.push(formatEmailLine(params.starred[s]));
    }
    lines.push("");
  }

  // Unread summary
  if (params.unread.length > 0) {
    hasContent = true;
    lines.push("### Unread (" + params.unread.length + ")");
    lines.push("");
    // Show top 10 unread
    var showCount = Math.min(params.unread.length, 10);
    for (var u = 0; u < showCount; u++) {
      lines.push(formatEmailLine(params.unread[u]));
    }
    if (params.unread.length > 10) {
      lines.push("- _... and " + (params.unread.length - 10) + " more_");
    }
    lines.push("");
  }

  if (!hasContent) {
    lines.push("_No flagged emails._");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * @description Formats a full email thread as readable markdown.
 * @param params - Object with the thread.
 * @returns Markdown-formatted string.
 */
export function formatThread(params: FormatThreadParams): string {
  var thread = params.thread;
  var lines: string[] = [];

  lines.push("## Thread: " + thread.subject);
  lines.push("");
  lines.push("**" + thread.messageCount + " messages** — Participants: " + thread.participants.join(", "));
  lines.push("");

  // Messages, most recent first
  var messages = thread.messages.slice().reverse();
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    lines.push("---");
    lines.push("");
    lines.push("**From:** " + msg.from);
    lines.push("**Date:** " + formatEmailDate(msg.date));
    if (msg.to) {
      lines.push("**To:** " + msg.to);
    }
    lines.push("");

    if (msg.body) {
      // Truncate very long bodies
      var body = msg.body;
      if (body.length > 2000) {
        body = body.substring(0, 2000) + "\n\n_[Truncated — " + (msg.body.length - 2000) + " more characters]_";
      }
      lines.push(body);
    } else {
      lines.push(msg.snippet || "_No body content._");
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * @description Formats a single email as a brief one-line summary.
 * @param params - Object with the email.
 * @returns A concise summary string.
 */
export function formatEmailSummary(params: FormatEmailSummaryParams): string {
  var email = params.email;
  var from = extractSenderName(email.from);
  var date = formatEmailDate(email.date);
  return "**" + from + "** — " + email.subject + " (" + date + ")";
}

// --- Helpers ---

function formatEmailLine(email: GmailEmail): string {
  var from = extractSenderName(email.from);
  var date = formatEmailDate(email.date);
  return "- **" + from + "** — " + email.subject + " (" + date + ")";
}

function extractSenderName(from: string): string {
  if (!from) {
    return "Unknown";
  }
  // "John Doe <john@example.com>" -> "John Doe"
  var angleIndex = from.indexOf("<");
  if (angleIndex > 0) {
    return from.substring(0, angleIndex).trim().replace(/"/g, "");
  }
  return from;
}

function formatEmailDate(dateStr: string): string {
  if (!dateStr) {
    return "Unknown";
  }
  try {
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    var months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    var hours = date.getHours();
    var ampm = hours >= 12 ? "PM" : "AM";
    var displayHours = hours % 12;
    if (displayHours === 0) {
      displayHours = 12;
    }
    var minutes = date.getMinutes();
    var minStr = minutes < 10 ? "0" + minutes : String(minutes);
    return (
      months[date.getMonth()] + " " + date.getDate() + ", " +
      displayHours + ":" + minStr + " " + ampm
    );
  } catch (e) {
    return dateStr;
  }
}

function formatDateHeader(date: Date): string {
  var months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return (
    months[date.getMonth()] + " " +
    date.getDate() + ", " +
    date.getFullYear()
  );
}
