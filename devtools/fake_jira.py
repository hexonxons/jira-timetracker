"""A fake Jira Data Center with generated worklogs, for local development and demos.

    python devtools/fake_jira.py            # serves on http://127.0.0.1:8900
    PAT: any non-empty token; team config: devtools/sample-teams.json
"""

from __future__ import annotations

import os
import random
import re
from datetime import date, datetime, timedelta

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request

SD_TRACK_FIELD = "customfield_12345"
TRACKS = ["Platform Migration", "Monitoring", "Sensor Unification", "CI/CD", "Simulation", None]
USERS = {
    "alice": "Alice Smith", "bob": "Bob Jones", "carol": "Carol Brown", "dave": "David Green",
    "eve": "Eve Black", "frank": "Frank White", "grace": "Grace Hall", "heidi": "Heidi Klum",
    "ivan": "Ivan Petrov", "judy": "Judy Moss",
}
IDLE_USERS = {"judy"}  # in the config, but never logs time

rng = random.Random(42)
ISSUES: dict[str, dict] = {}
WORKLOGS: dict[str, list[dict]] = {}


def generate() -> None:
    projects = ["SDS", "DEV", "PERF"]
    for p in projects:
        for n in range(1, 16):
            key = f"{p}-{100 + n}"
            ISSUES[key] = {"summary": f"{p} task {n}: " + rng.choice(
                ["Implement driver", "Fix timestamps", "CI pipeline update", "Refactor", "Load test", "Docs"]),
                "track": rng.choice(TRACKS)}
            WORKLOGS[key] = []
    wid = 1000
    today = date.today()
    day = today.replace(day=1) - timedelta(days=45)
    while day <= today:
        for user in USERS:
            if user in IDLE_USERS:
                continue
            weekend = day.weekday() >= 5
            if weekend and rng.random() > 0.05:
                continue
            remaining = rng.choice([8, 8, 8, 7, 6, 4]) * 3600 if not weekend else 2 * 3600
            while remaining > 0:
                spent = min(remaining, rng.choice([1, 2, 2, 3, 4]) * 3600 + rng.choice([0, 0, 1800]))
                key = rng.choice(list(ISSUES))
                hour = 9 + rng.randint(0, 8)
                wid += 1
                WORKLOGS[key].append({
                    "id": str(wid),
                    "author": {"name": user, "key": user, "displayName": USERS[user]},
                    "updateAuthor": {"name": user},
                    "started": f"{day.isoformat()}T{hour:02d}:00:00.000+0300",
                    "timeSpentSeconds": spent,
                    "comment": rng.choice(["", "", "Review", "Pairing session", "Investigating flaky test"]),
                })
                remaining -= spent
        day += timedelta(days=1)


generate()
app = FastAPI(title="Fake Jira DC")


def auth(authorization: str | None) -> None:
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) <= 7:
        raise HTTPException(401)


@app.get("/rest/api/2/myself")
def myself(authorization: str | None = Header(None)):
    auth(authorization)
    return {"name": "reporter", "displayName": "Report Bot", "timeZone": "Europe/Moscow"}


@app.get("/rest/api/2/field")
def fields(authorization: str | None = Header(None)):
    auth(authorization)
    return [
        {"id": "summary", "name": "Summary", "custom": False},
        {"id": "components", "name": "Component/s", "custom": False},
        {"id": SD_TRACK_FIELD, "name": "SD Track", "custom": True},
    ]


@app.get("/rest/api/2/user")
def user(username: str, authorization: str | None = Header(None)):
    auth(authorization)
    if username.lower() not in USERS:
        raise HTTPException(404, {"errorMessages": [f"The user named '{username}' does not exist"]})
    u = username.lower()
    return {"name": u, "key": u, "displayName": USERS[u], "active": True}


@app.post("/rest/api/2/search")
async def search(request: Request, authorization: str | None = Header(None)):
    auth(authorization)
    body = await request.json()
    jql = body["jql"]
    authors = set(re.findall(r'"([^"]+)"', jql.split(")")[0]))
    start, end = re.findall(r'worklogDate [<>]= "([\d-]+)"', jql)
    keys = sorted(
        k for k, logs in WORKLOGS.items()
        if any(w["author"]["name"] in authors and start <= w["started"][:10] <= end for w in logs)
    )
    at, size = body.get("startAt", 0), min(body.get("maxResults", 50), 7)  # tiny pages to exercise paging
    page = keys[at : at + size]
    return {
        "startAt": at, "maxResults": size, "total": len(keys),
        "issues": [{"key": k, "fields": {"summary": ISSUES[k]["summary"],
                    SD_TRACK_FIELD: {"value": ISSUES[k]["track"], "id": "1"} if ISSUES[k]["track"] else None}}
                   for k in page],
    }


@app.get("/rest/api/2/issue/{key}/worklog")
def worklog(key: str, startAt: int = 0, maxResults: int = 1000, authorization: str | None = Header(None)):
    auth(authorization)
    logs = WORKLOGS.get(key)
    if logs is None:
        raise HTTPException(404)
    size = min(maxResults, 20)
    return {"startAt": startAt, "maxResults": size, "total": len(logs), "worklogs": logs[startAt : startAt + size]}


if __name__ == "__main__":
    print("Fake Jira on http://127.0.0.1:8900 (generated at", datetime.now().isoformat(timespec="seconds"), ")")
    uvicorn.run(app, host=os.environ.get("FAKE_JIRA_HOST", "127.0.0.1"), port=8900, log_level="warning")
