export interface WeeklyWorkPeriod { isoWeekday: number; startsLocalTime: string; endsLocalTime: string; }
function seconds(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(value);
  return match ? Number(match[1])*3600+Number(match[2])*60+Number(match[3]) : null;
}
export function validateWeeklyWorkPeriods(periods: readonly WeeklyWorkPeriod[]): void {
  const groups = new Map<number, Array<{ starts: number; ends: number }>>();
  for (const period of periods) {
    const starts = seconds(period.startsLocalTime); const ends = seconds(period.endsLocalTime);
    if (!Number.isInteger(period.isoWeekday) || period.isoWeekday<1 || period.isoWeekday>7 || starts === null || ends === null || starts >= ends) throw new Error('invalid weekly work period');
    const current = groups.get(period.isoWeekday) ?? []; current.push({ starts, ends }); groups.set(period.isoWeekday,current);
  }
  for (const day of groups.values()) {
    day.sort((a,b)=>a.starts-b.starts);
    for (let index=1; index<day.length; index++) {
      const previous=day[index-1];const current=day[index];
      if(previous&&current&&current.starts<previous.ends)throw new Error('overlapping weekly work periods');
    }
  }
}
