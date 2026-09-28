"""Run three real HTTP nodes and prove multi-hop plus global convergence."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx


ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    ports = {name: free_port() for name in ("a", "v", "hq")}
    urls = {name: f"http://127.0.0.1:{port}" for name, port in ports.items()}
    processes = []
    with tempfile.TemporaryDirectory() as directory:
        try:
            for name, role in (("a", "survivor"), ("v", "volunteer"), ("hq", "central")):
                env = os.environ.copy()
                env.update({
                    "NODE_ID": name, "NODE_ROLE": role,
                    "DATA_DIR": str(Path(directory) / name),
                    "MODEL_CACHE": str(ROOT / "data" / "model_cache"),
                    "MESH_SHARED_KEY": "demo-mesh-shared-key",
                    "RESPONDER_SHARED_KEY": "demo-responder-shared-key",
                    "NODE_ADMIN_KEY": "demo-node-admin-key",
                    "GUIDE_TRUST_KEY": "demo-guide-trust-key",
                    "CENTRAL_URL": urls["hq"] if name == "v" else "",
                })
                processes.append(subprocess.Popen(
                    [sys.executable, "-m", "uvicorn", "backend.app.main:app",
                     "--host", "127.0.0.1", "--port", str(ports[name])],
                    cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                ))
            with httpx.Client(timeout=30) as client:
                for name, url in urls.items():
                    for _ in range(100):
                        try:
                            if client.get(url + "/health").status_code == 200:
                                break
                        except httpx.HTTPError:
                            pass
                        time.sleep(0.1)
                    else:
                        raise RuntimeError(f"{name} did not start")

                group = client.post(urls["a"] + "/api/groups", json={"name": "Camp Alpha"}).json()
                client.post(urls["v"] + "/api/groups/join", json=group).raise_for_status()
                hazard = client.post(urls["a"] + "/api/reports", json={
                    "kind": "hazard", "text": "Bridge 17 flooded and blocked",
                    "reporter_id": "survivor-1", "entity_id": "bridge-17", "status": "blocked",
                    "location": {"lat": 28.7041, "lon": 77.1025},
                }).json()["event"]
                client.post(urls["a"] + "/api/reports", headers={"X-Group-Token": group["token"]}, json={
                    "kind": "resource", "text": "Water at north gate",
                    "reporter_id": "survivor-1", "visibility": "group", "group_id": group["group_id"],
                    "location": {"lat": 28.7041, "lon": 77.1025},
                }).raise_for_status()
                sos = client.post(urls["a"] + "/api/reports", json={
                    "kind": "incident", "text": "Injured person cannot walk",
                    "reporter_id": "survivor-1", "visibility": "responders",
                    "location": {"lat": 28.7041, "lon": 77.1025},
                }).json()["event"]

                admin = {"X-Node-Admin-Key": "demo-node-admin-key"}
                for scope in (None, group["group_id"]):
                    client.post(urls["a"] + "/api/sync/peer", headers=admin,
                                json={"peer_url": urls["v"], "group_id": scope}).raise_for_status()
                client.post(urls["a"] + "/api/sync/sos-uplink",
                            headers=admin, json={"peer_url": urls["v"]}).raise_for_status()
                global_result = client.post(urls["v"] + "/api/sync/global", headers=admin).json()
                if "results" not in global_result:
                    raise RuntimeError(global_result)
                hq_public = client.post(urls["hq"] + "/api/map/nearby",
                                        json={"location": {"lat": 28.7041, "lon": 77.1025}}).json()["items"]
                assert hazard["id"] in {item["id"] for item in hq_public}
                hq_group = client.post(urls["hq"] + "/api/map/nearby",
                                       headers={"X-Group-Token": group["token"]},
                                       json={"location": {"lat": 28.7041, "lon": 77.1025},
                                             "group_id": group["group_id"]}).json()["items"]
                assert any(item["kind"] == "resource" for item in hq_group)
                hq_private = client.post(urls["hq"] + "/api/map/nearby",
                                         headers={"X-Responder-Key": "demo-responder-shared-key"},
                                         json={"location": {"lat": 28.7041, "lon": 77.1025},
                                               "include_responders": True}).json()["items"]
                assert sos["id"] in {item["id"] for item in hq_private}
                journey = client.get(urls["hq"] + f"/api/provenance/{hazard['id']}").json()
                assert {"a", "v", "hq"}.issubset(set(journey["known_nodes"]))

                command_update = client.post(urls["hq"] + "/api/reports", headers=admin, json={
                    "kind": "checkpoint", "text": "Bridge 17 closure verified by command",
                    "reporter_id": "command", "entity_id": "bridge-17", "status": "blocked",
                    "verified": True, "location": {"lat": 28.7041, "lon": 77.1025},
                })
                command_update.raise_for_status()
                guide = client.post(urls["hq"] + "/api/guides/publish", headers=admin, json={
                    "id": "demo-north-shelter", "title": "North shelter bulletin",
                    "keywords": "north shelter update", "summary": "The north shelter is the command-approved demo meeting point.",
                    "steps": ["Follow the marked path to the north shelter."],
                    "warnings": ["Avoid the flooded bridge."],
                    "source": "https://example.org/demo-command-bulletin",
                    "reviewer": "Demo command operator",
                })
                guide.raise_for_status()
                client.post(urls["v"] + "/api/sync/global", headers=admin).raise_for_status()
                client.post(urls["a"] + "/api/sync/peer", headers=admin,
                            json={"peer_url": urls["v"]}).raise_for_status()
                assert any(card["id"] == "demo-north-shelter" for card in
                           client.get(urls["a"] + "/api/guides").json()["guides"])
                assert client.get(urls["a"] + "/api/entities/bridge-17").json()["effective"]["verified"]
                again = client.post(urls["v"] + "/api/sync/global", headers=admin).json()
                assert all(item["imported"] == 0 and item["exported"] == 0
                           for item in again["results"])
                print("PASS: survivor -> volunteer -> central -> volunteer -> survivor; scoped sync, guide update, provenance, and deduplication")
                print("Central status:", client.get(urls["hq"] + "/api/sync/status").json()["by_visibility"])
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                try:
                    process.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()


if __name__ == "__main__":
    main()
