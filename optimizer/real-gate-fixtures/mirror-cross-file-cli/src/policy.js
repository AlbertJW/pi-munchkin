export const STATUS_ORDER = ['queued', 'running', 'done'];

export function canTransition(from, to) {
  return STATUS_ORDER.indexOf(to) === STATUS_ORDER.indexOf(from) + 1;
}
