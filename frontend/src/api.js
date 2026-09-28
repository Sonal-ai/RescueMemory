const PREFIX = 'rescue.';

export function setting(name) {
  return sessionStorage.getItem(PREFIX + name) || '';
}

export function saveSetting(name, value) {
  sessionStorage.setItem(PREFIX + name, value.trim());
}

export async function api(path, options = {}) {
  const { method = 'GET', body, admin = false, responder = false, group = false } = options;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin && setting('adminKey')) headers['X-Node-Admin-Key'] = setting('adminKey');
  if (responder && setting('responderKey')) headers['X-Responder-Key'] = setting('responderKey');
  if (group && setting('groupToken')) headers['X-Group-Token'] = setting('groupToken');
  const response = await fetch(path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return data;
}

export function formatTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
