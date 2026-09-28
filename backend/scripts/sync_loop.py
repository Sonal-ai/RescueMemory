"""Retry uplink/cloud sync at a bounded interval when connectivity returns."""

from __future__ import annotations

import argparse
import os
import time

import httpx
from dotenv import load_dotenv


def main():
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.getenv("LOCAL_API_URL", "http://127.0.0.1:8001"))
    parser.add_argument("--interval", type=int, default=30)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.interval < 5:
        parser.error("interval must be at least 5 seconds")
    admin_key = os.getenv("NODE_ADMIN_KEY")
    if not admin_key:
        parser.error("NODE_ADMIN_KEY is required")
    headers = {"X-Node-Admin-Key": admin_key}
    while True:
        try:
            with httpx.Client(timeout=40) as client:
                role = client.get(args.url.rstrip("/") + "/health").json()["role"]
                endpoint = "/api/sync/cloud-mirror" if role == "central" else "/api/sync/global"
                response = client.post(args.url.rstrip("/") + endpoint, headers=headers)
                response.raise_for_status()
                print(response.json(), flush=True)
        except (httpx.HTTPError, ValueError) as exc:
            print(f"sync deferred: {exc}", flush=True)
        if args.once:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
