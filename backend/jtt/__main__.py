"""Run the service: `python -m jtt` (the Docker image's command)."""

from __future__ import annotations

import argparse
import os

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Jira time reports service")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    args = parser.parse_args()
    # A single process on purpose: report jobs are kept in memory (see jobs.py).
    uvicorn.run("jtt.app:app", host=args.host, port=args.port, log_level="info", proxy_headers=True)


if __name__ == "__main__":
    main()
