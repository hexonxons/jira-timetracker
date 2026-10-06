import { useCallback, useMemo, useState } from "react";
import { DrillPanel, type DrillTarget } from "../components/DrillPanel";
import { UnitToggle } from "../components/UnitToggle";
import { compareMembers, groupBy, sumSeconds, type Entry } from "../lib/aggregate";
import { dayColumn, periodDays, todayIso, weekOf } from "../lib/calendar";
import { amountUnit, formatValue, type Unit } from "../lib/format";
import { normDays } from "../lib/highlight";
import type { VacationDays } from "../lib/vacations";
import type { Dataset } from "../types";

interface Week {
  key: string;
  label: string;
  dates: Set<string>;
}

/** Calendar weeks (Mon–Sun) of the period, clipped to it. */
function weeksOf(start: string, end: string): Week[] {
  const weeks = new Map<string, string[]>();
  for (const d of periodDays(start, end)) {
    const w = weekOf(d);
    weeks.set(w, [...(weeks.get(w) ?? []), d]);
  }
  return [...weeks.entries()].map(([key, dates]) => {
    const first = dayColumn(dates[0]);
    const last = dayColumn(dates[dates.length - 1]);
    const sameMonth = first.label.split(" ")[0] === last.label.split(" ")[0];
    return {
      key,
      label: dates.length === 1 ? first.label : `${first.label}–${sameMonth ? last.label.split(" ")[1] : last.label}`,
      dates: new Set(dates),
    };
  });
}

export function MonthlyPage({
  dataset,
  entries,
  hoursPerPersonDay: hpd,
  unit,
  onUnitChange,
  vacations,
}: {
  dataset: Dataset;
  entries: Entry[];
  hoursPerPersonDay: number;
  unit: Unit;
  onUnitChange: (u: Unit) => void;
  vacations: VacationDays;
}) {
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);
  const { start, end } = dataset.meta;
  const today = todayIso();
  const weeks = useMemo(() => weeksOf(start, end), [start, end]);
  const byMember = useMemo(() => groupBy(entries, (e) => e.member.username), [entries]);
  const byTeam = useMemo(() => groupBy(entries, (e) => e.team), [entries]);
  const amount = (s: number) => formatValue(s, amountUnit(unit), hpd);

  const cell = (list: Entry[], path: string[], whole: number, cls = "", title?: string, key?: string) => {
    const s = sumSeconds(list);
    return (
      <td
        key={key}
        className={`num cell ${s ? "has" : ""} ${cls}`}
        title={title}
        onClick={s ? () => setDrill({ path, entries: list, allowByDay: true }) : undefined}
      >
        {formatValue(s, unit, hpd, whole)}
      </td>
    );
  };
  const weekCells = (list: Entry[], path: string[], teamList: Entry[]) =>
    weeks.map((w) => {
      const inWeek = list.filter((e) => w.dates.has(e.date));
      const teamWeek = sumSeconds(teamList.filter((e) => w.dates.has(e.date)));
      return cell(inWeek, [...path, `week of ${w.label}`], teamWeek, w.key === weeks[0].key ? "" : "week-start", undefined, w.key);
    });

  return (
    <div className={`report monthly ${drill ? "with-drill" : ""}`}>
      <div className="toolbar">
        <UnitToggle unit={unit} onChange={onUnitChange} hoursPerPersonDay={hpd} />
        <span className="legend">
          <span className="swatch short" /> logged less than the norm
        </span>
      </div>
      <p className="muted small-note">
        Norm = {hpd}h × working days (Mon–Fri) of the period before today, minus vacation days. Holidays are not
        handled. Vacations come from Settings.
      </p>
      <div className="matrix-wrap">
        <table className="matrix monthly-table">
          <thead>
            <tr>
              <th className="sticky-col">Team / Employee</th>
              {weeks.map((w, i) => (
                <th key={w.key} className={i ? "week-start" : ""}>
                  {w.label}
                </th>
              ))}
              <th className="week-start">Vacation days</th>
              <th>Norm</th>
              <th className="total-col">Logged</th>
            </tr>
          </thead>
          <tbody>
            {dataset.teams.map((t) => {
              const teamList = byTeam.get(t.name) ?? [];
              const teamTotal = sumSeconds(teamList);
              const members = [...t.members].sort(compareMembers).map((m) => {
                const list = byMember.get(m.username) ?? [];
                const days = normDays(start, end, today, m.username, vacations);
                return { m, list, days, norm: days.working * hpd * 3600, logged: sumSeconds(list) };
              });
              const teamNorm = members.reduce((s, x) => s + x.norm, 0);
              return [
                <tr key={t.name} className="group-row">
                  <th className="sticky-col">{t.name}</th>
                  {weekCells(teamList, [t.name], teamList)}
                  <td className="num week-start">{members.reduce((s, x) => s + x.days.vacation, 0) || ""}</td>
                  <td className="num">{amount(teamNorm)}</td>
                  {cell(teamList, [t.name], teamTotal, "total-col")}
                </tr>,
                ...members.map(({ m, list, days, norm, logged }) => {
                  const short = norm > 0 && logged < norm;
                  return (
                    <tr key={m.username} className={list.length ? "" : "empty-row"}>
                      <th className="sticky-col member">{m.displayName}</th>
                      {weekCells(list, [t.name, m.displayName], teamList)}
                      <td className={`num week-start ${days.vacation ? "vacation" : ""}`}>{days.vacation || ""}</td>
                      <td className="num" title={`${days.working} working day(s) × ${hpd}h`}>
                        {amount(norm)}
                      </td>
                      {cell(
                        list,
                        [t.name, m.displayName],
                        teamTotal,
                        `total-col ${short ? "short" : ""}`,
                        short ? `${amount(norm - logged)} below the norm` : undefined,
                      )}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      {drill && <DrillPanel target={drill} hoursPerPersonDay={hpd} unit={unit} onClose={closeDrill} />}
    </div>
  );
}
