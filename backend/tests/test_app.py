import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

BASE = "https://jira.test"
TEAMS = {"teams": [{"name": "Sensors", "users": ["alice"]}]}


@pytest.fixture
def local(monkeypatch, tmp_path):
    monkeypatch.delenv("JTT_JIRA_URL", raising=False)
    monkeypatch.setenv("JTT_HOME", str(tmp_path))
    from jtt.app import app

    with TestClient(app) as client:
        yield client


@pytest.fixture
def service(monkeypatch, tmp_path):
    teams_file = tmp_path / "teams.json"
    teams_file.write_text(json.dumps(TEAMS))
    pat_file = tmp_path / "pat"
    pat_file.write_text("secret-pat\n")
    monkeypatch.setenv("JTT_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("JTT_JIRA_URL", BASE)
    monkeypatch.setenv("JTT_JIRA_PAT_FILE", str(pat_file))
    monkeypatch.setenv("JTT_TEAMS_FILE", str(teams_file))
    monkeypatch.setenv("JTT_HOURS_PER_PERSON_DAY", "7.5")
    from jtt.app import app

    with TestClient(app) as client:
        yield client


def test_local_mode_settings_roundtrip(local):
    r = local.put("/api/settings", json={"jiraUrl": BASE, "pat": "tok"})
    assert r.status_code == 200
    assert r.json()["managed"] is False and r.json()["hasPat"] is True
    assert "tok" not in r.text
    assert local.put("/api/teams", json=TEAMS).status_code == 200
    assert local.get("/api/settings").json()["teamsConfig"] == TEAMS


def test_service_mode_reads_environment_and_hides_token(service):
    s = service.get("/api/settings").json()
    assert s["managed"] is True and s["configErrors"] == []
    assert s["jiraUrl"] == BASE and s["hasPat"] is True and s["hoursPerPersonDay"] == 7.5
    assert s["teamsConfig"] == TEAMS
    assert "secret-pat" not in json.dumps(s)
    assert service.get("/healthz").json()["status"] == "ok"


def test_service_mode_refuses_changes(service):
    assert service.put("/api/settings", json={"jiraUrl": "https://evil.example"}).status_code == 403
    assert service.put("/api/teams", json=TEAMS).status_code == 403
    assert service.get("/api/settings").json()["jiraUrl"] == BASE


def test_service_mode_reports_config_errors(monkeypatch, tmp_path):
    monkeypatch.setenv("JTT_JIRA_URL", "jira.test")
    monkeypatch.delenv("JTT_JIRA_PAT", raising=False)
    monkeypatch.delenv("JTT_JIRA_PAT_FILE", raising=False)
    monkeypatch.setenv("JTT_TEAMS_FILE", str(tmp_path / "missing.json"))
    from jtt.app import app

    with TestClient(app) as client:
        errors = client.get("/api/settings").json()["configErrors"]
        assert len(errors) == 3
        r = client.post("/api/reports", json={"start": "2026-09-01", "end": "2026-09-30"})
        assert r.status_code == 400


def test_validate_teams_does_not_store(service):
    bad = {"teams": [{"name": "A", "users": ["x"]}, {"name": "B", "users": ["x"]}]}
    assert service.post("/api/teams/validate", json=bad).status_code == 400
    assert service.post("/api/teams/validate", json=TEAMS).json() == {"teams": [{"name": "Sensors", "users": ["alice"]}]}


def fake_jira(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/rest/api/2/myself":
        return httpx.Response(200, json={"name": "bot"})
    if path == "/rest/api/2/field":
        return httpx.Response(200, json=[{"id": "customfield_1", "name": "SD Track"}])
    if path == "/rest/api/2/user":
        name = request.url.params["username"]
        return httpx.Response(200, json={"name": name, "displayName": name.title()})
    if path == "/rest/api/2/search":
        issue = {"key": "SDS-1", "fields": {"summary": "x", "customfield_1": None}}
        return httpx.Response(200, json={"total": 1, "issues": [issue]})
    if path == "/rest/api/2/issue/SDS-1/worklog":
        started = "2026-09-02T10:00:00.000+0000"
        logs = [
            {"id": 1, "author": {"name": "alice"}, "started": started, "timeSpentSeconds": 3600},
            {"id": 2, "author": {"name": "bob"}, "started": started, "timeSpentSeconds": 3600},
        ]
        return httpx.Response(200, json={"total": 2, "worklogs": logs})
    return httpx.Response(404)


@pytest.fixture
def jira(monkeypatch):
    import jtt.app
    from jtt.jira import JiraClient

    seen = []

    def make_client(settings):
        seen.append(settings)
        return JiraClient(settings.base_url, settings.pat, transport=httpx.MockTransport(fake_jira))

    monkeypatch.setattr(jtt.app, "make_client", make_client)
    return seen


def generate(client, body):
    r = client.post("/api/reports", json=body)
    assert r.status_code == 200, r.text
    for _ in range(200):
        job = client.get(f"/api/reports/{r.json()['id']}").json()
        if job["status"] != "running":
            return job
        time.sleep(0.01)
    raise AssertionError("report did not finish")


def test_report_uses_instance_teams_or_the_ones_sent(service, jira):
    job = generate(service, {"start": "2026-09-01", "end": "2026-09-30"})
    assert job["status"] == "done", job["errors"]
    assert jira[0].pat == "secret-pat"
    assert [w["username"] for w in job["dataset"]["worklogs"]] == ["alice"]
    assert job["dataset"]["meta"]["hoursPerPersonDay"] == 7.5

    own = {"teams": [{"name": "Mine", "users": ["alice", "bob"]}]}
    job = generate(service, {"start": "2026-09-01", "end": "2026-09-30", "teams": own})
    assert [t["name"] for t in job["dataset"]["teams"]] == ["Mine"]
    assert len(job["dataset"]["worklogs"]) == 2


def test_unknown_report_is_404(service):
    assert service.get("/api/reports/nope").status_code == 404
