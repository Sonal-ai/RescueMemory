from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import cloud
from backend.app.config import Settings
from backend.app.main import create_app


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
