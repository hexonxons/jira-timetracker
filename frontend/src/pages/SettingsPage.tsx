import { useState, type ChangeEvent, type FormEvent } from "react";
import { api, ApiError, type ConnectionInfo, type PublicSettings } from "../api";
import { ErrorList } from "../components/ErrorList";
import { dayColumn, periodDays } from "../lib/calendar";
import { downloadText } from "../lib/download";
import type { DayRange } from "../lib/highlight";
import {
  addTeam,
  addUser,
  EditError,
  normalizeTeams,
  removeTeam,
  removeUser,
  teamsJson,
  type TeamsConfig,
} from "../lib/teamsEdit";
import { parseVacations, sortVacations, vacationsJson, type Vacation } from "../lib/vacations";

export function SettingsPage({
  settings,
  ownTeams,
  onOwnTeams,
  vacations,
  onVacations,
  range,
  onRange,
}: {
  settings: PublicSettings;
  /** The team config kept in this browser (overrides the instance default). */
  ownTeams: unknown | null;
  onOwnTeams: (config: unknown | null) => void;
  vacations: Vacation[];
  onVacations: (v: Vacation[]) => void;
  /** null = default (at least one person-day, no upper limit). */
  range: DayRange | null;
  onRange: (r: DayRange | null) => void;
}) {
  const teams = normalizeTeams(ownTeams ?? settings.teamsConfig);
  return (
    <div className="page settings">
      <ConnectionCard settings={settings} />
      <TeamsCard settings={settings} ownTeams={ownTeams} onOwnTeams={onOwnTeams} />
      <VacationsCard vacations={vacations} onVacations={onVacations} teams={teams} />
      <HighlightCard range={range} onRange={onRange} hoursPerPersonDay={settings.hoursPerPersonDay} />
    </div>
  );
}

async function readJsonFile(e: ChangeEvent<HTMLInputElement>): Promise<{ name: string; data: unknown } | null> {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return null;
  try {
    return { name: file.name, data: JSON.parse(await file.text()) };
  } catch (err) {
    throw new EditError(`${file.name} is not valid JSON: ${(err as Error).message}`);
  }
}

function errorText(err: unknown): string[] {
  if (err instanceof ApiError) return err.errors;
  return [err instanceof Error ? err.message : String(err)];
}

function useAction() {
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setErrors([]);
    try {
      await action();
    } catch (e) {
      setErrors(e instanceof ApiError ? e.errors : [String(e)]);
    } finally {
      setBusy(false);
    }
  }
  return { errors, busy, run };
}

function TestConnection({ disabled }: { disabled?: boolean }) {
  const { errors, busy, run } = useAction();
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const test = () =>
    run(async () => {
      setConnection(null);
      setConnection(await api.testConnection());
    });
  return (
    <>
      <button type="button" onClick={test} disabled={busy || disabled}>
        Test connection
      </button>
      {connection && (
        <div className="alert alert-ok">
          Connected as <strong>{connection.user}</strong>
          {connection.timeZone ? ` (time zone ${connection.timeZone})` : ""}. SD Track field:{" "}
          <code>{connection.sdTrackField.id}</code>.
        </div>
      )}
      <ErrorList errors={errors} />
    </>
  );
}

function ConnectionCard({ settings }: { settings: PublicSettings }) {
  return (
    <section className="card">
      <h2>Jira connection</h2>
      <p className="muted">This instance is configured by its administrator and uses a shared access token.</p>
      <dl className="facts">
        <dt>Jira</dt>
        <dd>
          {settings.jiraUrl ? (
            <a href={settings.jiraUrl} target="_blank" rel="noreferrer">
              {settings.jiraUrl}
            </a>
          ) : (
            "—"
          )}
        </dd>
        <dt>Access token</dt>
        <dd>{settings.hasPat ? "configured" : "missing"}</dd>
        <dt>SD Track field</dt>
        <dd>{settings.sdTrackFieldName}</dd>
        <dt>Person-day</dt>
        <dd>{settings.hoursPerPersonDay}h</dd>
      </dl>
      <ErrorList errors={settings.configErrors} title="Instance configuration problems:" />
      <div className="actions">
        <TestConnection disabled={settings.configErrors.length > 0} />
      </div>
    </section>
  );
}

