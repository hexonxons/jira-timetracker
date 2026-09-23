"""Loads worklogs for the configured people and period and normalizes them into a dataset.

The dataset is flat on purpose: all aggregations (calendars, summaries, drill-downs)
are computed from it by the frontend, so every report is built from the same numbers.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import date, datetime, timezone
from typing import Any

from .jira import JiraClient, JiraError
from .teams import Team

MAX_PERIOD_DAYS = 31
USERS_PER_JQL = 50
SEARCH_PAGE_SIZE = 500
WORKLOG_PAGE_SIZE = 1000
CONCURRENCY = 8

Progress = Callable[[str, int, int], None]


class ReportError(Exception):
    """The report cannot be built; carries every problem found."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def validate_period(start: date, end: date) -> None:
    if end < start:
        raise ReportError(["End date is before start date."])
    days = (end - start).days + 1
    if days > MAX_PERIOD_DAYS:
        raise ReportError([f"Period is {days} days long; at most {MAX_PERIOD_DAYS} days are supported."])


def jql_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_jql(usernames: list[str], start: date, end: date) -> str:
    authors = ", ".join(jql_string(u) for u in usernames)
    return (
        f"worklogAuthor in ({authors}) "
        f'AND worklogDate >= "{start.isoformat()}" AND worklogDate <= "{end.isoformat()}"'
    )


def find_field(fields: list[dict[str, Any]], name: str) -> dict[str, Any]:
    matches = [f for f in fields if f.get("name") == name]
    if not matches:
        matches = [f for f in fields if str(f.get("name", "")).lower() == name.lower()]
    if not matches:
        raise ReportError([f'Jira has no field named "{name}". Check the SD Track field name in Settings.'])
    if len(matches) > 1:
        ids = ", ".join(str(f.get("id")) for f in matches)
        raise ReportError([f'Jira has several fields named "{name}" ({ids}); cannot tell which one is SD Track.'])
    return matches[0]


def track_value(raw: Any) -> str | None:
    """Current SD Track of an issue. The field is a single select: {"value": "..."} or null."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        value = raw.get("value", raw.get("name"))
        return str(value).strip() or None if value is not None else None
    if isinstance(raw, list):  # defensive: not expected for a single select
        values = [track_value(v) for v in raw]
        return ", ".join(v for v in values if v) or None
    return str(raw).strip() or None


async def build_dataset(
    client: JiraClient,
    *,
    teams: list[Team],
    start: date,
    end: date,
    jira_url: str,
    sd_track_field_name: str,
    hours_per_person_day: float,
    progress: Progress = lambda stage, done, total: None,
) -> dict[str, Any]:
    validate_period(start, end)

    progress("Connecting to Jira", 0, 1)
    await client.myself()
    field = find_field(await client.fields(), sd_track_field_name)
    field_id = field["id"]

    # --- people -------------------------------------------------------------------
    all_users = [u for t in teams for u in t.users]
    semaphore = asyncio.Semaphore(CONCURRENCY)
    resolved = 0

    async def resolve(username: str) -> tuple[str, dict[str, Any] | None]:
        nonlocal resolved
        async with semaphore:
            user = await client.user(username)
        resolved += 1
        progress("Resolving users", resolved, len(all_users))
        return username, user

    progress("Resolving users", 0, len(all_users))
    users = dict(await asyncio.gather(*(resolve(u) for u in all_users)))
    missing = [u for u in all_users if users[u] is None]
    if missing:
        raise ReportError([f'User "{u}" from the team config was not found in Jira.' for u in missing])

    warnings: list[str] = []
    roster_teams = []
    canonical: dict[str, str] = {}  # lower-cased Jira username -> username as in the dataset
    for team in teams:
        members = []
        for u in team.users:
            info = users[u] or {}
            name = str(info.get("name") or u)
            canonical[name.lower()] = name
            canonical[u.lower()] = name
            members.append({"username": name, "displayName": info.get("displayName") or name})
            if info.get("active") is False:
                warnings.append(f"{info.get('displayName') or name} ({name}) is inactive in Jira.")
        roster_teams.append({"name": team.name, "members": members})

    # --- issues -------------------------------------------------------------------
    issues: dict[str, dict[str, Any]] = {}
    chunks = [all_users[i : i + USERS_PER_JQL] for i in range(0, len(all_users), USERS_PER_JQL)]
    for n, chunk in enumerate(chunks, 1):
        jql = build_jql(chunk, start, end)
        start_at = 0
        while True:
            page = await client.search(jql, ["summary", field_id], start_at, SEARCH_PAGE_SIZE)
            batch = page.get("issues") or []
            for issue in batch:
                fields = issue.get("fields") or {}
                issues[issue["key"]] = {
                    "key": issue["key"],
                    "summary": fields.get("summary") or "",
                    "sdTrack": track_value(fields.get(field_id)),
                    "url": f"{jira_url.rstrip('/')}/browse/{issue['key']}",
                }
            start_at += len(batch)
            progress(f"Searching issues ({n}/{len(chunks)})", len(issues), len(issues))
            if not batch or start_at >= int(page.get("total", 0)):
                break

    # --- worklogs -----------------------------------------------------------------
    worklogs: list[dict[str, Any]] = []
    fetched = 0
    start_s, end_s = start.isoformat(), end.isoformat()

    async def fetch(key: str) -> list[dict[str, Any]]:
        nonlocal fetched
        result: list[dict[str, Any]] = []
        start_at = 0
        async with semaphore:
            while True:
                page = await client.issue_worklogs(key, start_at, WORKLOG_PAGE_SIZE)
                batch = page.get("worklogs") or []
                result.extend(batch)
                start_at += len(batch)
                if not batch or start_at >= int(page.get("total", len(result))):
                    break
        fetched += 1
        progress("Loading worklogs", fetched, len(issues))
        return result

    keys = sorted(issues)
    progress("Loading worklogs", 0, len(keys))
    results = await asyncio.gather(*(fetch(k) for k in keys))
    for key, raw_worklogs in zip(keys, results):
        for w in raw_worklogs:
            author = (w.get("author") or {}).get("name")
            username = canonical.get(str(author).lower()) if author else None
            started = str(w.get("started") or "")
            day = started[:10]
            if username is None or not (start_s <= day <= end_s):
                continue
            worklogs.append(
                {
                    "id": str(w.get("id")),
                    "username": username,
                    "issueKey": key,
                    "date": day,
                    "started": started,
                    "seconds": int(w.get("timeSpentSeconds") or 0),
                    "comment": w.get("comment") or "",
                }
            )
    worklogs.sort(key=lambda w: (w["started"], w["issueKey"], w["id"]))

    used_keys = {w["issueKey"] for w in worklogs}
    return {
        "meta": {
            "start": start_s,
            "end": end_s,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "jiraUrl": jira_url.rstrip("/"),
            "hoursPerPersonDay": hours_per_person_day,
            "sdTrackField": {"id": field_id, "name": field.get("name")},
            "warnings": warnings,
        },
        "teams": roster_teams,
        "issues": {k: v for k, v in issues.items() if k in used_keys},
        "worklogs": worklogs,
    }


__all__ = ["build_dataset", "ReportError", "JiraError", "validate_period", "build_jql", "track_value"]
