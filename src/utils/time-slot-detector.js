import { isWorkday } from 'chinese-workday';

/**
 * Get time slot type based on hour of day and workday status
 *
 * Time slot definitions (workdays only):
 * - High load: hours 10-11, 13-17 (上午10-11点, 下午1-5点)
 * - Medium load: hours 8-9, 12, 18-20 (早上8-9点, 中午12点, 晚上6-8点)
 * - Low load: hours 21-23, 0-7 (晚上9点到次日7点)
 *
 * Non-workday (weekends, holidays): always returns 'low'
 *
 * Boundary logic (left-closed right-open):
 * - Hour 7 → low
 * - Hour 8 → medium (enters medium load period)
 * - Hour 10 → high (enters high load period)
 * - Hour 12 → medium (noon)
 * - Hour 13 → high (afternoon high load starts)
 * - Hour 18 → medium (evening medium load starts)
 * - Hour 21 → low (night low load starts)
 *
 * @param {number | Date} input - Hour of day (0-23) or a Date object
 * @returns {'high' | 'medium' | 'low'} Time slot type
 */
export function getTimeSlotType(input) {
  const date = typeof input === 'number'
    ? new Date(new Date().setHours(input, 0, 0, 0))
    : new Date(input);

  if (!isWorkday(date)) {
    return 'low';
  }

  const hour = date.getHours();
  if (hour >= 21 || hour <= 7) {
    return 'low';
  }

  if ((hour >= 10 && hour <= 11) || (hour >= 13 && hour <= 17)) {
    return 'high';
  }

  return 'medium';
}
