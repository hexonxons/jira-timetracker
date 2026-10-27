import base64
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

ISSUER = "https://sso.test/realms/corp"
PUBLIC = "https://jtt.test"


def jwt(claims):
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{part({'alg': 'RS256'})}.{part(claims)}.sig"


class Keycloak:
    """A fake provider: discovery, and a token endpoint that hands out tokens for the last nonce."""

    def __init__(self):
        self.nonce = None
        self.roles = ["jtt-user"]
        self.claims = {}
        self.token_requests = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/realms/corp/.well-known/openid-configuration":
            return httpx.Response(200, json={
                "issuer": ISSUER,
                "authorization_endpoint": f"{ISSUER}/protocol/openid-connect/auth",
                "token_endpoint": f"{ISSUER}/protocol/openid-connect/token",
                "end_session_endpoint": f"{ISSUER}/protocol/openid-connect/logout",
            })
        if request.url.path == "/realms/corp/protocol/openid-connect/token":
            form = parse_qs(request.content.decode())
            self.token_requests.append((request.headers.get("authorization"), form))
            if form["code"] != ["good-code"]:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Code not valid"})
            id_token = {"iss": ISSUER, "aud": "jtt", "sub": "u-1", "exp": time.time() + 300, "nonce": self.nonce,
                        "preferred_username": "alice", "name": "Alice Doe", "email": "alice@corp.test", **self.claims}
            access = {"realm_access": {"roles": self.roles}, "resource_access": {}}
            return httpx.Response(200, json={"id_token": jwt(id_token), "access_token": jwt(access)})
        return httpx.Response(404)


@pytest.fixture
def keycloak(monkeypatch, tmp_path):
    import jtt.auth

    provider = Keycloak()
    jtt.auth._discovery.clear()
    monkeypatch.setattr(jtt.auth, "http_client", lambda s: httpx.AsyncClient(transport=httpx.MockTransport(provider)))
    secret = tmp_path / "client-secret"
    secret.write_text("client-secret\n")
    monkeypatch.setenv("JTT_JIRA_URL", "https://jira.test")
    monkeypatch.setenv("JTT_JIRA_PAT", "pat")
    monkeypatch.setenv("JTT_OIDC_ISSUER", ISSUER)
    monkeypatch.setenv("JTT_OIDC_CLIENT_ID", "jtt")
    monkeypatch.setenv("JTT_OIDC_CLIENT_SECRET_FILE", str(secret))
    monkeypatch.setenv("JTT_OIDC_ALLOWED_ROLES", "jtt-user, jtt-admin")
    monkeypatch.setenv("JTT_PUBLIC_URL", PUBLIC)
    monkeypatch.setenv("JTT_SESSION_SECRET", "x" * 40)
    return provider


@pytest.fixture
def client(keycloak):
    from jtt.app import app

    with TestClient(app, base_url=PUBLIC, follow_redirects=False) as c:
        yield c


def start_login(client, keycloak, next_path="/#/summary"):
    r = client.get("/auth/login", params={"next": next_path})
    assert r.status_code == 302
    location = urlparse(r.headers["location"])
    query = {k: v[0] for k, v in parse_qs(location.query).items()}
    assert f"{location.scheme}://{location.netloc}{location.path}" == f"{ISSUER}/protocol/openid-connect/auth"
    assert query["client_id"] == "jtt" and query["redirect_uri"] == f"{PUBLIC}/auth/callback"
    assert query["code_challenge_method"] == "S256" and "openid" in query["scope"].split()
    keycloak.nonce = query["nonce"]
    return query["state"]


def sign_in(client, keycloak):
    state = start_login(client, keycloak)
    return client.get("/auth/callback", params={"state": state, "code": "good-code"})


def test_api_and_pages_require_sign_in(client):
    r = client.get("/api/settings")
    assert r.status_code == 401
    assert r.json()["detail"]["login"] == "/auth/login"
    r = client.get("/reports?x=1")
    assert r.status_code == 302 and r.headers["location"] == "/auth/login?next=%2Freports%3Fx%3D1"
    assert client.get("/healthz").status_code == 200


