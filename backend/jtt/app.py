"""HTTP API for the UI, and static hosting of the built frontend."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import ssl
from datetime import date
from pathlib import Path
from typing import Any

import truststore
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth
from .jira import JiraClient, JiraError
from .jobs import JobRegistry
from .loader import ReportError, build_dataset, find_field, validate_period
from .settings import Settings, load_settings
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


@app.middleware("http")
async def require_sign_in(request: Request, call_next):
    refused = auth.guard(load_settings(), request)
    return refused if refused is not None else await call_next(request)


# --- sign-in (OpenID Connect) ----------------------------------------------------


def sign_in_settings() -> Settings:
    settings = load_settings()
    if not settings.oidc_enabled:
        raise HTTPException(404)
    return settings


@app.get("/auth/login", include_in_schema=False)
async def login(request: Request, next: str | None = None) -> Response:
    settings = sign_in_settings()
    if settings.oidc_errors:
        return auth.error_page("; ".join(settings.oidc_errors), 503)
    try:
        return await auth.login(settings, request, next)
    except auth.AuthError as exc:
        return auth.error_page(str(exc), 502)


@app.get("/auth/callback", include_in_schema=False)
async def callback(request: Request) -> Response:
    settings = sign_in_settings()
    if settings.oidc_errors:
        return auth.error_page("; ".join(settings.oidc_errors), 503)
    try:
        return await auth.callback(settings, request)
    except auth.AuthError as exc:
        return auth.error_page(str(exc))


@app.get("/auth/logout", include_in_schema=False)
async def logout(request: Request) -> Response:
    return await auth.logout(sign_in_settings(), request)


@app.get("/api/me")
def me(request: Request) -> dict[str, Any]:
    settings = load_settings()
    user = auth.current_user(settings, request) if settings.oidc_enabled else None
    return {
        "authEnabled": settings.oidc_enabled,
        "user": None if user is None else {k: user.get(k) for k in ("username", "name", "email")},
    }


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, Any]:
    settings = load_settings()
    return {"status": "ok", "configErrors": settings.config_errors}


# --- settings --------------------------------------------------------------------


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return load_settings().public_view()


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
    """Validates a user's team config; it is kept in their browser, not on the server."""
    try:
        teams = parse_teams_config(config)
    except TeamsConfigError as exc:
        raise fail(exc.errors)
    return {"teams": [{"name": t.name, "users": list(t.users)} for t in teams]}


class UsersLookup(BaseModel):
    usernames: list[str]


MAX_LOOKUP = 500


@app.post("/api/users/lookup")
async def lookup_users(request: UsersLookup) -> dict[str, Any]:
    """Display names of Jira users by username; null for usernames Jira does not know."""
    settings = load_settings()
    require_connection(settings)
    names = list(dict.fromkeys(u.strip() for u in request.usernames if u.strip()))
    if len(names) > MAX_LOOKUP:
        raise fail([f"At most {MAX_LOOKUP} usernames per request."])
    semaphore = asyncio.Semaphore(8)

    async def one(client: JiraClient, username: str) -> tuple[str, dict[str, Any] | None]:
        async with semaphore:
            user = await client.user(username)
        if user is None:
            return username, None
        return username, {
            "username": user.get("name") or username,
            "displayName": user.get("displayName") or username,
            "active": user.get("active", True),
        }

    try:
        async with make_client(settings) as client:
            found = await asyncio.gather(*(one(client, u) for u in names))
    except (JiraError, OSError) as exc:
        raise fail([f"Cannot look up users in Jira: {exc}"])
    return {"users": dict(found)}


# --- report jobs -----------------------------------------------------------------


class ReportRequest(BaseModel):
    start: date
    end: date
    # A team config sent by the browser; when absent, the instance default is used.
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
        raise fail(["No team config: this instance has no default one. Upload yours in Settings."])
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
        if path.startswith(("api/", "auth/")):
            raise HTTPException(404)
        return FileResponse(FRONTEND_DIST / "index.html")
