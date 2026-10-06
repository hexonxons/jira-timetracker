import { useState, type ChangeEvent, type FormEvent } from "react";
import { api, ApiError, type ConnectionInfo, type JiraUser, type PublicSettings } from "../api";
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
  type TeamsConfig,
} from "../lib/teamsEdit";
import { lookupUser, useUserNames } from "../lib/userNames";
import { sortVacations, type Vacation } from "../lib/vacations";
import { parseWorkspace, workspaceJson } from "../lib/workspace";

export function SettingsPage({
  settings,
  ownTeams,
  onOwnTeams,
  vacations,
  onVacations,
  range,
  onRange,
  hasOwn,
}: {
  settings: PublicSettings;
  /** The team config kept in this browser (overrides the instance default). */
  ownTeams: unknown | null;
  onOwnTeams: (config: unknown | null) => void;
  vacations: Vacation[];
  /** null = back to the instance default. */
  onVacations: (v: Vacation[] | null) => void;
  range: DayRange;
  onRange: (r: DayRange | null) => void;
  /** Whether this browser holds its own teams, vacations or highlighting. */
  hasOwn: boolean;
}) {
  const teams = normalizeTeams(ownTeams ?? settings.teamsConfig);
  return (
    <div className="page settings">
      <ConnectionCard settings={settings} />
      <ConfigFileCard
        settings={settings}
        teams={teams}
        vacations={vacations}
        range={range}
        hasOwn={hasOwn}
        apply={(t, v, r) => {
          if (t !== undefined) onOwnTeams(t);
          if (v !== undefined) onVacations(v);
          if (r !== undefined) onRange(r);
        }}
      />
      <HighlightCard key={JSON.stringify(range)} range={range} onRange={onRange} />
      <TeamsCard
        settings={settings}
        ownTeams={ownTeams}
        onOwnTeams={onOwnTeams}
        vacations={vacations}
        onVacations={onVacations}
      />
    </div>
  );
}

