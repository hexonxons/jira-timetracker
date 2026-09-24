import { useCallback, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { buildTree, dailyTotals, idsToDepth, sumSeconds, type Dim, type Entry, type RowNode } from "../lib/aggregate";
import type { DayColumn } from "../lib/calendar";
import { formatValue, type Unit } from "../lib/format";
import { readPref, writePref } from "../lib/prefs";
import type { Dataset } from "../types";
import { DrillPanel, type DrillTarget } from "./DrillPanel";
import { IssueLink } from "./IssueLink";
import { UnitToggle } from "./UnitToggle";

const LABEL_WIDTH = { key: "jtt.labelWidth", default: 340, min: 160, max: 900 };
const clampWidth = (w: number) => Math.round(Math.min(LABEL_WIDTH.max, Math.max(LABEL_WIDTH.min, w)));

/** Width of the first (row label) column, shared by all calendar reports and remembered in the browser. */
function useLabelWidth() {
  const [width, setWidth] = useState(() =>
    readPref(LABEL_WIDTH.key, LABEL_WIDTH.default, (v): v is number => typeof v === "number" && isFinite(v)),
  );
  const drag = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (drag.current) setWidth(clampWidth(drag.current.width + e.clientX - drag.current.x));
  };
  const onPointerUp = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    const final = clampWidth(drag.current.width + e.clientX - drag.current.x);
    drag.current = null;
    setWidth(final);
    writePref(LABEL_WIDTH.key, final);
  };
  const reset = () => {
    setWidth(LABEL_WIDTH.default);
    writePref(LABEL_WIDTH.key, LABEL_WIDTH.default);
  };
  return { width, handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick: reset } };
}

const DIM_NAMES: Record<Dim, string> = { team: "Teams", employee: "Employees", track: "SD Tracks", issue: "Issues" };

export function CalendarReport({
  dataset,
  entries,
  days,
  dims,
  defaultDepth,
  hoursPerPersonDay,
  unit,
  onUnitChange,
}: {
  dataset: Dataset;
  entries: Entry[];
  days: DayColumn[];
  dims: Dim[];
  defaultDepth: number;
  hoursPerPersonDay: number;
  unit: Unit;
  onUnitChange: (u: Unit) => void;
}) {
  const fmt = (seconds: number) => formatValue(seconds, unit, hoursPerPersonDay);
  const labelWidth = useLabelWidth();
  const tree = useMemo(() => buildTree(dataset, entries, dims), [dataset, entries, dims]);
  const [expanded, setExpanded] = useState(() => idsToDepth(tree, defaultDepth));
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows: RowNode[] = [];
  const walk = (nodes: RowNode[]) => {
    for (const n of nodes) {
      rows.push(n);
      if (expanded.has(n.id)) walk(n.children);
    }
  };
  walk(tree);

  const totals = useMemo(() => dailyTotals(entries), [entries]);
  const grandTotal = sumSeconds(entries);

  const open = (node: RowNode | null, date?: string) => {
    const base = node ? node.entries : entries;
    const list = date ? base.filter((e) => e.date === date) : base;
    if (!list.length) return;
    setDrill({ path: node ? node.path : [], date, entries: list, allowByDay: !date });
  };

  return (
    <div className={`report ${drill ? "with-drill" : ""}`}>
      <div className="toolbar">
        <span className="muted">Expand to:</span>
        <div className="segmented small">
          {dims.map((d, i) => (
            <button key={d} onClick={() => setExpanded(idsToDepth(tree, i))}>
              {DIM_NAMES[d]}
            </button>
          ))}
        </div>
        <UnitToggle unit={unit} onChange={onUnitChange} hoursPerPersonDay={hoursPerPersonDay} />
      </div>
      <div className="calendar-wrap" style={{ "--label-width": `${labelWidth.width}px` } as CSSProperties}>
        <table className="calendar">
          <thead>
            <tr>
              <th className="sticky-col row-head">
                {dims.map((d) => DIM_NAMES[d]).join(" / ")}
                <span
                  className="col-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize, double-click to reset"
                  {...labelWidth.handle}
                />
              </th>
              {days.map((d) => (
                <th key={d.date} className={`day ${d.weekend ? "weekend" : ""}`}>
                  <div className="dow">{d.weekday}</div>
                  <div>{d.label}</div>
                </th>
              ))}
              <th className="total-col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const leaf = !n.children.length;
              return (
                <tr key={n.id} className={`depth-${n.depth} dim-${n.dim} ${n.total ? "" : "empty-row"}`}>
                  <th className="sticky-col row-label" scope="row">
                    <div className="label-inner" style={{ paddingLeft: n.depth * 18 }}>
                      {leaf ? (
                        <span className="caret-space" />
                      ) : (
                        <button className="caret" onClick={() => toggle(n.id)} aria-expanded={expanded.has(n.id)}>
                          {expanded.has(n.id) ? "▾" : "▸"}
                        </button>
                      )}
                      {n.issue ? (
                        <>
                          <IssueLink issue={n.issue} />
                          <span className="issue-summary" title={n.issue.summary}>
                            {n.issue.summary}
                          </span>
                        </>
                      ) : (
                        <span className="row-name" title={n.label}>
                          {n.label}
                        </span>
                      )}
                    </div>
                  </th>
                  {days.map((d) => {
                    const v = n.byDay.get(d.date) ?? 0;
                    return (
                      <td
                        key={d.date}
                        className={`cell ${d.weekend ? "weekend" : ""} ${v ? "has" : ""}`}
                        onClick={v ? () => open(n, d.date) : undefined}
                      >
                        {fmt(v)}
                      </td>
                    );
                  })}
                  <td className={`total-col cell ${n.total ? "has" : ""}`} onClick={n.total ? () => open(n) : undefined}>
                    {fmt(n.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky-col row-label">Total</th>
              {days.map((d) => {
                const v = totals.get(d.date) ?? 0;
                return (
                  <td
                    key={d.date}
                    className={`cell ${d.weekend ? "weekend" : ""} ${v ? "has" : ""}`}
                    onClick={v ? () => open(null, d.date) : undefined}
                  >
                    {fmt(v)}
                  </td>
                );
              })}
              <td className={`total-col cell ${grandTotal ? "has" : ""}`} onClick={grandTotal ? () => open(null) : undefined}>
                {fmt(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {drill && <DrillPanel target={drill} hoursPerPersonDay={hoursPerPersonDay} unit={unit} onClose={closeDrill} />}
    </div>
  );
}
