import httpx
import pytest
import respx

from jtt.jira import JiraClient, JiraError


def client(sleeps):
    async def sleep(s):
        sleeps.append(s)

    return JiraClient("https://jira.example", "tok", sleep=sleep)


@respx.mock
async def test_retries_429_with_retry_after_then_succeeds():
    route = respx.get("https://jira.example/rest/api/2/myself").mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "3"}),
            httpx.Response(503),
            httpx.Response(200, json={"name": "me"}),
        ]
    )
    sleeps = []
    async with client(sleeps) as c:
        assert await c.myself() == {"name": "me"}
    assert route.call_count == 3
    assert sleeps == [3.0, 2.0]
    assert route.calls[0].request.headers["Authorization"] == "Bearer tok"


@respx.mock
async def test_gives_up_after_max_attempts():
    respx.get("https://jira.example/rest/api/2/myself").mock(return_value=httpx.Response(429))
    sleeps = []
    async with client(sleeps) as c:
        with pytest.raises(JiraError):
            await c.myself()
    assert len(sleeps) == 5


@respx.mock
async def test_401_is_not_retried():
    respx.get("https://jira.example/rest/api/2/myself").mock(return_value=httpx.Response(401))
    async with client([]) as c:
        with pytest.raises(JiraError, match="Personal Access Token"):
            await c.myself()


@respx.mock
async def test_missing_user_returns_none():
    respx.get("https://jira.example/rest/api/2/user").mock(return_value=httpx.Response(404))
    async with client([]) as c:
        assert await c.user("ghost") is None
