"""HTTP API for the local UI, and static hosting of the built frontend."""

from __future__ import annotations

import asyncio
import os
import ssl
import uuid
from datetime import date
from pathlib import Path
from typing import Any

import truststore
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .jira import JiraClient, JiraError
from .loader import ReportError, build_dataset, find_field, validate_period
from .settings import Settings, load_settings, save_settings
from .teams import TeamsConfigError, parse_teams_config

FRONTEND_DIST = Path(os.environ.get("JTT_FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
MAX_JOBS = 5

app = FastAPI(title="Jira Timetracker")


def make_client(settings: Settings) -> JiraClient:
    # Without an explicit CA bundle, trust the OS certificate store (Windows, macOS Keychain,
    # Linux ca-certificates), so a corporate CA installed in the system just works.
    verify: str | ssl.SSLContext = settings.ca_bundle or truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return JiraClient(settings.base_url, settings.pat, verify=verify)


def require_connection(settings: Settings) -> None:
    missing = [name for name, value in (("Jira URL", settings.jira_url), ("Personal Access Token", settings.pat)) if not value]
    if missing:
        raise HTTPException(400, {"errors": [f"{m} is not set. Open Settings." for m in missing]})


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
        raise HTTPException(400, {"errors": errors})
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
        raise HTTPException(400, {"errors": exc.errors})
    except (JiraError, OSError) as exc:
        raise HTTPException(400, {"errors": [str(exc)]})
    return {
        "user": me.get("displayName") or me.get("name"),
        "timeZone": me.get("timeZone"),
        "sdTrackField": {"id": field["id"], "name": field.get("name")},
    }


@app.put("/api/teams")
def put_teams(config: Any = Body(None)) -> dict[str, Any]:
    try:
        teams = parse_teams_config(config)
    except TeamsConfigError as exc:
        raise HTTPException(400, {"errors": exc.errors})
    settings = load_settings()
    settings.teams_config = config
    save_settings(settings)
    return {"teams": [{"name": t.name, "users": list(t.users)} for t in teams]}


# --- report jobs -----------------------------------------------------------------


class ReportRequest(BaseModel):
    start: date
    end: date


jobs: dict[str, dict[str, Any]] = {}


async def run_job(job: dict[str, Any], settings: Settings, request: ReportRequest) -> None:
    def progress(stage: str, done: int, total: int) -> None:
        job["progress"] = {"stage": stage, "done": done, "total": total}

    try:
        teams = parse_teams_config(settings.teams_config)
        async with make_client(settings) as client:
            job["dataset"] = await build_dataset(
                client,
                teams=teams,
                start=request.start,
                end=request.end,
                jira_url=settings.base_url,
                sd_track_field_name=settings.sd_track_field_name,
                hours_per_person_day=settings.hours_per_person_day,
                progress=progress,
            )
        job["status"] = "done"
    except (TeamsConfigError, ReportError) as exc:
        job["status"], job["errors"] = "failed", exc.errors
    except (JiraError, OSError) as exc:
        job["status"], job["errors"] = "failed", [f"Loading from Jira failed: {exc}"]
    except Exception as exc:  # the report must fail as a whole, never silently partially
        job["status"], job["errors"] = "failed", [f"Unexpected error: {exc!r}"]


@app.post("/api/reports")
async def create_report(request: ReportRequest) -> dict[str, Any]:
    settings = load_settings()
    require_connection(settings)
    if settings.teams_config is None:
        raise HTTPException(400, {"errors": ["Team config is not uploaded. Open Settings."]})
    try:
        validate_period(request.start, request.end)
        parse_teams_config(settings.teams_config)
    except (ReportError, TeamsConfigError) as exc:
        raise HTTPException(400, {"errors": exc.errors})

    job_id = uuid.uuid4().hex
    job: dict[str, Any] = {"id": job_id, "status": "running", "progress": None, "errors": [], "dataset": None}
    for old in list(jobs)[: max(0, len(jobs) - MAX_JOBS + 1)]:
        jobs.pop(old, None)
    jobs[job_id] = job
    job["task"] = asyncio.create_task(run_job(job, settings, request))
    return {"id": job_id}


@app.get("/api/reports/{job_id}")
def get_report(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, {"errors": ["Report job not found."]})
    return {k: v for k, v in job.items() if k != "task"}


# --- frontend --------------------------------------------------------------------

if (FRONTEND_DIST / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404)
        return FileResponse(FRONTEND_DIST / "index.html")
