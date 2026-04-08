import {
  CalendarEvent,
  FormatDailyAgendaParams,
  FormatEventParams,
} from "./types";

/**
 * @description Formats calendar events as a markdown daily agenda, optimized for LLM consumption.
 * @param params - Object with events array and date.
 * @returns Markdown-formatted string.
 */
export function formatDailyAgenda(params: FormatDailyAgendaParams): string {
  var events = params.events;
  var date = params.date;
  var lines: string[] = [];

  lines.push("## Calendar — " + formatDateHeader(date));
  lines.push("");

  if (events.length === 0) {
    lines.push("_No events scheduled._");
    lines.push("");
    return lines.join("\n");
  }

  // Separate all-day events from timed events
  var allDay: CalendarEvent[] = [];
  var timed: CalendarEvent[] = [];

  for (var i = 0; i < events.length; i++) {
    if (events[i].isAllDay) {
      allDay.push(events[i]);
    } else {
      timed.push(events[i]);
    }
  }

  // All-day events
  if (allDay.length > 0) {
    lines.push("**All-day:**");
    for (var a = 0; a < allDay.length; a++) {
      var adEvent = allDay[a];
      var adLine = "- " + adEvent.summary;
      if (adEvent.location) {
        adLine = adLine + " (" + adEvent.location + ")";
      }
      lines.push(adLine);
    }
    lines.push("");
  }

  // Timed events as table
  if (timed.length > 0) {
    lines.push("| Time | Event | Location |");
    lines.push("|---|---|---|");

    for (var t = 0; t < timed.length; t++) {
      var event = timed[t];
      var timeStr = formatTimeRange(event);
      var location = event.location ? escapeCell(event.location) : "-";
      lines.push(
        "| " + timeStr +
        " | " + escapeCell(event.summary) +
        " | " + location + " |"
      );
    }
    lines.push("");
  }

  // Summary line
  var nextEvent = findNextEvent(timed);
  if (nextEvent) {
    lines.push(
      "> " + events.length + " events today. Next: **" +
      nextEvent.summary + "** at " + formatTime(nextEvent.start.dateTime || "") + "."
    );
  } else {
    lines.push("> " + events.length + " events today.");
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * @description Formats a single calendar event as a detailed markdown view.
 * @param params - Object with the event.
 * @returns Markdown-formatted string.
 */
export function formatEvent(params: FormatEventParams): string {
  var event = params.event;
  var lines: string[] = [];

  lines.push("## Event: " + event.summary);
  lines.push("");

  if (event.isAllDay) {
    var startDate = event.start.date || "Unknown";
    var endDate = event.end.date || startDate;
    lines.push("- **When:** " + startDate + " (all day)");
    if (endDate !== startDate) {
      lines.push("- **Until:** " + endDate);
    }
  } else {
    lines.push("- **When:** " + formatTimeRange(event));
  }

  if (event.location) {
    lines.push("- **Location:** " + event.location);
  }

  lines.push("- **Status:** " + capitalize(event.status));

  if (event.organizer && event.organizer.email) {
    var orgLabel = event.organizer.displayName || event.organizer.email;
    lines.push("- **Organizer:** " + orgLabel);
  }

  if (event.attendees.length > 0) {
    lines.push("- **Attendees:**");
    for (var i = 0; i < event.attendees.length; i++) {
      var attendee = event.attendees[i];
      var name = attendee.displayName || attendee.email;
      var status = attendee.responseStatus;
      var statusIcon = status === "accepted" ? "+" : status === "declined" ? "x" : "?";
      lines.push("  - [" + statusIcon + "] " + name);
    }
  }

  if (event.htmlLink) {
    lines.push("- **Link:** " + event.htmlLink);
  }

  if (event.description && event.description.trim() !== "") {
    lines.push("");
    lines.push("### Description");
    lines.push("");
    lines.push(event.description);
  }

  return lines.join("\n");
}

// --- Helpers ---

function formatDateHeader(date: Date): string {
  var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return (
    days[date.getDay()] + ", " +
    months[date.getMonth()] + " " +
    date.getDate() + ", " +
    date.getFullYear()
  );
}

function formatTimeRange(event: CalendarEvent): string {
  var startStr = formatTime(event.start.dateTime || "");
  var endStr = formatTime(event.end.dateTime || "");
  if (startStr && endStr) {
    return startStr + " - " + endStr;
  }
  if (startStr) {
    return startStr;
  }
  return "All day";
}

function formatTime(dateTimeStr: string): string {
  if (!dateTimeStr) {
    return "";
  }
  try {
    var date = new Date(dateTimeStr);
    if (isNaN(date.getTime())) {
      return dateTimeStr;
    }
    var hours = date.getHours();
    var ampm = hours >= 12 ? "PM" : "AM";
    var displayHours = hours % 12;
    if (displayHours === 0) {
      displayHours = 12;
    }
    var minutes = date.getMinutes();
    var minStr = minutes < 10 ? "0" + minutes : String(minutes);
    return displayHours + ":" + minStr + " " + ampm;
  } catch (e) {
    return dateTimeStr;
  }
}

function findNextEvent(events: CalendarEvent[]): CalendarEvent | null {
  var now = new Date();
  for (var i = 0; i < events.length; i++) {
    var startStr = events[i].start.dateTime;
    if (startStr) {
      var start = new Date(startStr);
      if (start.getTime() > now.getTime()) {
        return events[i];
      }
    }
  }
  return null;
}

function escapeCell(str: string): string {
  if (!str) {
    return "";
  }
  return str.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function capitalize(str: string): string {
  if (!str || str.length === 0) {
    return str;
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}
