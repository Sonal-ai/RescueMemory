from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


class MemoryStub:
    def __init__(self, *args):
        self.records = {}

    def get(self, scope, key):
        return self.records.get((scope, key))

    def upsert(self, scope, key, value, *args):
        self.records[(scope, key)] = value

    def all(self, scope):
        return [value for (collection, _), value in self.records.items() if collection == scope]

    def seed(self, items, **kwargs):
        for item in items:
            self.upsert('reference', item['id'], item)

    def close(self):
        pass

    def delete(self, scope, keys):
        for key in keys:
            self.records.pop((scope, key), None)


@pytest.mark.parametrize('role', ['survivor', 'volunteer', 'central'])
def test_every_prototype_node_can_register_sign_and_read_dashboard_without_keys(tmp_path, monkeypatch, role):
    monkeypatch.setattr('backend.app.service.Memory', MemoryStub)
    settings = Settings('demo-phone', role, tmp_path, Path('data/model_cache'), '', '',
                        node_admin_key='unconfigured-secret', prototype_access=True)
    with TestClient(create_app(settings)) as client:
        assert client.get('/health').json()['prototype_access'] is True
        report = {'kind': 'checkpoint', 'text': 'Test shelter at entered coordinates',
                  'reporter_id': 'operator', 'location': {'lat': 0, 'lon': 0}, 'entity_id': 'shelter-test',
                  'status': 'operational', 'severity': 'green', 'visibility': 'public', 'verified': True}
        response = client.post('/api/reports', json=report)
        assert response.status_code == 200, response.text
        event = response.json()['event']
        assert event['verified'] and event['source_role'] == 'central' and event['authority_tag']
        assert event['location'] == {'lat': 0, 'lon': 0}
        assert client.post('/api/sync/import?scope=public', json={'events': [event]}).status_code == 200
        guide = {'id': 'prototype-guide', 'title': 'Prototype guide', 'keywords': 'test guide',
                 'summary': 'Operator supplied guidance for the demo.', 'steps': ['Read the operator instructions.'],
                 'warnings': [], 'source': 'Demo operator', 'reviewer': 'Demo team'}
        published = client.post('/api/guides/publish', json=guide)
        assert published.status_code == 200, published.text
        assert published.json()['auth_tag'] and published.json()['version'] == 1
        assert client.post('/api/guides/publish', json=guide).json()['version'] == 2
        assert client.get('/api/memory?scope=responders').status_code == 200
        assert client.get('/api/sync/export?scope=responders').status_code == 200
        assert client.get('/api/memory?scope=public').json()['items'][0]['id'] == event['id']
        assert client.post('/api/reports', json={**report, 'idempotency_key': 'offline-point'}).status_code == 200
        queued = next(item for item in client.get('/api/memory?scope=public').json()['items'] if item['id'] == 'offline-point')
        client.app.state.rescue.memory.delete('events', [queued['id']])
        assert client.post('/api/sync/import?scope=public', json={'events': [queued]}).status_code == 200
        monkeypatch.setattr(client.app.state.rescue, 'reset_all_data', lambda **kwargs: {'reset': True})
        assert client.post('/api/admin/reset-all').json() == {'reset': True}


def test_restricted_mode_keeps_existing_permissions_and_input_validation(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.app.service.Memory', MemoryStub)
    settings = Settings('restricted', 'survivor', tmp_path, Path('data/model_cache'), 'mesh', 'responder',
                        node_admin_key='admin-secret', prototype_access=False)
    with TestClient(create_app(settings)) as client:
        assert client.get('/api/memory?scope=responders').status_code == 403
        assert client.post('/api/reports', json={'kind': 'checkpoint', 'text': 'Test shelter',
                           'reporter_id': 'operator', 'verified': True}).status_code == 403
        assert client.post('/api/reports', json={'kind': 'checkpoint', 'text': 'Test shelter',
                           'reporter_id': 'operator', 'location': {'lat': 100, 'lon': 0}}).status_code == 422
