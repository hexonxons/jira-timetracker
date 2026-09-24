import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type PublicSettings, type ReportJob } from "./api";
import { CalendarReport } from "./components/CalendarReport";
import { ErrorList } from "./components/ErrorList";
import { enrich, type Dim } from "./lib/aggregate";
import { visibleDays } from "./lib/calendar";
import type { Unit } from "./lib/format";
import { readPref, writePref } from "./lib/prefs";
import { loadOwnTeams, saveOwnTeams } from "./lib/teamsStore";
import { SettingsPage } from "./pages/SettingsPage";
import { SummaryPage } from "./pages/SummaryPage";
import type { Dataset } from "./types";

interface CalendarView {
  kind: "calendar";
  title: string;
  hint: string;
  dims: Dim[];
  defaultDepth: number;
}

const PAGES: Record<string, CalendarView | { kind: "summary" | "settings"; title: string; hint: string }> = {
  "people-issues": {
    kind: "calendar",
    title: "People / Issues",
    hint: "Who logged time, on which days, on which issues.",
    dims: ["team", "employee", "issue"],
    defaultDepth: 2,
  },
  "people-tracks": {
    kind: "calendar",
    title: "People / Tracks",
    hint: "Which SD Tracks each employee spent time on.",
    dims: ["team", "employee", "track", "issue"],
    defaultDepth: 2,
  },
  "teams-tracks": {
    kind: "calendar",
    title: "Teams / Tracks",
    hint: "Which SD Tracks each team spent time on. Team is taken from the config.",
    dims: ["team", "track", "employee", "issue"],
    defaultDepth: 1,
  },
  summary: { kind: "summary", title: "Summary", hint: "Totals for the whole period." },
  settings: { kind: "settings", title: "Settings", hint: "" },
};

