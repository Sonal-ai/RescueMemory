from types import SimpleNamespace
from unittest.mock import Mock
from datetime import datetime, timezone

import numpy as np

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import cloud
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.service import RescueService


def test_cloud_upload_bounds_embedding_memory_and_preserves_all_records():
    client = Mock()
    batches = []

    def embed(texts, *, batch_size):
        assert batch_size == 16
        assert len(texts) <= 16
        batches.append(texts)
        return (np.zeros(384) for _ in texts)

    service = SimpleNamespace(memory=SimpleNamespace(embedder=SimpleNamespace(embed=embed)))
    records = [{"id": f"event-{i}", "text": f"report-{i}"} for i in range(35)]
    cloud._upsert_new(client, "reports", records, service, lambda record: record["text"])
    assert [len(batch) for batch in batches] == [16, 16, 3]
    uploaded = [point.payload for call in client.upsert.call_args_list for point in call.kwargs["points"]]
    assert uploaded == records
    assert all(call.kwargs["wait"] is True for call in client.upsert.call_args_list)


def test_shared_phone_report_keeps_one_server_event_and_cloud_point():
    stored = {}
    memory = SimpleNamespace(
        get=lambda collection, key: stored.get(key),
        upsert=lambda collection, key, value, text: stored.__setitem__(key, value),
    )
    service = RescueService.__new__(RescueService)
    service.memory = memory
    service.settings = SimpleNamespace(node_id="hq", role="central", prototype_access=False,
                                       guide_trust_key=None)
    source_id = "offline_evt_123_phone_a"
    body = {"kind": "sos", "text": "Cannot walk; need help at the shelter gate",
            "reporter_id": "phone-a", "visibility": "public", "severity": "red",
            "observed_at": datetime.now(timezone.utc).isoformat()}

    first = service._event(body.copy(), source_id)
    relay = service._event(body.copy(), source_id)

    assert first["duplicate"] is False
    assert relay["duplicate"] is True
    assert len(stored) == 1
    assert first["event"]["id"] == first["event"]["source_report_id"] == source_id
    assert cloud._event_point_id(first["event"]) == cloud._event_point_id(
        {"id": "different-server-id", "source_report_id": source_id})


def test_cloud_mirror_replaces_direct_phone_point_without_creating_another(monkeypatch):
    source_id = "offline_evt_one_sos"
    record = {"id": source_id, "source_report_id": source_id, "kind": "sos",
              "text": "Cannot walk near north gate", "visibility": "public",
              "content_hash": "verified-hash"}
    client = Mock()
    client.collection_exists.return_value = True
    client.scroll.side_effect = lambda name, **kwargs: (
        ([SimpleNamespace(id=cloud._event_point_id(record), payload={
            "id": source_id, "kind": "sos", "text": record["text"], "visibility": "public"})], None)
        if name == cloud.EVENT_COLLECTIONS["public"] else ([], None))
    client.get_collections.return_value.collections = []
    monkeypatch.setattr(cloud, "QdrantClient", lambda **kwargs: client)
    monkeypatch.setattr(cloud, "_cloud_inventory", lambda client, names: {})
    memory = SimpleNamespace(all=lambda table: [record] if table == "events" else [],
                             embedder=SimpleNamespace(embed=lambda texts, batch_size: [np.zeros(384)]))
    service = SimpleNamespace(settings=SimpleNamespace(qdrant_url="https://test.invalid",
        qdrant_api_key="test", guide_trust_key=None, node_id="hq"), memory=memory,
        purge_expired=Mock(), record_transfer=Mock(), import_events=Mock())

    result = cloud.mirror_to_qdrant_server(service)

    assert result["events_uploaded"]["public"] == 1
    points = client.upsert.call_args.kwargs["points"]
    assert len(points) == 1
    assert points[0].id == cloud._event_point_id(record)
    assert points[0].payload["content_hash"] == "verified-hash"


def test_inventory_is_exact_app_only_and_preserves_zero(monkeypatch):
    names = [*cloud.EVENT_COLLECTIONS.values(), cloud.GUIDES_COLLECTION]
    client = Mock()
    client.get_collections.return_value.collections = [SimpleNamespace(name=n) for n in [*names, 'unrelated']]
    client.count.side_effect = lambda name, exact: SimpleNamespace(count=names.index(name))
    monkeypatch.setattr(cloud, 'QdrantClient', lambda **kwargs: client)
    service = SimpleNamespace(settings=SimpleNamespace(qdrant_url='https://test.invalid', qdrant_api_key='test'))
    result = cloud.check_cloud_connection(service)
    assert result['total_points'] == 6
    assert result['shards'][names[0]] == 0
    assert result['counts_verified'] is True
    assert client.count.call_count == 4
    assert all(call.kwargs['exact'] is True for call in client.count.call_args_list)
    client.close.assert_called_once()


def test_failed_count_is_unknown_instead_of_zero():
    client = Mock()
    client.count.side_effect = RuntimeError('cloud count unavailable')
    result = cloud._cloud_inventory(client, [cloud.GUIDES_COLLECTION])
    assert result['shards'][cloud.GUIDES_COLLECTION] is None
    assert result['total_points'] is None
    assert result['counts_verified'] is False
    assert result['count_errors'][cloud.GUIDES_COLLECTION] == 'cloud count unavailable'


def test_cloud_records_read_actual_payloads_and_preserve_cursor(monkeypatch):
    client = Mock()
    client.collection_exists.return_value = True
    client.scroll.return_value = ([SimpleNamespace(id='point', payload={'text': 'Actual cloud payload'})], 0)
    monkeypatch.setattr(cloud, 'QdrantClient', lambda **kwargs: client)
    service = SimpleNamespace(settings=SimpleNamespace(qdrant_url='https://test.invalid', qdrant_api_key='test'))
    result = cloud.read_cloud_records(service, cloud.GUIDES_COLLECTION, 0, 2)
    assert result['items'] == [{'point_id': 'point', 'payload': {'text': 'Actual cloud payload'}}]
    assert result['next_offset'] == 0
    client.scroll.assert_called_once_with(cloud.GUIDES_COLLECTION, offset=0, limit=2, with_payload=True, with_vectors=False)
    client.close.assert_called_once()
    with pytest.raises(HTTPException) as error:
        cloud.read_cloud_records(service, 'other-collection')
    assert error.value.status_code == 422


def test_cloud_record_endpoint_requires_admin_and_rejects_invalid_collection(monkeypatch, tmp_path):
    # No service/model initialization is needed to verify the authorization boundary.
    app = create_app(Settings('hq', 'central', tmp_path, tmp_path, 'mesh', 'responder', node_admin_key='admin'))
    app.state.rescue = SimpleNamespace(settings=SimpleNamespace(qdrant_url=None))
    client = TestClient(app)
    path = '/api/sync/cloud-records?collection=rescue_public_events'
    assert client.get(path).status_code == 403
    assert client.get(path, headers={'X-Node-Admin-Key': 'wrong'}).status_code == 403
    assert client.get('/api/sync/cloud-records?collection=other', headers={'X-Node-Admin-Key': 'admin'}).status_code == 422
    assert client.get(path, headers={'X-Node-Admin-Key': 'admin'}).status_code == 503