function TeamsCard({
  settings,
  ownTeams,
  onOwnTeams,
}: {
  settings: PublicSettings;
  ownTeams: unknown | null;
  onOwnTeams: (config: unknown | null) => void;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [newUser, setNewUser] = useState<Record<string, string>>({});
  const [newTeam, setNewTeam] = useState("");
  const usingOwn = ownTeams !== null;
  const config = normalizeTeams(usingOwn ? ownTeams : settings.teamsConfig);
  const hasConfig = usingOwn || settings.teamsConfig !== null;

  /** Every edit becomes this browser's own config (the instance default is read-only). */
  function edit(change: (c: TeamsConfig) => TeamsConfig, done: string) {
    setErrors([]);
    try {
      onOwnTeams(change(config));
      setMessage(usingOwn ? done : `${done} Saved as your own config in this browser.`);
      return true;
    } catch (err) {
      setMessage("");
      setErrors(errorText(err));
      return false;
    }
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    setErrors([]);
    setMessage("");
    try {
      const file = await readJsonFile(e);
      if (!file) return;
      await api.validateTeams(file.data);
      onOwnTeams(file.data);
      setMessage(`Loaded ${file.name}.`);
    } catch (err) {
      setErrors(errorText(err));
    }
  }

  const addMember = (team: string) => (e: FormEvent) => {
    e.preventDefault();
    const user = newUser[team] ?? "";
    if (edit((c) => addUser(c, team, user), `Added ${user.trim()} to ${team}.`)) setNewUser({ ...newUser, [team]: "" });
  };

  const createTeam = (e: FormEvent) => {
    e.preventDefault();
    if (edit((c) => addTeam(c, newTeam), `Added team ${newTeam.trim()}.`)) setNewTeam("");
  };

  return (
    <section className="card">
      <h2>Team config</h2>
      <p className="muted">
        Each user must belong to exactly one team; people not listed are excluded from reports. Changes apply to the
        next report you generate.
      </p>
      <p className="muted">
        {usingOwn
          ? "Using your own config. It is kept in this browser only and sent with each report request."
          : settings.teamsConfig
            ? "Using the instance default config. Editing or uploading creates your own copy in this browser."
            : "This instance has no default config: upload or create yours. It is kept in this browser only."}
      </p>
      <div className="actions">
        <label className="button primary">
          Upload JSON…
          <input type="file" accept=".json,application/json" onChange={upload} hidden />
        </label>
        <button disabled={!hasConfig} onClick={() => downloadText("teams.json", teamsJson(config))}>
          Download JSON
        </button>
        {usingOwn && (
          <button
            onClick={() => {
              onOwnTeams(null);
              setMessage("");
              setErrors([]);
            }}
          >
            {settings.teamsConfig ? "Use instance default" : "Forget my config"}
          </button>
        )}
        {message && <span className="ok">{message}</span>}
      </div>
      <ErrorList errors={errors} />
      <div className="team-editor">
        {config.teams.map((t) => (
          <div key={t.name} className="team-block">
            <div className="team-head">
              <strong>{t.name}</strong>
              <span className="muted">{t.users.length} people</span>
              <button
                className="link-btn"
                onClick={() =>
                  (!t.users.length || window.confirm(`Remove team "${t.name}" with ${t.users.length} people?`)) &&
                  edit((c) => removeTeam(c, t.name), `Removed team ${t.name}.`)
                }
              >
                Remove team
              </button>
            </div>
            <div className="chips">
              {t.users.map((u) => (
                <span key={u} className="user-chip">
                  {u}
                  <button
                    aria-label={`Remove ${u} from ${t.name}`}
                    title="Remove from team"
                    onClick={() => edit((c) => removeUser(c, t.name, u), `Removed ${u} from ${t.name}.`)}
                  >
                    ×
                  </button>
                </span>
              ))}
              <form className="inline-form" onSubmit={addMember(t.name)}>
                <input
                  placeholder="jira.username"
                  value={newUser[t.name] ?? ""}
                  onChange={(e) => setNewUser({ ...newUser, [t.name]: e.target.value })}
                />
                <button type="submit">Add</button>
              </form>
            </div>
          </div>
        ))}
        <form className="inline-form" onSubmit={createTeam}>
          <input placeholder="New team name" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} />
          <button type="submit">Add team</button>
        </form>
      </div>
    </section>
  );
}

function workingDays(v: Vacation): number {
  return periodDays(v.from, v.to).filter((d) => !dayColumn(d).weekend).length;
}

