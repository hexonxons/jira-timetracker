"""Settings, in one of two modes.

* Local (desktop) mode: a JSON file in the user's home directory, edited from the UI.
* Service mode: the instance is configured by environment variables (see docs/DEPLOY.md)
  and nothing can be changed from the browser. It is enabled by setting JTT_JIRA_URL.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_SD_TRACK_FIELD_NAME = "SD Track"
DEFAULT_HOURS_PER_PERSON_DAY = 8.0


def settings_dir() -> Path:
    return Path(os.environ.get("JTT_HOME", Path.home() / ".jira-timetracker"))


def settings_path() -> Path:
    return settings_dir() / "settings.json"


@dataclass
class Settings:
    jira_url: str = ""
    pat: str = ""
    sd_track_field_name: str = DEFAULT_SD_TRACK_FIELD_NAME
    hours_per_person_day: float = DEFAULT_HOURS_PER_PERSON_DAY
    # Path to a CA bundle (PEM) for the corporate certificate; empty = OS certificate store.
    ca_bundle: str = ""
    # Team configuration: uploaded from the UI (local mode) or the instance default (service mode).
    teams_config: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    # Service mode only: set from the environment, never persisted.
    managed: bool = False
    config_errors: list[str] = field(default_factory=list)

    @property
    def base_url(self) -> str:
        return self.jira_url.rstrip("/")

    def public_view(self) -> dict[str, Any]:
        """Settings as shown to the browser: the token itself never leaves the backend."""
        return {
            "managed": self.managed,
            "configErrors": self.config_errors,
            "jiraUrl": self.jira_url,
            "hasPat": bool(self.pat),
            "sdTrackFieldName": self.sd_track_field_name,
            "hoursPerPersonDay": self.hours_per_person_day,
            "caBundle": "" if self.managed else self.ca_bundle,
            "teamsConfig": self.teams_config,
        }


def is_managed() -> bool:
    return bool(os.environ.get("JTT_JIRA_URL", "").strip())


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _secret(name: str, errors: list[str]) -> str:
    """Value of NAME, or the contents of the file named by NAME_FILE (Docker/Kubernetes secrets)."""
    value = _env(name)
    path = _env(f"{name}_FILE")
    if not value and path:
        try:
            value = Path(path).read_text(encoding="utf-8").strip()
        except OSError as exc:
            errors.append(f"{name}_FILE: cannot read {path}: {exc.strerror}")
    return value


def load_managed_settings() -> Settings:
    """Service-mode settings from the environment. Re-read on every request, so a mounted
    teams file (e.g. a Kubernetes ConfigMap) can change without a restart."""
    errors: list[str] = []
    settings = Settings(managed=True, jira_url=_env("JTT_JIRA_URL"), pat=_secret("JTT_JIRA_PAT", errors))
    if not settings.jira_url.startswith(("http://", "https://")):
        errors.append("JTT_JIRA_URL must start with http:// or https://.")
    if not settings.pat:
        errors.append("JTT_JIRA_PAT (or JTT_JIRA_PAT_FILE) is not set.")
    settings.sd_track_field_name = _env("JTT_SD_TRACK_FIELD_NAME") or DEFAULT_SD_TRACK_FIELD_NAME
    hours = _env("JTT_HOURS_PER_PERSON_DAY")
    if hours:
        try:
            settings.hours_per_person_day = float(hours)
            if not 0 < settings.hours_per_person_day <= 24:
                raise ValueError
        except ValueError:
            errors.append("JTT_HOURS_PER_PERSON_DAY must be a number between 0 and 24.")
            settings.hours_per_person_day = DEFAULT_HOURS_PER_PERSON_DAY
    settings.ca_bundle = _env("JTT_CA_BUNDLE")
    if settings.ca_bundle and not Path(settings.ca_bundle).is_file():
        errors.append(f"JTT_CA_BUNDLE: file not found: {settings.ca_bundle}")

    teams_file, teams_json = _env("JTT_TEAMS_FILE"), _env("JTT_TEAMS_JSON")
    try:
        if teams_file:
            settings.teams_config = json.loads(Path(teams_file).read_text(encoding="utf-8"))
        elif teams_json:
            settings.teams_config = json.loads(teams_json)
    except OSError as exc:
        errors.append(f"JTT_TEAMS_FILE: cannot read {teams_file}: {exc.strerror}")
    except json.JSONDecodeError as exc:
        errors.append(f"Default team config is not valid JSON: {exc}")
    settings.config_errors = errors
    return settings


def load_settings() -> Settings:
    if is_managed():
        return load_managed_settings()
    path = settings_path()
    if not path.exists():
        return Settings()
    data = json.loads(path.read_text(encoding="utf-8"))
    known = {k: v for k, v in data.items() if k in Settings.__dataclass_fields__ and k not in ("managed", "config_errors")}
    return Settings(**known)


def save_settings(settings: Settings) -> None:
    if settings.managed:
        raise RuntimeError("Settings of a service instance come from its environment and cannot be saved.")
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {k: v for k, v in asdict(settings).items() if k not in ("managed", "config_errors")}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(path)
