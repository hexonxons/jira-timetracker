"""HTTP API for the UI, and static hosting of the built frontend."""

from __future__ import annotations

import hashlib
import json
import os
import ssl
from datetime import date
from pathlib import Path
from typing import Any

import truststore
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .jira import JiraClient, JiraError
from .jobs import JobRegistry
from .loader import ReportError, build_dataset, find_field, validate_period
from .settings import Settings, load_settings, save_settings
from .teams import TeamsConfigError, parse_teams_config

FRONTEND_DIST = Path(os.environ.get("JTT_FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))

app = FastAPI(title="Jira Timetracker")
jobs = JobRegistry(
    max_parallel=int(os.environ.get("JTT_MAX_PARALLEL_REPORTS", "3")),
    cache_seconds=float(os.environ.get("JTT_REPORT_CACHE_SECONDS", "0")),
)


def make_client(settings: Settings) -> JiraClient:
    # Without an explicit CA bundle, trust the OS certificate store (Windows, macOS Keychain,
    # Linux ca-certificates), so a corporate CA installed in the system just works.
    verify: str | ssl.SSLContext = settings.ca_bundle or truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return JiraClient(settings.base_url, settings.pat, verify=verify)


def fail(errors: list[str], status: int = 400) -> HTTPException:
    return HTTPException(status, {"errors": errors})


def require_connection(settings: Settings) -> None:
    if settings.config_errors:
        raise fail([f"Instance configuration: {e}" for e in settings.config_errors])
    missing = [name for name, value in (("Jira URL", settings.jira_url), ("Personal Access Token", settings.pat)) if not value]
    if missing:
        raise fail([f"{m} is not set. Open Settings." for m in missing])


def require_local(settings: Settings) -> None:
    if settings.managed:
        raise fail(["This instance is configured by its administrator; settings cannot be changed here."], 403)


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, Any]:
    settings = load_settings()
    return {"status": "ok", "managed": settings.managed, "configErrors": settings.config_errors}


# --- settings --------------------------------------------------------------------


class SettingsUpdate(BaseModel):
    jiraUrl: str | None = None
    pat: str | None = None  # empty/None keeps the stored token
    sdTrackFieldName: str | None = None
    hoursPerPersonDay: float | None = None
    caBundle: str | None = None


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return load_settings().public_view()


@app.put("/api/settings")
def put_settings(update: SettingsUpdate) -> dict[str, Any]:
    settings = load_settings()
    require_local(settings)
    errors = []
    if update.jiraUrl is not None:
        url = update.jiraUrl.strip()
        if url and not url.startswith(("http://", "https://")):
            errors.append("Jira URL must start with http:// or https://.")
        settings.jira_url = url
    if update.pat:
        settings.pat = update.pat.strip()
    if update.sdTrackFieldName is not None:
        if not update.sdTrackFieldName.strip():
            errors.append("SD Track field name must not be empty.")
        settings.sd_track_field_name = update.sdTrackFieldName.strip()
    if update.hoursPerPersonDay is not None:
        if not 0 < update.hoursPerPersonDay <= 24:
            errors.append("Hours per person-day must be between 0 and 24.")
        settings.hours_per_person_day = update.hoursPerPersonDay
    if update.caBundle is not None:
        path = update.caBundle.strip()
        if path and not Path(path).expanduser().is_file():
            errors.append(f"CA bundle file not found: {path}")
        settings.ca_bundle = str(Path(path).expanduser()) if path else ""
    if errors:
        raise fail(errors)
    save_settings(settings)
    return settings.public_view()


@app.post("/api/settings/test")
async def test_connection() -> dict[str, Any]:
    settings = load_settings()
    require_connection(settings)
    try:
        async with make_client(settings) as client:
            me = await client.myself()
            field = find_field(await client.fields(), settings.sd_track_field_name)
    except ReportError as exc:
        raise fail(exc.errors)
    except (JiraError, OSError) as exc:
        raise fail([str(exc)])
    return {
        "user": me.get("displayName") or me.get("name"),
        "timeZone": me.get("timeZone"),
        "sdTrackField": {"id": field["id"], "name": field.get("name")},
    }


def teams_view(config: Any) -> dict[str, Any]:
    try:
        teams = parse_teams_config(config)
    except TeamsConfigError as exc:
        raise fail(exc.errors)
    return {"teams": [{"name": t.name, "users": list(t.users)} for t in teams]}


@app.post("/api/teams/validate")
def validate_teams(config: Any = Body(None)) -> dict[str, Any]:
    """Validates a team config without storing it (service mode keeps it in the browser)."""
    return teams_view(config)


@app.put("/api/teams")
def put_teams(config: Any = Body(None)) -> dict[str, Any]:
    settings = load_settings()
    require_local(settings)
    view = teams_view(config)
    settings.teams_config = config
    save_settings(settings)
    return view


# --- report jobs -----------------------------------------------------------------


class ReportRequest(BaseModel):
    start: date
    end: date
    # A team config sent by the browser; when absent, the stored/instance default is used.
    teams: dict[str, Any] | None = None


def report_error(exc: BaseException) -> list[str]:
    if isinstance(exc, (TeamsConfigError, ReportError)):
        return exc.errors
    if isinstance(exc, (JiraError, OSError)):
        return [f"Loading from Jira failed: {exc}"]
    return [f"Unexpected error: {exc!r}"]


@app.post("/api/reports")
async def create_report(request: ReportRequest) -> dict[str, Any]:
    settings = load_settings()
    require_connection(settings)
    config = request.teams if request.teams is not None else settings.teams_config
    if config is None:
        raise fail(["No team config. Upload one in Settings."])
    try:
        validate_period(request.start, request.end)
        teams = parse_teams_config(config)
    except (ReportError, TeamsConfigError) as exc:
        raise fail(exc.errors)

    key = hashlib.sha256(
        json.dumps(
            [request.start.isoformat(), request.end.isoformat(), config, settings.base_url,
             settings.sd_track_field_name, settings.hours_per_person_day],
            sort_keys=True,
        ).encode()
    ).hexdigest()

    async def run(progress) -> dict[str, Any]:
        async with make_client(settings) as client:
            return await build_dataset(
                client,
                teams=teams,
                start=request.start,
                end=request.end,
                jira_url=settings.base_url,
                sd_track_field_name=settings.sd_track_field_name,
                hours_per_person_day=settings.hours_per_person_day,
                progress=progress,
            )

    return {"id": jobs.submit(key, run, report_error).id}


@app.get("/api/reports/{job_id}")
def get_report(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise fail(["Report not found (it may have expired). Generate it again."], 404)
    return job.view()


# --- frontend --------------------------------------------------------------------

if (FRONTEND_DIST / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404)
        return FileResponse(FRONTEND_DIST / "index.html")