function VacationsCard({
  vacations,
  onVacations,
  teams,
}: {
  vacations: Vacation[];
  onVacations: (v: Vacation[]) => void;
  teams: TeamsConfig;
}) {
  const users = teams.teams.flatMap((t) => t.users).sort((a, b) => a.localeCompare(b));
  const [form, setForm] = useState({ user: "", from: "", to: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  const add = (e: FormEvent) => {
    e.preventDefault();
    setMessage("");
    const problems = [];
    if (!form.user) problems.push("Choose an employee.");
    if (!form.from || !form.to) problems.push("Set both dates.");
    else if (form.to < form.from) problems.push("The end date is before the start date.");
    setErrors(problems);
    if (problems.length) return;
    onVacations(sortVacations([...vacations, { user: form.user, from: form.from, to: form.to }]));
    setForm({ ...form, from: "", to: "" });
    setMessage(`Added a vacation for ${form.user}.`);
  };

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    setErrors([]);
    setMessage("");
    try {
      const file = await readJsonFile(e);
      if (!file) return;
      const parsed = parseVacations(file.data);
      if (parsed.errors.length) {
        setErrors(parsed.errors);
        return;
      }
      onVacations(parsed.vacations);
      setMessage(`Loaded ${parsed.vacations.length} vacation(s) from ${file.name}; the previous list was replaced.`);
    } catch (err) {
      setErrors(errorText(err));
    }
  }

  const inTeams = new Set(users.map((u) => u.toLowerCase()));
  return (
    <section className="card">
      <h2>Vacations</h2>
      <p className="muted">
        Vacation working days are shown in green and excluded from the monthly norm. Kept in this browser only; use
        Download / Upload to share them.
      </p>
      <form className="vacation-form" onSubmit={add}>
        <select value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })}>
          <option value="">Employee…</option>
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to || e.target.value })} />
        <input type="date" value={form.to} min={form.from || undefined} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        <button type="submit" className="primary">
          Add
        </button>
      </form>
      <div className="actions">
        <label className="button">
          Upload JSON…
          <input type="file" accept=".json,application/json" onChange={upload} hidden />
        </label>
        <button disabled={!vacations.length} onClick={() => downloadText("vacations.json", vacationsJson(vacations))}>
          Download JSON
        </button>
        {message && <span className="ok">{message}</span>}
      </div>
      <ErrorList errors={errors} />
      {vacations.length ? (
        <div className="table-scroll">
        <table className="matrix vacations-table">
          <thead>
            <tr>
              <th className="left">Employee</th>
              <th className="left">From</th>
              <th className="left">To</th>
              <th>Working days</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vacations.map((v, i) => (
              <tr key={`${v.user}-${v.from}-${i}`}>
                <td className="left">
                  {v.user}
                  {!inTeams.has(v.user.toLowerCase()) && <span className="chip">not in team config</span>}
                </td>
                <td className="left">{v.from}</td>
                <td className="left">{v.to}</td>
                <td className="num">{workingDays(v)}</td>
                <td>
                  <button
                    className="icon-btn small"
                    title="Delete"
                    aria-label={`Delete vacation of ${v.user} from ${v.from}`}
                    onClick={() => onVacations(vacations.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        <p className="muted">No vacations yet.</p>
      )}
    </section>
  );
}

function HighlightCard({
  range,
  onRange,
  hoursPerPersonDay,
}: {
  range: DayRange | null;
  onRange: (r: DayRange | null) => void;
  hoursPerPersonDay: number;
}) {
  const effective = range ?? { min: hoursPerPersonDay, max: null };
  const [form, setForm] = useState({ min: String(effective.min), max: effective.max === null ? "" : String(effective.max) });
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  const save = (e: FormEvent) => {
    e.preventDefault();
    setMessage("");
    const min = Number(form.min);
    const max = form.max.trim() === "" ? null : Number(form.max);
    const problems = [];
    if (form.min.trim() === "" || !isFinite(min) || min < 0 || min > 24) problems.push("Minimum must be between 0 and 24 hours.");
    if (max !== null && (!isFinite(max) || max <= 0 || max > 24)) problems.push("Maximum must be between 0 and 24 hours, or empty for no limit.");
    if (!problems.length && max !== null && max < min) problems.push("Maximum is less than minimum.");
    setErrors(problems);
    if (problems.length) return;
    onRange({ min, max });
    setMessage("Saved.");
  };

  return (
    <section className="card">
      <h2>Daily highlighting</h2>
      <p className="muted">
        In People reports, an employee's day is red when the hours logged are outside this range: below the minimum on
        a past working day (not on vacation), or above the maximum on any day. Kept in this browser.
      </p>
      <form className="form" onSubmit={save}>
        <div className="range-inputs">
          <label>
            From, hours
            <input type="number" min="0" max="24" step="0.5" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} />
          </label>
          <label>
            To, hours
            <input
              type="number"
              min="0"
              max="24"
              step="0.5"
              placeholder="no limit"
              value={form.max}
              onChange={(e) => setForm({ ...form, max: e.target.value })}
            />
          </label>
        </div>
        <div className="actions">
          <button type="submit" className="primary">
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              onRange(null);
              setForm({ min: String(hoursPerPersonDay), max: "" });
              setErrors([]);
              setMessage("Reset to at least one person-day.");
            }}
          >
            Reset
          </button>
          {message && <span className="ok">{message}</span>}
        </div>
      </form>
      <ErrorList errors={errors} />
    </section>
  );
}
