import { $, api, bytes, formatDate, money } from '/common.js';

$('logoutBtn').addEventListener('click', async () => {
  await api('/api/portal/logout', { method: 'POST' }).catch(() => {});
  window.location.replace('/login');
});
$('refreshBtn').addEventListener('click', () => loadDashboard(true));
$('reloadNotices').addEventListener('click', loadNotices);
$('copyBtn').addEventListener('click', copySubscription);

bootstrap();

async function bootstrap() {
  await Promise.all([loadDashboard(), loadNotices()]);
}

async function loadDashboard(showState = false) {
  if (showState) $('refreshBtn').textContent = '刷新中…';
  try {
    const result = await api('/api/portal/dashboard');
    if (!result.ok) {
      if (result.code === 'UNAUTHORIZED') return window.location.replace('/login');
      throw new Error(result.message || '读取失败');
    }
    renderDashboard(result.data);
  } catch (err) {
    if (err?.message) console.error(err.message);
  } finally {
    $('refreshBtn').textContent = '刷新';
  }
}

function renderDashboard(data) {
  const account = data.account || {};
  const sub = data.subscription || {};
  const used = Number(sub.used || 0);
  const total = Number(sub.total || 0);
  const pct = total > 0 ? Math.min(100, Math.max(0, used / total * 100)) : 0;

  $('emailBadge').textContent = account.email || '用户';
  $('planName').textContent = sub.planName || '暂无套餐';
  $('expireAt').textContent = formatDate(sub.expiredAt);
  $('resetDay').textContent = sub.resetDay ? `每月 ${sub.resetDay} 日` : '按套餐规则';
  $('usedTraffic').textContent = bytes(used);
  $('totalTraffic').textContent = bytes(total);
  $('remainingTraffic').textContent = bytes(sub.remaining || 0);
  $('uploadTraffic').textContent = bytes(sub.upload || 0);
  $('downloadTraffic').textContent = bytes(sub.download || 0);
  $('trafficPercent').textContent = `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
  $('trafficBar').style.width = `${pct}%`;
  $('subscriptionUrl').value = sub.url || '';

  $('accountEmail').textContent = account.email || '—';
  $('createdAt').textContent = formatDate(account.createdAt, true);
  $('lastLoginAt').textContent = formatDate(account.lastLoginAt, true);
  $('balance').textContent = money(account.balance || 0);
}

async function loadNotices() {
  const target = $('noticeList');
  target.innerHTML = '<p class="muted">正在读取…</p>';
  const result = await api('/api/portal/notices').catch(() => null);
  if (result?.code === 'UNAUTHORIZED') return window.location.replace('/login');
  if (!result?.ok) {
    target.innerHTML = '<p class="muted">暂时无法读取公告。</p>';
    return;
  }
  if (!result.data?.length) {
    target.innerHTML = '<p class="muted">暂无公告。</p>';
    return;
  }
  target.replaceChildren(...result.data.map((notice) => {
    const item = document.createElement('article');
    item.className = 'notice-item';
    const title = document.createElement('h3');
    title.textContent = notice.title || '公告';
    const meta = document.createElement('time');
    meta.textContent = formatDate(notice.createdAt, true);
    const content = document.createElement('p');
    content.textContent = notice.content || '';
    item.append(title, meta, content);
    return item;
  }));
}

async function copySubscription() {
  const value = $('subscriptionUrl').value;
  if (!value) return;
  const state = $('copyState');
  try {
    await navigator.clipboard.writeText(value);
    state.textContent = '已复制，可以粘贴到客户端。';
  } catch {
    $('subscriptionUrl').focus();
    $('subscriptionUrl').select();
    document.execCommand('copy');
    state.textContent = '已复制。';
  }
  setTimeout(() => { state.textContent = ''; }, 2500);
}
