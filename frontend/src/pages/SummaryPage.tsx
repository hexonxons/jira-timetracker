import { useCallback, useMemo, useState, type ReactNode } from "react";
import { compareTracks, groupBy, sumSeconds, tracksOf, type Entry } from "../lib/aggregate";
import { formatDuration, formatPercent, formatValue, type Unit } from "../lib/format";
import type { Dataset } from "../types";
import { DrillPanel, type DrillTarget } from "../components/DrillPanel";
import { UnitToggle } from "../components/UnitToggle";

export function SummaryPage({
  dataset,
  entries,
  hoursPerPersonDay: hpd,
  unit,
  onUnitChange,
}: {
  dataset: Dataset;
  entries: Entry[];
  hoursPerPersonDay: number;
  unit: Unit;
  onUnitChange: (u: Unit) => void;
}) {
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);

  const tracks = useMemo(() => tracksOf(entries), [entries]);
  const byTeam = useMemo(() => groupBy(entries, (e) => e.team), [entries]);
  const byTrack = useMemo(() => groupBy(entries, (e) => e.track), [entries]);
  const total = sumSeconds(entries);
  const fmt = (s: number) => formatValue(s, unit, hpd);

  /** A clickable number that opens the drill-down for exactly the entries it sums. */
  const num = (list: Entry[] | undefined, path: string[], strong = false, key?: string) => {
    const s = list ? sumSeconds(list) : 0;
    const Tag = strong ? "th" : "td";
    return (
      <Tag
        key={key}
        className={`num cell ${s ? "has" : ""}`}
        onClick={s ? () => setDrill({ path, entries: list!, allowByDay: true }) : undefined}
      >
        {fmt(s)}
      </Tag>
    );
  };

  const trackCells = (list: Entry[], path: string[]) => {
    const g = groupBy(list, (e) => e.track);
    return tracks.map((t) => num(g.get(t), [...path, t], false, t));
  };

  return (
    <div className={`report summary ${drill ? "with-drill" : ""}`}>
      <div className="toolbar">
        <UnitToggle unit={unit} onChange={onUnitChange} hoursPerPersonDay={hpd} />
      </div>

      <div className="summary-body">
        <Section title="Team × SD Track">
          <table className="matrix">
            <thead>
              <tr>
                <th className="sticky-col">Team</th>
                {tracks.map((t) => (
                  <th key={t}>{t}</th>
                ))}
                <th className="total-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {dataset.teams.map((t) => {
                const list = byTeam.get(t.name) ?? [];
                return (
                  <tr key={t.name}>
                    <th className="sticky-col">{t.name}</th>
                    {trackCells(list, [t.name])}
                    {num(list, [t.name], true)}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th className="sticky-col">TOTAL</th>
                {tracks.map((t) => num(byTrack.get(t), [t], true, t))}
                {num(entries, [], true)}
              </tr>
            </tfoot>
          </table>
        </Section>

        <Section title="SD Track totals">
          <table className="matrix">
            <thead>
              <tr>
                <th className="sticky-col">SD Track</th>
                <th>Total hours</th>
                <th>Person-days</th>
                <th>Share</th>
                <th className="left">Teams</th>
                <th className="left">Employees</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => {
                const list = byTrack.get(t) ?? [];
                const s = sumSeconds(list);
                return (
                  <tr key={t}>
                    <th className="sticky-col">{t}</th>
                    <FixedNum list={list} path={[t]} text={formatDuration(s)} onOpen={setDrill} />
                    <FixedNum list={list} path={[t]} text={formatValue(s, "personDays", hpd)} onOpen={setDrill} />
                    <td className="num">{formatPercent(s, total)}</td>
                    <td>
                      <Distribution list={list} keyOf={(e) => e.team} fmt={fmt} path={[t]} onOpen={setDrill} />
                    </td>
                    <td>
                      <Distribution
                        list={list}
                        keyOf={(e) => e.member.displayName}
                        fmt={fmt}
                        path={[t]}
                        onOpen={setDrill}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      </div>
      {drill && <DrillPanel target={drill} hoursPerPersonDay={hpd} unit={unit} onClose={closeDrill} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="summary-section">
      <h2>{title}</h2>
      <div className="matrix-wrap">{children}</div>
    </section>
  );
}

function FixedNum({
  list,
  path,
  text,
  onOpen,
}: {
  list: Entry[];
  path: string[];
  text: string;
  onOpen: (t: DrillTarget) => void;
}) {
  return (
    <td
      className={`num cell ${list.length ? "has" : ""}`}
      onClick={list.length ? () => onOpen({ path, entries: list, allowByDay: true }) : undefined}
    >
      {text}
    </td>
  );
}

/** Compact "name value (share)" chips, largest first; each opens its drill-down. */
function Distribution({
  list,
  keyOf,
  fmt,
  path,
  onOpen,
}: {
  list: Entry[];
  keyOf: (e: Entry) => string;
  fmt: (s: number) => string;
  path: string[];
  onOpen: (t: DrillTarget) => void;
}) {
  const total = sumSeconds(list);
  const parts = [...groupBy(list, keyOf).entries()]
    .map(([k, l]) => ({ k, l, s: sumSeconds(l) }))
    .sort((a, b) => b.s - a.s || compareTracks(a.k, b.k));
  return (
    <div className="dist">
      {parts.map(({ k, l, s }) => (
        <button key={k} className="dist-item" onClick={() => onOpen({ path: [...path, k], entries: l, allowByDay: true })}>
          <span>{k}</span> <span className="num">{fmt(s)}</span> <span className="muted">{formatPercent(s, total)}</span>
        </button>
      ))}
    </div>
  );
}

