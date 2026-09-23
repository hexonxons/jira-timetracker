"""Minimal async client for the Jira Data Center REST API v2 with retry/backoff."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from typing import Any

import httpx

RETRY_STATUSES = {429, 502, 503, 504}
MAX_ATTEMPTS = 6
MAX_BACKOFF_SECONDS = 60.0

Sleep = Callable[[float], Awaitable[None]]


class JiraError(Exception):
    """A Jira request failed for good (after retries, or with a non-retryable status)."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class JiraNotFound(JiraError):
    pass


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())


def _describe(response: httpx.Response) -> str:
    try:
        body = response.json()
        messages = body.get("errorMessages") or []
        messages += [f"{k}: {v}" for k, v in (body.get("errors") or {}).items()]
        if messages:
            return "; ".join(messages)
    except Exception:
        pass
    text = response.text.strip()
    return text[:300] if text else response.reason_phrase


class JiraClient:
    def __init__(
        self,
        base_url: str,
        pat: str,
        *,
        verify: bool | str = True,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Sleep = asyncio.sleep,
        timeout: float = 60.0,
    ):
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {pat}", "Accept": "application/json"},
            verify=verify,
            transport=transport,
            timeout=timeout,
        )
        self._sleep = sleep

    async def __aenter__(self) -> "JiraClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        backoff = 1.0
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = await self._client.request(method, path, **kwargs)
            except httpx.TransportError as exc:
                if attempt == MAX_ATTEMPTS:
                    raise JiraError(f"{method} {path}: cannot reach Jira ({exc!r})") from exc
                await self._sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
                continue

            if response.status_code in RETRY_STATUSES and attempt < MAX_ATTEMPTS:
                wait = _retry_after_seconds(response)
                await self._sleep(min(wait, MAX_BACKOFF_SECONDS) if wait is not None else backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
                continue

            if response.status_code == 401:
                raise JiraError("Jira rejected the Personal Access Token (401 Unauthorized).", 401)
            if response.status_code == 404:
                raise JiraNotFound(f"{method} {path}: not found", 404)
            if response.status_code >= 400:
                raise JiraError(
                    f"{method} {path}: HTTP {response.status_code}: {_describe(response)}",
                    response.status_code,
                )
            return response.json()
        raise AssertionError("unreachable")

    # --- endpoints -----------------------------------------------------------------

    async def myself(self) -> dict[str, Any]:
        return await self.request("GET", "/rest/api/2/myself")

    async def fields(self) -> list[dict[str, Any]]:
        return await self.request("GET", "/rest/api/2/field")

    async def user(self, username: str) -> dict[str, Any] | None:
        try:
            return await self.request("GET", "/rest/api/2/user", params={"username": username})
        except JiraNotFound:
            return None

    async def search(self, jql: str, fields: list[str], start_at: int, max_results: int) -> dict[str, Any]:
        return await self.request(
            "POST",
            "/rest/api/2/search",
            json={"jql": jql, "fields": fields, "startAt": start_at, "maxResults": max_results},
        )

    async def issue_worklogs(self, issue_key: str, start_at: int, max_results: int) -> dict[str, Any]:
        return await self.request(
            "GET",
            f"/rest/api/2/issue/{issue_key}/worklog",
            params={"startAt": start_at, "maxResults": max_results},
        )