def test_sign_in_round_trip(client, keycloak):
    r = sign_in(client, keycloak)
    assert r.status_code == 302 and r.headers["location"] == "/#/summary"
    cookie = r.headers["set-cookie"]
    assert "jtt_session=" in cookie and "HttpOnly" in cookie and "Secure" in cookie and "samesite=lax" in cookie.lower()
    auth_header, form = keycloak.token_requests[0]
    assert auth_header.startswith("Basic ") and form["code_verifier"][0]
    assert client.get("/api/me").json() == {
        "authEnabled": True,
        "user": {"username": "alice", "name": "Alice Doe", "email": "alice@corp.test"},
    }
    s = client.get("/api/settings").json()
    assert s["authEnabled"] is True and "client-secret" not in json.dumps(s)


def test_state_must_match(client, keycloak):
    start_login(client, keycloak)
    r = client.get("/auth/callback", params={"state": "forged", "code": "good-code"})
    assert r.status_code == 403
    assert client.get("/api/me").json()["user"] is None
    assert keycloak.token_requests == []


def test_nonce_issuer_and_audience_are_checked(client, keycloak):
    for claims in ({"nonce": "other"}, {"iss": "https://evil.test"}, {"aud": "another-client"}, {"exp": 1}):
        keycloak.claims = claims
        r = sign_in(client, keycloak)
        assert r.status_code == 403, claims
        assert client.get("/api/settings").status_code == 401


def test_users_without_an_allowed_role_are_refused(client, keycloak):
    keycloak.roles = ["someone-else"]
    r = sign_in(client, keycloak)
    assert r.status_code == 403 and "no access" in r.text


def test_groups_claim_counts_as_role(client, keycloak):
    keycloak.roles = []
    keycloak.claims = {"groups": ["/jtt-admin"]}
    assert sign_in(client, keycloak).status_code == 302


def test_provider_errors_are_shown(client, keycloak):
    state = start_login(client, keycloak)
    r = client.get("/auth/callback", params={"state": state, "code": "bad"})
    assert r.status_code == 403 and "Code not valid" in r.text


def test_forged_session_cookie_is_ignored(client, keycloak):
    sign_in(client, keycloak)
    value = client.cookies.get("jtt_session")
    client.cookies.set("jtt_session", value[:-2] + "AA")
    assert client.get("/api/settings").status_code == 401


def test_next_is_local_only(client, keycloak):
    state = start_login(client, keycloak, next_path="//evil.test/x")
    r = client.get("/auth/callback", params={"state": state, "code": "good-code"})
    assert r.headers["location"] == "/"


def test_logout_ends_both_sessions(client, keycloak):
    sign_in(client, keycloak)
    r = client.get("/auth/logout")
    assert r.status_code == 302
    location = urlparse(r.headers["location"])
    assert location.path == "/realms/corp/protocol/openid-connect/logout"
    assert parse_qs(location.query)["post_logout_redirect_uri"] == [f"{PUBLIC}/"]
    assert client.get("/api/settings").status_code == 401


def test_incomplete_config_fails_closed(monkeypatch, keycloak):
    monkeypatch.delenv("JTT_OIDC_CLIENT_SECRET_FILE")
    from jtt.app import app

    with TestClient(app, base_url=PUBLIC) as c:
        r = c.get("/api/settings")
        assert r.status_code == 503
        assert "JTT_OIDC_CLIENT_SECRET" in r.json()["detail"]["errors"][0]
        assert "JTT_OIDC_CLIENT_SECRET" in c.get("/healthz").json()["configErrors"][0]


def test_without_oidc_the_service_stays_open(monkeypatch):
    for name in ("JTT_OIDC_ISSUER", "JTT_OIDC_CLIENT_ID"):
        monkeypatch.delenv(name, raising=False)
    from jtt.app import app

    with TestClient(app) as c:
        assert c.get("/api/me").json() == {"authEnabled": False, "user": None}
        assert c.get("/auth/login").status_code == 404
