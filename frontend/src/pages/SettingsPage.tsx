import { useState, type ChangeEvent } from "react";
import { api, ApiError, type ConnectionInfo, type PublicSettings } from "../api";
import { ErrorList } from "../components/ErrorList";

type TeamsConfig = { teams?: { name: string; users: string[] }[] } | null;

export function SettingsPage({
  settings,
  ownTeams,
  onOwnTeams,
}: {
  settings: PublicSettings;
  /** The team config uploaded in this browser (overrides the instance default). */
  ownTeams: unknown | null;
  onOwnTeams: (config: unknown | null) => void;
}) {
  return (
    <div className="page settings">
      <ConnectionCard settings={settings} />
      <TeamsCard settings={settings} ownTeams={ownTeams} onOwnTeams={onOwnTeams} />
    </div>
  );
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
  const usingOwn = ownTeams !== null;
  const teams = ((usingOwn ? ownTeams : settings.teamsConfig) as TeamsConfig)?.teams;

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErrors([]);
    setMessage("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      setErrors([`${file.name} is not valid JSON: ${(err as Error).message}`]);
      return;
    }
    try {
      await api.validateTeams(parsed);
      onOwnTeams(parsed);
      setMessage(`Loaded ${file.name}.`);
    } catch (err) {
      setErrors(err instanceof ApiError ? err.errors : [String(err)]);
    }
  }

  return (
    <section className="card">
      <h2>Team config</h2>
      <p className="muted">
        JSON with <code>{'{"teams": [{"name": "...", "users": ["jira.username", ...]}]}'}</code>. Each user must belong
        to exactly one team; people not listed are excluded from reports.
      </p>
      <p className="muted">
        {usingOwn
          ? "Using your own config. It is kept in this browser only and sent with each report request."
          : settings.teamsConfig
            ? "Using the instance default config. Upload your own to override it in this browser."
            : "This instance has no default config: upload yours. It is kept in this browser only."}
      </p>
      <div className="actions">
        <label className="button primary">
          Upload JSON…
          <input type="file" accept=".json,application/json" onChange={upload} hidden />
        </label>
        {usingOwn && (
          <button
            onClick={() => {
              onOwnTeams(null);
              setMessage("");
            }}
          >
            {settings.teamsConfig ? "Use instance default" : "Forget my config"}
          </button>
        )}
        {message && <span className="ok">{message}</span>}
      </div>
      <ErrorList errors={errors} title="The config was rejected:" />
      {teams ? (
        <table className="matrix teams-table">
          <thead>
            <tr>
              <th>Team</th>
              <th className="left">Users</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.name}>
                <th>{t.name}</th>
                <td className="left">{t.users.join(", ") || <span className="muted">no users</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No config uploaded yet.</p>
      )}
    </section>
  );
}
