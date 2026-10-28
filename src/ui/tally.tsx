import type { ReactElement } from "react";

/**
 * The month as tally marks: one stroke a day, every fifth struck across the four before it. Days gone
 * are faint, today is marked, and the days you still have to spread the budget over stay bright.
 */
export function TallyMarks({ days, today }: { days: number; today: number }) {
  const stroke = 7, group = 12, h = 22;
  const groups = Math.ceil(days / 5);
  const width = groups * (4 * stroke + group) - group + 4;
  const state = (day: number) => (day < today ? "gone" : day === today ? "today" : "left");
  const marks: ReactElement[] = [];
  for (let g = 0; g < groups; g++) {
    const x0 = 2 + g * (4 * stroke + group);
    for (let i = 0; i < 4; i++) {
      const day = g * 5 + i + 1;
      if (day > days) break;
      const x = x0 + i * stroke + stroke / 2;
      marks.push(<line key={day} x1={x} x2={x - 0.6} y1={3} y2={h - 3} className={`tally-${state(day)}`} />);
    }
    const fifth = g * 5 + 5;
    if (fifth <= days) {
      marks.push(<line key={fifth} x1={x0 - 1} x2={x0 + 4 * stroke + 1} y1={h - 5} y2={5} className={`tally-${state(fifth)}`} />);
    }
  }
  const left = days - today + 1;
  return (
    <svg className="tally" viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="xMinYMid meet" role="img"
      aria-label={`${left} day${left === 1 ? "" : "s"} left in the month, including today`}>
      {marks}
    </svg>
  );
}
