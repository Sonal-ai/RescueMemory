from types import SimpleNamespace
from datetime import datetime, timezone
from unittest.mock import Mock

import numpy as np
from qdrant_client import QdrantClient, models

from backend.app import cloud
from backend.app.schemas import ReportRequest, SurvivalRadarRequest
from backend.app.service import RescueService


def node(name):
    records = {}
    instance = RescueService.__new__(RescueService)
    instance.settings = SimpleNamespace(node_id=name, role='central', prototype_access=True,
        guide_trust_key=None, qdrant_url='https://test.invalid', qdrant_api_key='test')
    instance.memory = SimpleNamespace(get=lambda table, key: records.get(key),
        all=lambda table: list(records.values()) if table == 'events' else [],
        upsert=lambda table, key, record, text: records.__setitem__(key, record),
        nearby=lambda *_: [r for r in records.values() if r.get('location')],
        embedder=SimpleNamespace(embed=lambda texts, batch_size: [np.zeros(384) for _ in texts]))
    instance.purge_expired = lambda: None
    instance.record_transfer = Mock()
    instance._trigger_cloud_mirror = Mock()
    return instance


def test_direct_phone_sos_becomes_one_cloud_point_and_one_report_on_every_online_node(monkeypatch):
    client = QdrantClient(':memory:')
    close = client.close
    client.close = lambda: None
    monkeypatch.setattr(cloud, 'QdrantClient', lambda **_: client)
    try:
        cloud._ensure_collection(client, cloud.EVENT_COLLECTIONS['responders'], events=True)
        source_id = 'original-phone-sos'
        raw = dict(id=source_id, source_report_id=source_id, entity_id=source_id,
            origin_device='phone-a', reporter_id='phone-a', kind='sos', visibility='responders',
            text='Help requested at the gate', status='needs_help', severity='red',
            location={'lat': 0, 'lon': 0.001}, observed_at=datetime.now(timezone.utc).isoformat())
        point_id = cloud._event_point_id(raw)
        client.upsert(cloud.EVENT_COLLECTIONS['responders'], points=[models.PointStruct(
            id=point_id, vector={'dense': [0.0] * 384}, payload=raw)], wait=True)
        nodes = [node(name) for name in ['online-c', 'online-a', 'online-b']]
        for instance in nodes:
            cloud.mirror_to_qdrant_server(instance)
            assert len(instance.memory.all('events')) == 1
            assert instance.memory.get('events', source_id)['origin_device'] == 'phone-a'
            retry = instance.report(ReportRequest.model_validate({**raw, 'idempotency_key': source_id}), mirror=False)
            assert retry['duplicate'] is True
        for instance in nodes:
            cloud.mirror_to_qdrant_server(instance)
        assert client.count(cloud.EVENT_COLLECTIONS['responders'], exact=True).count == 1
        payload = client.retrieve(cloud.EVENT_COLLECTIONS['responders'], [point_id])[0].payload
        assert payload['content_hash']
        assert payload['id'] == payload['source_report_id'] == source_id
        # A prior UUID5 point or alternate server ID is the same original report.
        legacy = {**payload, 'id': 'old-server-specific-id'}
        legacy_point_id = cloud._point_id(source_id)
        client.upsert(cloud.EVENT_COLLECTIONS['responders'], points=[models.PointStruct(
            id=legacy_point_id, vector={'dense': [0.0] * 384}, payload=legacy)], wait=True)
        migrated = cloud.mirror_to_qdrant_server(nodes[0])
        assert migrated['events_migrated']['responders'] == 1
        assert client.count(cloud.EVENT_COLLECTIONS['responders'], exact=True).count == 1
        assert len(nodes[0].memory.all('events')) == 1
    finally:
        close()


def test_shelter_updates_use_latest_entity_state_and_never_become_water_or_presence_markers():
    instance = node('online')
    base = {'entity_id': 'operator-shelter', 'kind': 'checkpoint',
        'text': 'Entered school (Community Shelter). Facilities: Water, Shelter.',
        'reporter_id': 'operator', 'location': {'lat': 0, 'lon': 0.001},
        'visibility': 'public', 'status': 'operational', 'severity': 'green'}
    instance.report(ReportRequest(**base, idempotency_key='first', observed_at='2026-10-10T01:00:00Z'), mirror=False)
    instance.report(ReportRequest(**{**base, 'text': 'Updated school (Community Shelter). Facilities: Water.'},
        idempotency_key='updated', observed_at='2026-10-10T02:00:00Z'), mirror=False)
    instance.memory.upsert('events', 'presence', {'id': 'presence', 'kind': 'presence',
        'location': {'lat': 0, 'lon': 0}, 'observed_at': '2026-10-10T03:00:00Z'}, '')
    radar = instance.survival_radar(SurvivalRadarRequest(lat=0, lon=0))
    assert len(radar['radar_items']) == 1
    assert radar['radar_items'][0]['name'] == 'Updated school'
    assert radar['radar_items'][0]['category'] == 'shelter'
    assert radar['radar_items'][0]['entity_id'] == 'operator-shelter'
    assert radar['radar_items'][0]['walk_time_min'] is None
    instance.report(ReportRequest(**{**base, 'status': 'closed'}, idempotency_key='closure',
        observed_at='2026-10-10T04:00:00Z'), mirror=False)
    assert instance.survival_radar(SurvivalRadarRequest(lat=0, lon=0))['radar_items'] == []
