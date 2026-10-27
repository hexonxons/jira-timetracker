"""Single sign-on with an OpenID Connect provider (Keycloak), see docs/DEPLOY.md.

Authorization code flow with PKCE and a confidential client. The backend exchanges the code
with the provider's token endpoint itself, over verified TLS, so ID token claims are checked
without verifying its signature (OpenID Connect Core 3.1.3.7, item 6).

The session is a signed cookie: nothing is stored on the server, the root filesystem stays read-only.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import ssl
import time
from html import escape
from typing import Any
from urllib.parse import urlencode

import httpx
import truststore
from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from .settings import Settings

SESSION_COOKIE = "jtt_session"
LOGIN_COOKIE = "jtt_login"
LOGIN_SECONDS = 600
DISCOVERY_SECONDS = 3600
# Paths open without a session: the login flow itself, health checks, static assets and
# the sign-in status the UI asks for.
PUBLIC_PREFIXES = ("/auth/", "/assets/")
PUBLIC_PATHS = {"/healthz", "/api/me"}

# Without JTT_SESSION_SECRET, a key per process: sessions end when the service restarts.
_process_secret = secrets.token_bytes(32)
_discovery: dict[str, tuple[float, dict[str, Any]]] = {}


class AuthError(Exception):
    pass


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _key(settings: Settings) -> bytes:
    return settings.session_secret.encode() if settings.session_secret else _process_secret


def sign(settings: Settings, payload: dict[str, Any]) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    mac = hmac.new(_key(settings), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(mac)}"


def unsign(settings: Settings, token: str | None) -> dict[str, Any] | None:
    """The payload of a signed cookie, or None if it is missing, forged or expired."""
    if not token or "." not in token:
        return None
    body, mac = token.rsplit(".", 1)
    expected = _b64(hmac.new(_key(settings), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(mac, expected):
        return None
    try:
        payload = json.loads(_unb64(body))
    except ValueError:
        return None
    if not isinstance(payload, dict) or payload.get("exp", 0) < time.time():
        return None
    return payload


def jwt_claims(token: str) -> dict[str, Any]:
    """Claims of a JWT received directly from the token endpoint (no signature check, see above)."""
    try:
        claims = json.loads(_unb64(token.split(".")[1]))
    except (IndexError, ValueError) as exc:
        raise AuthError("The provider returned a malformed token.") from exc
    if not isinstance(claims, dict):
        raise AuthError("The provider returned a malformed token.")
    return claims


def http_client(settings: Settings) -> httpx.AsyncClient:
    verify: str | ssl.SSLContext = settings.ca_bundle or truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return httpx.AsyncClient(verify=verify, timeout=15)


async def discovery(settings: Settings) -> dict[str, Any]:
    issuer = settings.oidc_issuer.rstrip("/")
    cached = _discovery.get(issuer)
    if cached and cached[0] > time.time():
        return cached[1]
    url = f"{issuer}/.well-known/openid-configuration"
    try:
        async with http_client(settings) as client:
            response = await client.get(url)
            response.raise_for_status()
            doc = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise AuthError(f"Cannot read the OpenID configuration at {url}: {exc}") from exc
    if not isinstance(doc, dict) or not doc.get("authorization_endpoint") or not doc.get("token_endpoint"):
        raise AuthError(f"The OpenID configuration at {url} has no authorization or token endpoint.")
    _discovery[issuer] = (time.time() + DISCOVERY_SECONDS, doc)
    return doc


def public_url(settings: Settings, request: Request) -> str:
    return (settings.public_url or str(request.base_url)).rstrip("/")


def secure_cookies(settings: Settings, request: Request) -> bool:
    return public_url(settings, request).startswith("https://")


def safe_next(value: str | None) -> str:
    # Only local paths: an open redirect would let a link send users anywhere after sign-in.
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    return value


def user_roles(claims: dict[str, Any], client_id: str) -> set[str]:
    """Keycloak realm roles, roles of this client and groups (with and without the leading "/")."""
    roles: set[str] = set()
    realm = claims.get("realm_access")
    if isinstance(realm, dict):
        roles.update(r for r in realm.get("roles") or [] if isinstance(r, str))
    resource = claims.get("resource_access")
    if isinstance(resource, dict) and isinstance(resource.get(client_id), dict):
        roles.update(r for r in resource[client_id].get("roles") or [] if isinstance(r, str))
    for group in claims.get("groups") or []:
        if isinstance(group, str):
            roles.update({group, group.lstrip("/")})
    return roles


def current_user(settings: Settings, request: Request) -> dict[str, Any] | None:
    return unsign(settings, request.cookies.get(SESSION_COOKIE))


def unauthorized(request: Request, errors: list[str], status: int = 401) -> Response:
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": {"errors": errors, "login": "/auth/login"}}, status)
    target = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    return RedirectResponse(f"/auth/login?{urlencode({'next': target})}", 302)


def guard(settings: Settings, request: Request) -> Response | None:
    """A response refusing the request, or None when it may proceed."""
    if not settings.oidc_enabled:
        return None
    path = request.url.path
    if path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES):
        return None
    if settings.oidc_errors:
        # Misconfigured sign-in fails closed: never fall back to an open service.
        return JSONResponse({"detail": {"errors": [f"Sign-in configuration: {e}" for e in settings.oidc_errors]}}, 503)
    if current_user(settings, request) is None:
        return unauthorized(request, ["Not signed in."])
    return None


async def login(settings: Settings, request: Request, next_path: str | None) -> Response:
    doc = await discovery(settings)
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    challenge = _b64(hashlib.sha256(verifier.encode()).digest())
    query = {
        "response_type": "code",
        "client_id": settings.oidc_client_id,
        "redirect_uri": f"{public_url(settings, request)}/auth/callback",
        "scope": settings.oidc_scopes,
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    response = RedirectResponse(f"{doc['authorization_endpoint']}?{urlencode(query)}", 302)
    flow = {"state": state, "nonce": nonce, "verifier": verifier, "next": safe_next(next_path),
            "exp": int(time.time()) + LOGIN_SECONDS}
    response.set_cookie(LOGIN_COOKIE, sign(settings, flow), max_age=LOGIN_SECONDS, path="/auth/",
                        httponly=True, samesite="lax", secure=secure_cookies(settings, request))
    return response


async def callback(settings: Settings, request: Request) -> Response:
    params = request.query_params
    if params.get("error"):
        raise AuthError(f"The provider refused sign-in: {params.get('error_description') or params['error']}")
    flow = unsign(settings, request.cookies.get(LOGIN_COOKIE))
    if flow is None or not params.get("state") or not hmac.compare_digest(flow["state"], params["state"]):
        raise AuthError("The sign-in attempt expired or did not start here. Try again.")
    if not params.get("code"):
        raise AuthError("The provider returned no authorization code.")

    doc = await discovery(settings)
    try:
        async with http_client(settings) as client:
            response = await client.post(
                doc["token_endpoint"],
                data={
                    "grant_type": "authorization_code",
                    "code": params["code"],
                    "redirect_uri": f"{public_url(settings, request)}/auth/callback",
                    "code_verifier": flow["verifier"],
                },
                auth=(settings.oidc_client_id, settings.oidc_client_secret),
            )
            tokens = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise AuthError(f"Cannot exchange the authorization code: {exc}") from exc
    if response.status_code != 200 or not isinstance(tokens, dict) or not tokens.get("id_token"):
        detail = tokens.get("error_description") or tokens.get("error") if isinstance(tokens, dict) else None
        raise AuthError(f"The token endpoint refused the code: {detail or f'HTTP {response.status_code}'}")

    claims = jwt_claims(tokens["id_token"])
    audience = claims.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    if claims.get("iss") != doc.get("issuer", settings.oidc_issuer.rstrip("/")):
        raise AuthError("The ID token was issued by an unexpected issuer.")
    if settings.oidc_client_id not in audiences:
        raise AuthError("The ID token was issued for another client.")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < time.time() - 60:
        raise AuthError("The ID token has expired.")
    if claims.get("nonce") != flow["nonce"]:
        raise AuthError("The ID token does not belong to this sign-in attempt.")

    if settings.oidc_allowed_roles:
        # Keycloak puts roles into the access token by default, groups wherever a mapper adds them.
        merged = dict(claims)
        if isinstance(tokens.get("access_token"), str) and tokens["access_token"].count(".") == 2:
            access = jwt_claims(tokens["access_token"])
            for name in ("realm_access", "resource_access", "groups"):
                merged.setdefault(name, access.get(name))
        if not user_roles(merged, settings.oidc_client_id) & set(settings.oidc_allowed_roles):
            raise AuthError("Your account has no access to this service. Ask an administrator for a role.")

    session = {
        "sub": claims.get("sub"),
        "username": claims.get("preferred_username") or claims.get("email") or claims.get("sub"),
        "name": claims.get("name") or claims.get("preferred_username") or claims.get("email"),
        "email": claims.get("email"),
        "exp": int(time.time() + settings.session_hours * 3600),
    }
    response = RedirectResponse(flow["next"], 302)
    response.set_cookie(SESSION_COOKIE, sign(settings, session), max_age=int(settings.session_hours * 3600),
                        path="/", httponly=True, samesite="lax", secure=secure_cookies(settings, request))
    response.delete_cookie(LOGIN_COOKIE, path="/auth/")
    return response


async def logout(settings: Settings, request: Request) -> Response:
    target = f"{public_url(settings, request)}/"
    try:
        end_session = (await discovery(settings)).get("end_session_endpoint")
    except AuthError:
        end_session = None
    if end_session:
        # Ends the provider's session too; Keycloak 18+ accepts client_id instead of id_token_hint.
        query = {"client_id": settings.oidc_client_id, "post_logout_redirect_uri": target}
        target = f"{end_session}?{urlencode(query)}"
    response = RedirectResponse(target, 302)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


def error_page(message: str, status: int = 403) -> Response:
    html = (
        "<!doctype html><meta charset=utf-8><title>Sign-in failed</title>"
        "<body style='font-family:system-ui,sans-serif;max-width:40em;margin:4em auto;padding:0 16px'>"
        f"<h1>Sign-in failed</h1><p>{escape(message)}</p><p><a href='/auth/login'>Try again</a></p>"
    )
    return Response(html, status, media_type="text/html")

