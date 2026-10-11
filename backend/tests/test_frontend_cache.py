from fastapi.testclient import TestClient

from backend.app import main
from backend.app.config import Settings


def test_shell_and_worker_revalidate_without_disabling_hashed_asset_cache(tmp_path, monkeypatch):
    frontend = tmp_path / 'frontend' / 'dist'
    frontend.mkdir(parents=True)
    (frontend / 'index.html').write_text('<html>current deployment</html>')
    (frontend / 'sw.js').write_text('/* current worker */')
    (frontend / 'assets').mkdir()
    (frontend / 'assets' / 'entry-hash.js').write_text('/* current entry */')
    monkeypatch.setattr(main, '__file__', str(tmp_path / 'backend' / 'app' / 'main.py'))
    settings = Settings('cache-test', 'central', tmp_path / 'data', tmp_path / 'models', '', '')
    # Static routes need no model downloads, cloud connection, or app lifespan.
    client = TestClient(main.create_app(settings))
    for path in ['/', '/index.html', '/command', '/chat', '/sw.js']:
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-cache'
    worker = client.get('/sw.js')
    conditional = client.get('/sw.js', headers={'If-None-Match': worker.headers['etag']})
    assert conditional.status_code == 304
    assert conditional.headers['cache-control'] == 'no-cache'
    asset = client.get('/assets/entry-hash.js')
    assert asset.status_code == 200
    assert 'cache-control' not in asset.headers
