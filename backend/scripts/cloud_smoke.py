"""Verify the real Cloud upload/download loop with one synthetic public event.

Requires QDRANT_URL and QDRANT_API_KEY in the environment. The test event is
removed from Cloud at the end; collections remain ready for the demo.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from qdrant_client import QdrantClient, models

from backend.app.cloud import EVENT_COLLECTIONS, GUIDES_COLLECTION, _point_id, mirror_to_qdrant_server
from backend.app.config import Settings
from backend.app.schemas import GuidePublishRequest, ReportRequest
from backend.app.service import RescueService


def main() -> None:
    load_dotenv(override=False)
    url = os.environ.get("QDRANT_URL", "")
    key = os.environ.get("QDRANT_API_KEY", "")
    if not url.startswith("https://") or not key:
        raise SystemExit("Set QDRANT_URL and QDRANT_API_KEY first")
    model_cache = Path(os.environ.get("MODEL_CACHE", "data/model_cache"))
    guide_key = os.environ.get("GUIDE_TRUST_KEY", "smoke-only-guide-key")
    with tempfile.TemporaryDirectory(prefix="rescue-cloud-smoke-") as directory:
        root = Path(directory)
        settings = lambda name: Settings(name, "central", root / name, model_cache,
                                         "smoke-mesh-key", "smoke-responder-key",
                                         qdrant_url=url, qdrant_api_key=key,
                                         guide_trust_key=guide_key)
        event_id = None
        guide_id = "rescue-smoke-guide-test-only"
        try:
            first = RescueService(settings("smoke-origin"))
            try:
                event = first.report(ReportRequest(
                    kind="hazard", text="RescueMemory synthetic Cloud sync test",
                    reporter_id="integration-test", entity_id="smoke-test-only",
                    status="test", visibility="public",
                ))["event"]
                event_id = event["id"]
                first.publish_guide(GuidePublishRequest(
                    id=guide_id, title="Synthetic guide transport test",
                    keywords="test transport", summary="This is a synthetic integration check, not emergency guidance.",
                    steps=["Confirm the test record can move between nodes."], warnings=[],
                    source="https://qdrant.tech/documentation/edge/", reviewer="Integration test",
                ))
                uploaded = mirror_to_qdrant_server(first)
                if uploaded["events_uploaded"]["public"] != 1 or uploaded["guides_uploaded"] != 1:
                    raise RuntimeError(f"expected event and guide Cloud uploads, got {uploaded}")
            finally:
                first.close()

            second = RescueService(settings("smoke-receiver"))
            try:
                pulled = mirror_to_qdrant_server(second)
                if (pulled["events_downloaded"]["public"] != 1 or
                        pulled["guides_downloaded"] != 1 or
                        not second.memory.get("events", event_id) or
                        not second.memory.get("reference", guide_id)):
                    raise RuntimeError(f"Cloud pull did not restore test event and guide: {pulled}")
            finally:
                second.close()
            print("PASS: public event and authenticated guide uploaded to Cloud and restored to fresh Edge")
        finally:
            if event_id:
                client = QdrantClient(url=url, api_key=key, timeout=30)
                try:
                    client.delete(EVENT_COLLECTIONS["public"],
                                  points_selector=models.PointIdsList(points=[_point_id(event_id)]),
                                  wait=True)
                    if client.collection_exists(GUIDES_COLLECTION):
                        client.delete(GUIDES_COLLECTION,
                                      points_selector=models.PointIdsList(points=[_point_id(guide_id)]),
                                      wait=True)
                    print("Synthetic test event and guide removed from Cloud")
                finally:
                    client.close()


if __name__ == "__main__":
    main()
