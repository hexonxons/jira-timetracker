"""Run the app: `python -m jtt` (or `jtt`).

Locally it listens on 127.0.0.1 and opens the browser; as a service run it with
`--host 0.0.0.0 --no-browser` (the Docker image does).
"""

from __future__ import annotations

import argparse
import os
import threading
import webbrowser

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Jira time reports")
    parser.add_argument("--host", default=os.environ.get("JTT_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8765")))
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    args = parser.parse_args()

    url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host}:{args.port}/"
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    print(f"Jira Timetracker: {url}", flush=True)
    # A single process on purpose: report jobs are kept in memory (see jobs.py).
    uvicorn.run("jtt.app:app", host=args.host, port=args.port, log_level="info", proxy_headers=True)


if __name__ == "__main__":
    main()
