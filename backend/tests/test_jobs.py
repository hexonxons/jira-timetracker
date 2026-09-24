import asyncio

from jtt.jobs import JobRegistry


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def errors(exc):
    return [str(exc)]


async def wait(job):
    while job.task is not None:
        await asyncio.sleep(0)


async def test_identical_running_requests_share_a_job():
    gate = asyncio.Event()
    calls = 0

    async def runner(progress):
        nonlocal calls
        calls += 1
        await gate.wait()
        return {"ok": True}

    reg = JobRegistry()
    a = reg.submit("k", runner, errors)
    b = reg.submit("k", runner, errors)
    assert a is b
    gate.set()
    await wait(a)
    assert calls == 1 and a.view()["status"] == "done" and a.dataset == {"ok": True}


async def test_finished_job_is_reused_only_within_cache_window():
    clock = Clock()

    async def runner(progress):
        return {}

    reg = JobRegistry(cache_seconds=60, clock=clock)
    a = reg.submit("k", runner, errors)
    await wait(a)
    clock.now = 30
    assert reg.submit("k", runner, errors) is a
    clock.now = 61
    b = reg.submit("k", runner, errors)
    assert b is not a
    await wait(b)


async def test_no_cache_by_default():
    async def runner(progress):
        return {}

    reg = JobRegistry()
    a = reg.submit("k", runner, errors)
    await wait(a)
    assert reg.submit("k", runner, errors) is not a


async def test_failed_job_is_not_reused_and_reports_errors():
    async def runner(progress):
        raise RuntimeError("boom")

    reg = JobRegistry(cache_seconds=60)
    a = reg.submit("k", runner, errors)
    await wait(a)
    assert a.view() == {"id": a.id, "status": "failed", "progress": None, "errors": ["boom"], "dataset": None}
    assert reg.submit("k", runner, errors) is not a


async def test_limits_parallel_loads_and_queues_the_rest():
    gate = asyncio.Event()
    active = peak = 0

    async def runner(progress):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await gate.wait()
        active -= 1
        return {}

    reg = JobRegistry(max_parallel=2)
    submitted = [reg.submit(f"k{i}", runner, errors) for i in range(5)]
    for _ in range(10):
        await asyncio.sleep(0)
    assert peak == 2
    assert sum(j.status == "queued" for j in submitted) == 3
    assert submitted[4].view()["status"] == "running"  # queued looks like running to clients
    gate.set()
    for j in submitted:
        await wait(j)
    assert peak == 2 and all(j.status == "done" for j in submitted)


async def test_expired_jobs_are_dropped():
    clock = Clock()

    async def runner(progress):
        return {}

    reg = JobRegistry(ttl_seconds=100, max_jobs=2, clock=clock)
    first = reg.submit("a", runner, errors)
    await wait(first)
    clock.now = 101
    assert reg.get(first.id) is None

    jobs = [reg.submit(k, runner, errors) for k in "bcd"]
    for j in jobs:
        await wait(j)
    reg.get("x")
    assert reg.get(jobs[0].id) is None and reg.get(jobs[2].id) is not None
