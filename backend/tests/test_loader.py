from datetime import date

import httpx
import pytest
import respx

from jtt.jira import JiraClient
from jtt.loader import ReportError, build_dataset, build_jql, track_value
from jtt.teams import Team

BASE = "https://jira.example"
FIELD = "customfield_1"


def wl(id, author, started, seconds, comment=None):
    return {"id": id, "author": {"name": author}, "started": started, "timeSpentSeconds": seconds, "comment": comment}


def mock_jira(users, issues, worklogs, search_page=2, worklog_page=2):
    respx.get(f"{BASE}/rest/api/2/myself").mock(return_value=httpx.Response(200, json={"name": "me"}))
    respx.get(f"{BASE}/rest/api/2/field").mock(
        return_value=httpx.Response(200, json=[{"id": "summary", "name": "Summary"}, {"id": FIELD, "name": "SD Track"}])
    )

    def user(request):
        name = request.url.params["username"]
        if name.lower() not in users:
            return httpx.Response(404)
        return httpx.Response(200, json={"name": name.lower(), "displayName": users[name.lower()], "active": True})

    respx.get(f"{BASE}/rest/api/2/user").mock(side_effect=user)

    def search(request):
        import json

        body = json.loads(request.content)
        at = body["startAt"]
        keys = sorted(issues)
        return httpx.Response(
            200,
            json={
                "total": len(keys),
                "issues": [{"key": k, "fields": issues[k]} for k in keys[at : at + search_page]],
            },
        )

    respx.post(f"{BASE}/rest/api/2/search").mock(side_effect=search)

    def worklog(request, key):
        at = int(request.url.params["startAt"])
        logs = worklogs.get(key, [])
        if isinstance(logs, httpx.Response):
            return logs
        return httpx.Response(200, json={"total": len(logs), "worklogs": logs[at : at + worklog_page]})

    respx.get(url__regex=rf"{BASE}/rest/api/2/issue/(?P<key>[A-Z]+-\d+)/worklog").mock(side_effect=worklog)


async def load(teams, start=date(2026, 9, 1), end=date(2026, 9, 30)):
    async def no_sleep(_):
        pass

    async with JiraClient(BASE, "tok", sleep=no_sleep) as client:
        return await build_dataset(
            client, teams=teams, start=start, end=end, jira_url=BASE + "/",
            sd_track_field_name="SD Track", hours_per_person_day=8,
        )


@respx.mock
async def test_filters_foreign_authors_and_dates_and_pages_everything():
    mock_jira(
        users={"alice": "Alice Smith", "bob": "Bob Jones"},
        issues={
            "SDS-1": {"summary": "Driver", FIELD: {"value": "Platform Migration"}},
            "SDS-2": {"summary": "No track", FIELD: None},
            "SDS-3": {"summary": "Only outsiders", FIELD: {"value": "Monitoring"}},
        },
        worklogs={
            "SDS-1": [
                wl(1, "alice", "2026-09-01T10:00:00.000+0300", 3600, "a"),
                wl(2, "alice", "2026-08-31T23:30:00.000+0300", 3600),  # before period
                wl(3, "stranger", "2026-09-02T10:00:00.000+0300", 3600),  # not in config
                wl(4, "Bob", "2026-09-30T23:59:00.000+0300", 1800),  # last day, other case
                wl(5, "bob", "2026-10-01T00:00:00.000+0300", 1800),  # after period
            ],
            "SDS-2": [wl(6, "alice", "2026-09-05T10:00:00.000+0300", 7200)],
            "SDS-3": [wl(7, "stranger", "2026-09-05T10:00:00.000+0300", 7200)],
        },
    )
    ds = await load([Team("Sensors", ("alice",)), Team("DevOps", ("bob",)), Team("Empty", ())])

    assert [(w["id"], w["username"], w["date"], w["seconds"]) for w in ds["worklogs"]] == [
        ("1", "alice", "2026-09-01", 3600),
        ("6", "alice", "2026-09-05", 7200),
        ("4", "bob", "2026-09-30", 1800),
    ]
    assert ds["issues"]["SDS-1"]["sdTrack"] == "Platform Migration"
    assert ds["issues"]["SDS-1"]["url"] == f"{BASE}/browse/SDS-1"
    assert ds["issues"]["SDS-2"]["sdTrack"] is None
    assert "SDS-3" not in ds["issues"]
    assert ds["teams"][2] == {"name": "Empty", "members": []}
    assert ds["teams"][0]["members"] == [{"username": "alice", "displayName": "Alice Smith"}]
    assert ds["meta"]["sdTrackField"] == {"id": FIELD, "name": "SD Track"}


@respx.mock
async def test_unknown_users_block_the_report():
    mock_jira(users={"alice": "Alice"}, issues={}, worklogs={})
    with pytest.raises(ReportError) as exc:
        await load([Team("A", ("alice", "ghost1")), Team("B", ("ghost2",))])
    assert len(exc.value.errors) == 2


@respx.mock
async def test_failed_worklog_request_fails_whole_report():
    mock_jira(
        users={"alice": "Alice"},
        issues={"SDS-1": {"summary": "x", FIELD: None}},
        worklogs={"SDS-1": httpx.Response(500)},
    )
    from jtt.jira import JiraError

    with pytest.raises(JiraError):
        await load([Team("A", ("alice",))])


async def test_period_validation():
    with pytest.raises(ReportError):
        await load([Team("A", ("a",))], start=date(2026, 9, 2), end=date(2026, 9, 1))
    with pytest.raises(ReportError):
        await load([Team("A", ("a",))], start=date(2026, 9, 1), end=date(2026, 10, 15))


def test_jql_escapes_usernames():
    jql = build_jql(['a"b', "c\\d"], date(2026, 9, 1), date(2026, 9, 30))
    assert jql == (
        'worklogAuthor in ("a\\"b", "c\\\\d") AND worklogDate >= "2026-09-01" AND worklogDate <= "2026-09-30"'
    )


def test_track_value():
    assert track_value(None) is None
    assert track_value({"value": "X"}) == "X"
    assert track_value({"value": "  "}) is None
    assert track_value("Y") == "Y"