function currentPage(): string {
  const id = window.location.hash.replace(/^#\/?/, "");
  return id in PAGES ? id : "people-issues";
}

function monthBounds(): { start: string; end: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}

export function App() {
  const [page, setPage] = useState(currentPage);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [period, setPeriod] = useState(monthBounds);
  const [job, setJob] = useState<ReportJob | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [ownTeams, setOwnTeams] = useState<unknown | null>(loadOwnTeams);
  const [unit, setUnit] = useState<Unit>(() =>
    readPref("jtt.unit", "hours", (v): v is Unit => v === "hours" || v === "personDays"),
  );
  const updateUnit = (u: Unit) => {
    setUnit(u);
    writePref("jtt.unit", u);
  };
  const updateOwnTeams = (config: unknown | null) => {
    setOwnTeams(config);
    saveOwnTeams(config);
  };
  const poll = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onHash = () => setPage(currentPage());
    window.addEventListener("hashchange", onHash);
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setErrors(e instanceof ApiError ? e.errors : [String(e)]));
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.clearTimeout(poll.current);
    };
  }, []);

  async function generate() {
    setErrors([]);
    window.clearTimeout(poll.current);
    try {
      const { id } = await api.startReport(period.start, period.end, ownTeams);
      const tick = async () => {
        try {
          const j = await api.getReport(id);
          setJob(j);
          if (j.status === "running") poll.current = window.setTimeout(tick, 500);
          else if (j.status === "done") setDataset(j.dataset);
          else setErrors(j.errors);
        } catch (e) {
          setJob(null);
          setErrors(e instanceof ApiError ? e.errors : [String(e)]);
        }
      };
      setJob({ id, status: "running", progress: null, errors: [], dataset: null });
      tick();
    } catch (e) {
      setErrors(e instanceof ApiError ? e.errors : [String(e)]);
    }
  }

  const entries = useMemo(() => (dataset ? enrich(dataset) : []), [dataset]);
  const days = useMemo(
    () => (dataset ? visibleDays(dataset.meta.start, dataset.meta.end, new Set(entries.map((e) => e.date))) : []),
    [dataset, entries],
  );
  const hpd = settings?.hoursPerPersonDay ?? dataset?.meta.hoursPerPersonDay ?? 8;
  const running = job?.status === "running";
  const view = PAGES[page];
  const hasTeams = Boolean(ownTeams || settings?.teamsConfig);
  const needsSetup = settings && (!hasTeams || settings.configErrors.length > 0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Jira Time Reports</div>
        <nav>
          {Object.entries(PAGES).map(([id, p]) => (
            <a key={id} href={`#/${id}`} className={id === page ? "active" : ""}>
              {p.title}
            </a>
          ))}
        </nav>
      </header>

      {view.kind !== "settings" && (
        <div className="period-bar">
          <label>
            From
            <input
              type="date"
              value={period.start}
              onChange={(e) => setPeriod({ ...period, start: e.target.value })}
            />
          </label>
          <label>
            To
            <input type="date" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
          </label>
          <button className="primary" onClick={generate} disabled={running || !period.start || !period.end}>
            {running ? "Loading…" : "Generate"}
          </button>
          {running && job?.progress && (
            <span className="muted">
              {job.progress.stage}
              {job.progress.total ? `: ${job.progress.done}/${job.progress.total}` : ""}
            </span>
          )}
          {!running && dataset && (
            <span className="muted">
              Showing {dataset.meta.start} – {dataset.meta.end} · {dataset.worklogs.length} worklogs · loaded{" "}
              {new Date(dataset.meta.generatedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      <main>
        {view.kind !== "settings" && (
          <>
            <ErrorList errors={errors} title="The report could not be built:" />
            {needsSetup &&
              (settings.configErrors.length ? (
                <ErrorList
                  errors={settings.configErrors}
                  title="This instance is misconfigured; ask its administrator to fix:"
                />
              ) : (
                <div className="alert">
                  Upload a team config in <a href="#/settings">Settings</a> first.
                </div>
              ))}
          </>
        )}

        {view.kind === "settings" && settings && (
          <SettingsPage settings={settings} ownTeams={ownTeams} onOwnTeams={updateOwnTeams} />
        )}

        {view.kind !== "settings" && dataset && (
          <>
            <div className="page-head">
              <h1>{view.title}</h1>
              <span className="muted">{view.hint}</span>
            </div>
            <Caveats dataset={dataset} />
            {view.kind === "calendar" ? (
              <CalendarReport
                key={`${page}-${dataset.meta.generatedAt}`}
                dataset={dataset}
                entries={entries}
                days={days}
                dims={view.dims}
                defaultDepth={view.defaultDepth}
                hoursPerPersonDay={hpd}
                unit={unit}
                onUnitChange={updateUnit}
              />
            ) : (
              <SummaryPage
                key={dataset.meta.generatedAt}
                dataset={dataset}
                entries={entries}
                hoursPerPersonDay={hpd}
                unit={unit}
                onUnitChange={updateUnit}
              />
            )}
          </>
        )}

        {view.kind !== "settings" && !dataset && !running && !needsSetup && !errors.length && (
          <div className="empty-state">Choose a period and press Generate.</div>
        )}
      </main>
    </div>
  );
}

function Caveats({ dataset }: { dataset: Dataset }) {
  return (
    <details className="caveats">
      <summary>How the numbers are built{dataset.meta.warnings.length ? ` · ${dataset.meta.warnings.length} warning(s)` : ""}</summary>
      <ul>
        <li>
          SD Track is the <strong>current</strong> value of the issue. If an issue moved to another track, all its
          earlier worklogs are counted under the new track.
        </li>
        <li>Team comes only from the team config; Jira Components are ignored.</li>
        <li>Only issues and worklogs visible to the Personal Access Token owner are included.</li>
        <li>A worklog's day is the date of its start time, as Jira reports it for the token owner's time zone.</li>
        <li>Weekends are hidden unless someone logged time on them (then shown shaded). Holidays are not handled.</li>
        {dataset.meta.warnings.map((w, i) => (
          <li key={i} className="warn">
            {w}
          </li>
        ))}
      </ul>
    </details>
  );
}
