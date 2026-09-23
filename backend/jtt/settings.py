"""Local settings storage: a single JSON file in the user's home directory."""

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
    # Path to a CA bundle (PEM) for the corporate certificate; empty = system default.
    ca_bundle: str = ""
    # Last uploaded (and validated) team configuration, stored as-is.
    teams_config: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def base_url(self) -> str:
        return self.jira_url.rstrip("/")

    def public_view(self) -> dict[str, Any]:
        """Settings as shown to the browser: the token itself never leaves the backend."""
        return {
            "jiraUrl": self.jira_url,
            "hasPat": bool(self.pat),
            "sdTrackFieldName": self.sd_track_field_name,
            "hoursPerPersonDay": self.hours_per_person_day,
            "caBundle": self.ca_bundle,
            "teamsConfig": self.teams_config,
        }


def load_settings() -> Settings:
    path = settings_path()
    if not path.exists():
        return Settings()
    data = json.loads(path.read_text(encoding="utf-8"))
    known = {k: v for k, v in data.items() if k in Settings.__dataclass_fields__}
    return Settings(**known)


def save_settings(settings: Settings) -> None:
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(settings), indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(path)