/** Upload / download of the single JSON with teams, vacations and highlighting. */
function ConfigFileCard({
  settings,
  teams,
  vacations,
  range,
  hasOwn,
  apply,
}: {
  settings: PublicSettings;
  teams: TeamsConfig;
  vacations: Vacation[];
  range: DayRange;
  hasOwn: boolean;
  apply: (teams?: unknown | null, vacations?: Vacation[] | null, range?: DayRange | null) => void;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    setErrors([]);
    setMessage("");
    try {
      const file = await readJsonFile(e);
      if (!file) return;
      const parsed = parseWorkspace(file.data);
      if (parsed.teams) {
        try {
          await api.validateTeams(parsed.teams);
        } catch (err) {
          parsed.errors.unshift(...errorText(err));
        }
      }
      if (parsed.errors.length) {
        setErrors(parsed.errors);
        return;
      }
      apply(parsed.teams, parsed.vacations, parsed.highlight);
      const loaded = [
        parsed.teams && "teams",
        parsed.vacations && `${parsed.vacations.length} vacation(s)`,
        parsed.highlight !== undefined && "highlighting",
      ].filter(Boolean);
      setMessage(`Loaded ${loaded.join(", ")} from ${file.name}.`);
    } catch (err) {
      setErrors(errorText(err));
    }
  }

  return (
    <section className="card">
      <h2>Configuration file</h2>
      <p className="muted">
        One JSON with teams, vacations and daily highlighting. Uploading applies only the sections the file has; they
        are kept in this browser. The same file can serve as the instance default (<code>JTT_TEAMS_FILE</code>).
      </p>
      <pre className="format">{`{
  "teams": [{"name": "Sensors", "users": ["dave", "eve"]}],
  "vacations": [{"user": "dave", "from": "2026-09-21", "to": "2026-09-25"}],
  "highlight": {"min": 6, "max": 11}
}`}</pre>
      <div className="actions">
        <label className="button primary">
          Upload JSON…
          <input type="file" accept=".json,application/json" onChange={upload} hidden />
        </label>
        <button onClick={() => downloadText("jira-timetracker.json", workspaceJson(teams, vacations, range))}>
          Download JSON
        </button>
        {hasOwn && (
          <button
            onClick={() => {
              apply(null, null, null);
              setErrors([]);
              setMessage(settings.teamsConfig ? "Back to the instance defaults." : "Forgot your settings.");
            }}
          >
            {settings.teamsConfig ? "Reset to instance defaults" : "Forget my settings"}
          </button>
        )}
        {message && <span className="ok">{message}</span>}
      </div>
      <ErrorList errors={errors} title="The file was rejected:" />
    </section>
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

function workingDays(v: Vacation): number {
  return periodDays(v.from, v.to).filter((d) => !dayColumn(d).weekend).length;
}

/** "Sep 7–8", "Sep 30 – Oct 2", with the year when it is not the current one. */
function vacationLabel(v: Vacation): string {
  const year = String(new Date().getFullYear());
  const a = dayColumn(v.from);
  const b = dayColumn(v.to);
  const suffix = v.to.slice(0, 4) !== year ? ` ${v.to.slice(0, 4)}` : "";
  if (v.from === v.to) return a.label + suffix;
  const [am] = a.label.split(" ");
  const [bm, bd] = b.label.split(" ");
  return (am === bm && v.from.slice(0, 4) === v.to.slice(0, 4) ? `${a.label}–${bd}` : `${a.label} – ${b.label}`) + suffix;
}

function TeamsCard({
  settings,
  ownTeams,
  onOwnTeams,
  vacations,
  onVacations,
}: {
  settings: PublicSettings;
  ownTeams: unknown | null;
  onOwnTeams: (config: unknown | null) => void;
  vacations: Vacation[];
  onVacations: (v: Vacation[] | null) => void;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [newUser, setNewUser] = useState<Record<string, string>>({});
  const [newTeam, setNewTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const usingOwn = ownTeams !== null;
  const config = normalizeTeams(usingOwn ? ownTeams : settings.teamsConfig);
  const allUsers = config.teams.flatMap((t) => t.users);
  const names = useUserNames([...allUsers, ...vacations.map((v) => v.user)]);

  const say = (done: string) => setMessage(usingOwn ? done : `${done} Saved as your own config in this browser.`);

  /** Every edit becomes this browser's own config (the instance default is read-only). */
  function edit(change: (c: TeamsConfig) => TeamsConfig, done: string) {
    setErrors([]);
    try {
      onOwnTeams(change(config));
      say(done);
      return true;
    } catch (err) {
      setMessage("");
      setErrors(errorText(err));
      return false;
    }
  }

  const addMember = (team: string) => async (e: FormEvent) => {
    e.preventDefault();
    const user = (newUser[team] ?? "").trim();
    setErrors([]);
    setMessage("");
    let next: TeamsConfig;
    try {
      next = addUser(config, team, user);
    } catch (err) {
      setErrors(errorText(err));
      return;
    }
    setBusy(true);
    try {
      const found = await lookupUser(user);
      if (!found) {
        setErrors([`User "${user}" was not found in Jira. Use the Jira username (login), not the display name.`]);
        return;
      }
      onOwnTeams(next);
      setNewUser({ ...newUser, [team]: "" });
      say(`Added ${found.displayName} (${user}) to ${team}.`);
    } catch (err) {
      // Jira unreachable: keep the edit, report generation will validate the user anyway.
      onOwnTeams(next);
      setNewUser({ ...newUser, [team]: "" });
      setMessage(`Added ${user} to ${team}, but could not check it in Jira: ${errorText(err).join("; ")}`);
    } finally {
      setBusy(false);
    }
  };

  const createTeam = (e: FormEvent) => {
    e.preventDefault();
    if (edit((c) => addTeam(c, newTeam), `Added team ${newTeam.trim()}.`)) setNewTeam("");
  };

  const addVacation = (v: Vacation) => {
    onVacations(sortVacations([...vacations, v]));
    setErrors([]);
    setMessage(`Added a vacation for ${names.get(v.user)?.displayName ?? v.user}: ${vacationLabel(v)}.`);
  };
  const deleteVacation = (v: Vacation) => onVacations(vacations.filter((x) => x !== v));
  const vacationsOf = (user: string) => vacations.filter((v) => v.user.toLowerCase() === user.toLowerCase());
  const inTeams = new Set(allUsers.map((u) => u.toLowerCase()));
  const orphanVacations = vacations.filter((v) => !inTeams.has(v.user.toLowerCase()));

  return (
    <section className="card teams-card">
      <h2>Teams</h2>
      <p className="muted">
        Each user must belong to exactly one team; people not listed are excluded from reports. Team changes apply to
        the next report you generate; vacations (green in reports, excluded from the norm) apply at once.
      </p>
      <p className="muted">
        {usingOwn
          ? "Using your own config. It is kept in this browser only and sent with each report request."
          : settings.teamsConfig
            ? "Using the instance default config. Editing creates your own copy in this browser."
            : "This instance has no default config: upload a configuration file or create teams below."}
      </p>
      {message && <p className="ok">{message}</p>}
      <ErrorList errors={errors} />
      {names.error && <p className="muted warn-text">Names could not be loaded from Jira: {names.error}</p>}
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
            <ul className="members">
              {t.users.map((u) => (
                <MemberRow
                  key={u}
                  username={u}
                  user={names.get(u)}
                  vacations={vacationsOf(u)}
                  onRemove={() => edit((c) => removeUser(c, t.name, u), `Removed ${names.get(u)?.displayName ?? u} from ${t.name}.`)}
                  onAddVacation={(from, to) => addVacation({ user: u, from, to })}
                  onDeleteVacation={deleteVacation}
                />
              ))}
            </ul>
            <form className="inline-form" onSubmit={addMember(t.name)}>
              <input
                placeholder="jira.username"
                value={newUser[t.name] ?? ""}
                onChange={(e) => setNewUser({ ...newUser, [t.name]: e.target.value })}
              />
              <button type="submit" disabled={busy}>
                Add person
              </button>
            </form>
          </div>
        ))}
        <form className="inline-form" onSubmit={createTeam}>
          <input placeholder="New team name" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} />
          <button type="submit">Add team</button>
        </form>
        {orphanVacations.length > 0 && (
          <div className="team-block wide">
            <div className="team-head">
              <strong>Vacations of people not in any team</strong>
            </div>
            <ul className="members">
              {orphanVacations.map((v, i) => (
                <li key={`${v.user}-${v.from}-${i}`} className="member">
                  <span className="member-name">
                    {names.get(v.user) ? (
                      <>
                        {names.get(v.user)!.displayName} <span className="muted">{v.user}</span>
                      </>
                    ) : (
                      v.user
                    )}
                  </span>
                  <span className="vacations">
                    <VacationChip v={v} onDelete={() => deleteVacation(v)} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function VacationChip({ v, onDelete }: { v: Vacation; onDelete: () => void }) {
  const days = workingDays(v);
  return (
    <span className="vacation-chip" title={`${v.from} – ${v.to}, ${days} working day(s)`}>
      {vacationLabel(v)}
      <button aria-label={`Delete vacation ${v.from} – ${v.to}`} title="Delete vacation" onClick={onDelete}>
        ×
      </button>
    </span>
  );
}

function MemberRow({
  username,
  user,
  vacations,
  onRemove,
  onAddVacation,
  onDeleteVacation,
}: {
  username: string;
  /** undefined = loading, null = not found in Jira. */
  user: JiraUser | null | undefined;
  vacations: Vacation[];
  onRemove: () => void;
  onAddVacation: (from: string, to: string) => void;
  onDeleteVacation: (v: Vacation) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [range, setRange] = useState({ from: "", to: "" });
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!range.from || !range.to) return setError("Set both dates.");
    if (range.to < range.from) return setError("The end date is before the start date.");
    onAddVacation(range.from, range.to);
    setRange({ from: "", to: "" });
    setError("");
    setAdding(false);
  };

  return (
    <li className="member">
      <span className="member-name">
        {user === undefined ? (
          <span className="muted">{username}</span>
        ) : user === null ? (
          <>
            {username} <span className="chip warn-chip">not found in Jira</span>
          </>
        ) : (
          <>
            {user.displayName} <span className="muted">{username}</span>
            {!user.active && <span className="chip">inactive</span>}
          </>
        )}
      </span>
      <span className="vacations">
        {vacations.map((v) => (
          <VacationChip key={`${v.from}-${v.to}`} v={v} onDelete={() => onDeleteVacation(v)} />
        ))}
        {adding ? (
          <form className="vacation-inline" onSubmit={submit}>
            <input
              type="date"
              aria-label="Vacation from"
              value={range.from}
              onChange={(e) => setRange({ from: e.target.value, to: range.to || e.target.value })}
            />
            <input
              type="date"
              aria-label="Vacation to"
              min={range.from || undefined}
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
            <button type="submit" className="primary">
              Add
            </button>
            <button type="button" onClick={() => (setAdding(false), setError(""))}>
              Cancel
            </button>
            {error && <span className="error-text">{error}</span>}
          </form>
        ) : (
          <button className="link-btn" onClick={() => setAdding(true)}>
            + vacation
          </button>
        )}
      </span>
      <button className="icon-btn small" title="Remove from team" aria-label={`Remove ${username} from team`} onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

function HighlightCard({ range, onRange }: { range: DayRange; onRange: (r: DayRange | null) => void }) {
  const [form, setForm] = useState({ min: String(range.min), max: range.max === null ? "" : String(range.max) });
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
            title="Back to the instance default, or at least one person-day"
            onClick={() => onRange(null)}
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
