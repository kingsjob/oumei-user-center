export const $ = (id) => document.getElementById(id);

export async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  if (res.status === 401) data.code = data.code || 'UNAUTHORIZED';
  return data;
}

export function bytes(n) {
  n = Number(n || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const digits = i >= 3 ? 2 : i === 2 ? 1 : 0;
  return `${n.toFixed(digits)} ${units[i]}`;
}

export function formatDate(ts, withTime = false) {
  if (!ts) return '不限期';
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(d);
}

export function money(cents) {
  const n = Number(cents || 0) / 100;
  return `¥${n.toFixed(2)}`;
}
