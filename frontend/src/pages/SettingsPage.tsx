import { useState, type ChangeEvent, type FormEvent } from "react";
import { api, ApiError, type ConnectionInfo, type PublicSettings } from "../api";
import { ErrorList } from "../components/ErrorList";

export function SettingsPage({
  settings,
  onSaved,
}: {
  settings: PublicSettings;
  onSaved: (s: PublicSettings) => void;
}) {
  const [form, setForm] = useState({
    jiraUrl: settings.jiraUrl,
    pat: "",
    sdTrackFieldName: settings.sdTrackFieldName,
    hoursPerPersonDay: String(settings.hoursPerPersonDay),
    caBundle: settings.caBundle,
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setErrors([]);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setErrors(e instanceof ApiError ? e.errors : [String(e)]);
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const saved = await api.saveSettings({
        ...form,
        pat: form.pat || undefined,
        hoursPerPersonDay: Number(form.hoursPerPersonDay),
      });
      setForm({ ...form, pat: "" });
      onSaved(saved);
      setMessage("Settings saved.");
    });
  };

  const test = () =>
    run(async () => {
      setConnection(null);
      setConnection(await api.testConnection());
    });

  return (
    <div className="page settings">
      <section className="card">
        <h2>Jira connection</h2>
        <form onSubmit={save} className="form">
          <label>
            Jira URL
            <input value={form.jiraUrl} onChange={set("jiraUrl")} placeholder="https://jira.example.com" />
          </label>
          <label>
            Personal Access Token
            <input
              type="password"
              value={form.pat}
              onChange={set("pat")}
              placeholder={settings.hasPat ? "Stored. Type a new one to replace it" : "Paste your PAT"}
              autoComplete="off"
            />
          </label>
          <label>
            SD Track field name
            <input value={form.sdTrackFieldName} onChange={set("sdTrackFieldName")} />
            <small>Looked up by name in Jira fields.</small>
          </label>
          <label>
            Hours per person-day
            <input type="number" min="0.5" max="24" step="0.5" value={form.hoursPerPersonDay} onChange={set("hoursPerPersonDay")} />
          </label>
          <label>
            CA bundle (PEM path, optional)
            <input value={form.caBundle} onChange={set("caBundle")} placeholder="System certificates" />
            <small>Needed only if the Jira certificate is issued by a corporate CA unknown to Python.</small>
          </label>
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              Save
            </button>
            <button type="button" onClick={test} disabled={busy}>
              Test connection
            </button>
            {message && <span className="ok">{message}</span>}
          </div>
        </form>
        {connection && (
          <div className="alert alert-ok">
            Connected as <strong>{connection.user}</strong>
            {connection.timeZone ? ` (time zone ${connection.timeZone})` : ""}. SD Track field:{" "}
            <code>{connection.sdTrackField.id}</code>.
          </div>
        )}
        <ErrorList errors={errors} />
      </section>
      <TeamsCard settings={settings} onSaved={onSaved} />
    </div>
  );
}

function TeamsCard({ settings, onSaved }: { settings: PublicSettings; onSaved: (s: PublicSettings) => void }) {
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const teams = (settings.teamsConfig as { teams?: { name: string; users: string[] }[] } | null)?.teams;

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
      await api.uploadTeams(parsed);
      onSaved(await api.getSettings());
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
      <div className="actions">
        <label className="button primary">
          Upload JSON…
          <input type="file" accept=".json,application/json" onChange={upload} hidden />
        </label>
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
