type CronTask = {
  start: () => void;
  stop: () => void;
  destroy: () => void;
  getStatus: () => 'scheduled' | 'stopped' | 'destroyed';
};

type ScheduleOptions = {
  timezone?: string;
  scheduled?: boolean;
};

function validate(expression: string): boolean {
  if (typeof expression !== 'string' || expression.trim() === '') {
    return false;
  }

  // Basic cron shape check (5 or 6 fields). Enough for tests.
  const fields = expression.trim().split(/\s+/);
  return fields.length === 5 || fields.length === 6;
}

function schedule(
  _expression: string,
  _task: () => void | Promise<void>,
  options?: ScheduleOptions
): CronTask {
  let status: ReturnType<CronTask['getStatus']> =
    options?.scheduled === false ? 'stopped' : 'scheduled';

  return {
    start() {
      status = 'scheduled';
    },
    stop() {
      status = 'stopped';
    },
    destroy() {
      status = 'destroyed';
    },
    getStatus() {
      return status;
    },
  };
}

export default {
  schedule,
  validate,
};
