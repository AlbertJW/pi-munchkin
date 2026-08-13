export function allocateCredits(requests, available) {
  if (!Number.isFinite(available) || available < 0) {
    throw new RangeError('available must be a non-negative finite number');
  }
  return requests.map(({ id, requested }) => ({
    id,
    granted: Math.min(Math.max(0, requested), available),
  }));
}
