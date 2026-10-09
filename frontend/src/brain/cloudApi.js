// Cloud inspection and mirroring always use the configured backend. A failed
// request must not switch to a different Qdrant cluster or repeat a write.
export const isCloudApi = path => path.startsWith('/api/sync/cloud-') || path === '/api/sync/mirror';
export const cloudTimeoutMs = path => path.endsWith('mirror') ? 120000 : 60000;

export function offlineCloudResult(path) {
  const reason = 'Offline mode is enabled or this device has no internet connection. Enable Online and refresh to connect through the server.';
  if (path === '/api/sync/cloud-status') return {
    connected: false, configured: null, counts_verified: false, shards: {}, total_points: null,
    source: 'backend', local_fallback: true, reason, checked_at: new Date().toISOString(),
  };
  throw new Error(reason);
}

export async function requestCloudApi(request, url, path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cloudTimeoutMs(path));
  try {
    const response = await request(url, { ...options, signal: controller.signal });
    if (response.headers.get('X-Rescue-Offline') === 'true') {
      throw new Error('The server could not be reached. Check your internet connection and refresh.');
    }
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      throw new Error(`The server returned an unexpected response (HTTP ${response.status}). Check the backend URL.`);
    }
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(typeof data.detail === 'string' ? data.detail : `Cloud request failed (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(path.endsWith('mirror')
      ? 'Cloud sync is taking longer than two minutes. It may still be running on the server; refresh the cloud inventory before retrying.'
      : 'The server took too long to check Qdrant Cloud. Refresh to try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
