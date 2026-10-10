from types import SimpleNamespace

from backend.app.schemas import NearbyRequest, SurvivalRadarRequest
from backend.app.service import RescueService


def service(events=(), references=()):
    instance = object.__new__(RescueService)
    instance.purge_expired = lambda: None
    instance.memory = SimpleNamespace(nearby=lambda *_: events,
                                      all=lambda scope: references if scope == 'reference' else events)
    return instance


def test_empty_memory_never_generates_demo_reports_or_radar_markers():
    instance = service()
    for lat, lon in [(28.7041, 77.1025), (0, 0), (40, -70)]:
        assert instance.nearby(NearbyRequest(location={'lat': lat, 'lon': lon})) == []
        result = instance.survival_radar(SurvivalRadarRequest(lat=lat, lon=lon))
        assert result['radar_items'] == []
        assert result['total_found'] == 0
        assert result['summary']['nearest_shelter'] is None
        assert result['summary']['nearest_casualty'] is None


def test_actual_record_keeps_its_location_and_identity_without_extra_points():
    event = {'id': 'actual', 'kind': 'sos', 'text': 'Help requested', 'location': {'lat': 0, 'lon': 0.001},
             'observed_at': '2026-10-09T00:00:00+00:00', 'visibility': 'public', 'severity': 'red', 'verified': False}
    instance = service([event])
    result = instance.survival_radar(SurvivalRadarRequest(lat=0, lon=0))
    assert [item['id'] for item in result['radar_items']] == ['actual']
    assert result['radar_items'][0]['location'] == event['location']
    assert result['radar_items'][0]['signal_source'] == 'qdrant_memory'
    assert result['radar_items'][0]['verified'] is False
    assert instance.nearby(NearbyRequest(location={'lat': 0, 'lon': 0}))[0]['id'] == 'actual'


def test_reference_hazard_uses_stored_description():
    checkpoint = {'id': 'actual-gate', 'kind': 'checkpoint', 'live_destination': True, 'lat': 0, 'lon': 0.001,
                  'status': 'danger_warning', 'hazard': 'Operator recorded closure'}
    result = service(references=[checkpoint]).survival_radar(SurvivalRadarRequest(lat=0, lon=0))
    assert result['radar_items'][0]['text'] == checkpoint['hazard']


def test_reference_examples_are_not_live_destinations():
    example = {'id': 'guide-example', 'kind': 'checkpoint', 'lat': 0, 'lon': 0.001}
    assert service(references=[example]).survival_radar(SurvivalRadarRequest(lat=0, lon=0))['radar_items'] == []


def test_coordinate_derived_peer_signal_is_explicitly_an_estimate():
    peer = {'node_id': 'actual-peer', 'lat': 0, 'lon': 0.001, 'role': 'survivor'}
    result = service().survival_radar(SurvivalRadarRequest(lat=0, lon=0), peers=[peer])
    item = result['radar_items'][0]
    assert item['signal_estimated'] is True
    assert item['signal_estimate_source'] == 'coordinate_path_loss'
