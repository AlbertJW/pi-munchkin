// Helpers for working with the event records in data/events.jsonl.
export function parseEventLine(line) {
  return JSON.parse(line);
}
