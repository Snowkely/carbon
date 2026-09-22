export type RefreshTask = () => Promise<void>;

export function createSingleFlightRefresh(task: RefreshTask): RefreshTask {
  let active: Promise<void> | null = null;
  return () => {
    if (active) return active;
    active = Promise.resolve().then(task).finally(() => { active = null; });
    return active;
  };
}
