/**
 * Get time slot type based on hour of day
 *
 * Time slot definitions:
 * - High load: hours 10-11, 13-17 (上午10-11点, 下午1-5点)
 * - Medium load: hours 8-9, 12, 18-20 (早上8-9点, 中午12点, 晚上6-8点)
 * - Low load: hours 21-23, 0-7 (晚上9点到次日7点)
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
 * @param {number} hour - Hour of day (0-23)
 * @returns {'high' | 'medium' | 'low'} Time slot type
 */
export function getTimeSlotType(hour) {
  if (hour >= 21 || hour <= 7) {
    return 'low';
  }

  if ((hour >= 10 && hour <= 11) || (hour >= 13 && hour <= 17)) {
    return 'high';
  }

  return 'medium';
}
