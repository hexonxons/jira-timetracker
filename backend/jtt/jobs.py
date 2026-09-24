"""In-memory registry of report jobs, shared by all users of an instance.

* At most `max_parallel` reports load from Jira at once; the rest wait in a queue.
* Identical requests (same period, team config and Jira settings) share one running job,
  and optionally a finished one for `cache_seconds`.
* Finished jobs are dropped after `ttl_seconds`, and the oldest ones beyond `max_jobs`.

State lives in the process, so a service instance must run as a single process.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

Progress = Callable[[str, int, int], None]
Runner = Callable[[Progress], Awaitable[dict[str, Any]]]
ErrorMapper = Callable[[BaseException], list[str]]


@dataclass
class Job:
    id: str
    key: str
    status: str = "queued"  # queued | running | done | failed
    progress: dict[str, Any] | None = None
    errors: list[str] = field(default_factory=list)
    dataset: dict[str, Any] | None = None
    finished_at: float | None = None
    task: asyncio.Task | None = None

    def view(self) -> dict[str, Any]:
        # "queued" is reported as running so clients only need to know running/done/failed.
        status = "running" if self.status == "queued" else self.status
        return {"id": self.id, "status": status, "progress": self.progress, "errors": self.errors, "dataset": self.dataset}


class JobRegistry:
    def __init__(
        self,
        *,
        max_parallel: int = 3,
        cache_seconds: float = 0,
        ttl_seconds: float = 1800,
        max_jobs: int = 50,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.max_parallel = max_parallel
        self.cache_seconds = cache_seconds
        self.ttl_seconds = ttl_seconds
        self.max_jobs = max_jobs
        self._clock = clock
        self._slots: asyncio.Semaphore | None = None
        self._jobs: dict[str, Job] = {}
        self._by_key: dict[str, str] = {}

    def get(self, job_id: str) -> Job | None:
        self._evict()
        return self._jobs.get(job_id)

    def submit(self, key: str, runner: Runner, map_error: ErrorMapper) -> Job:
        self._evict()
        existing = self._jobs.get(self._by_key.get(key, ""))
        if existing and (
            existing.status in ("queued", "running")
            or (existing.status == "done" and self._age(existing) < self.cache_seconds)
        ):
            return existing

        job = Job(id=uuid.uuid4().hex, key=key)
        self._jobs[job.id] = job
        self._by_key[key] = job.id
        job.task = asyncio.create_task(self._run(job, runner, map_error))
        return job

    async def _run(self, job: Job, runner: Runner, map_error: ErrorMapper) -> None:
        if self._slots is None:  # created lazily, inside the running event loop
            self._slots = asyncio.Semaphore(self.max_parallel)

        def progress(stage: str, done: int, total: int) -> None:
            job.progress = {"stage": stage, "done": done, "total": total}

        if self._slots.locked():
            progress("Waiting for other reports to finish", 0, 0)
        try:
            async with self._slots:
                job.status = "running"
                job.dataset = await runner(progress)
            job.status = "done"
        except Exception as exc:  # a report fails as a whole, never partially
            job.status, job.errors = "failed", map_error(exc)
        finally:
            job.finished_at = self._clock()
            job.task = None
            if job.status == "failed" and self._by_key.get(job.key) == job.id:
                del self._by_key[job.key]  # never reuse a failed load

    def _age(self, job: Job) -> float:
        return float("inf") if job.finished_at is None else self._clock() - job.finished_at

    def _evict(self) -> None:
        finished = sorted((j for j in self._jobs.values() if j.finished_at is not None), key=lambda j: j.finished_at)
        excess = len(self._jobs) - self.max_jobs
        for job in finished:
            if self._age(job) > self.ttl_seconds or excess > 0:
                excess -= 1
                del self._jobs[job.id]
                if self._by_key.get(job.key) == job.id:
                    del self._by_key[job.key]
