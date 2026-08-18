export function scheduleJobs(jobs) {
  return [...jobs]
    .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0))
    .map((job) => job.id);
}
