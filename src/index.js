const API_PREFIX = '/api/portal';
const te = new TextEncoder();
const td = new TextDecoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && ['/', '/login', '/register', '/dashboard'].includes(url.pathname)) {
        return pageRoute(request, env, url.pathname);
      }
      if (url.pathname === `${API_PREFIX}/config` && request.method === 'GET') {
        return portalConfig(env);
      }
      if (url.pathname === `${API_PREFIX}/login` && request.method === 'POST') {
        return login(request, env);
      }
      if (url.pathname === `${API_PREFIX}/register` && request.method === 'POST') {
        return register(request, env);
      }
      if (url.pathname === `${API_PREFIX}/send-email-code` && request.method === 'POST') {
        return sendEmailCode(request, env);
      }
      if (url.pathname === `${API_PREFIX}/logout` && request.method === 'POST') {
        return logout();
      }
      if (url.pathname === `${API_PREFIX}/dashboard` && request.method === 'GET') {
        return dashboard(request, env);
      }
      if (url.pathname === `${API_PREFIX}/notices` && request.method === 'GET') {
        return notices(request, env);
      }
      if (url.pathname === `${API_PREFIX}/plans` && request.method === 'GET') {
        return simpleUserList(request, env, '/api/v1/user/plan/fetch', '套餐读取失败');
      }
      if (url.pathname === `${API_PREFIX}/orders` && request.method === 'GET') {
        return simpleUserList(request, env, '/api/v1/user/order/fetch', '订单读取失败');
      }
      if (url.pathname === `${API_PREFIX}/invite` && request.method === 'GET') {
        return simpleUserObject(request, env, '/api/v1/user/invite/fetch', '邀请信息读取失败');
      }
      if (url.pathname === `${API_PREFIX}/tickets` && request.method === 'GET') {
        return simpleUserList(request, env, '/api/v1/user/ticket/fetch', '工单读取失败');
      }
      if (url.pathname === `${API_PREFIX}/reset-subscription` && request.method === 'POST') {
        return resetSubscription(request, env);
      }
      if (url.pathname === `${API_PREFIX}/password` && request.method === 'POST') {
        return changePassword(request, env);
      }
      if (url.pathname.startsWith('/s/') && request.method === 'GET') {
        return subscriptionProxy(request, env);
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('portal error', err);
      return json({ ok: false, message: '服务暂时不可用' }, 500);
    }
  }
};


async function pageRoute(request, env, pathname) {
  const auth = await getSessionAuth(request, env);
  const loggedIn = Boolean(auth);

  if (pathname === '/') return redirect(loggedIn ? '/dashboard' : '/login');
  if (pathname === '/dashboard' && !loggedIn) return redirect('/login');
  if ((pathname === '/login' || pathname === '/register') && loggedIn) return redirect('/dashboard');

  const file = pathname === '/dashboard'
    ? '/dashboard.html'
    : pathname === '/register'
      ? '/register.html'
      : '/login.html';
  const assetUrl = new URL(request.url);
  assetUrl.pathname = file;
  assetUrl.search = '';
  return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
}

async function portalConfig(env) {
  const upstream = await xboardFetch(env, '/api/v1/guest/comm/config');
  const payload = await safeJson(upstream);
  if (!upstream.ok) return json({ ok: false, message: '注册配置读取失败' }, upstream.status);

  const cfg = payload?.data || {};
  const type = ['turnstile', 'recaptcha-v3', 'recaptcha'].includes(String(cfg.captcha_type))
    ? String(cfg.captcha_type)
    : 'recaptcha';
  let siteKey = null;
  if (type === 'turnstile') siteKey = cleanText(cfg.turnstile_site_key);
  if (type === 'recaptcha-v3') siteKey = cleanText(cfg.recaptcha_v3_site_key);
  if (type === 'recaptcha') siteKey = cleanText(cfg.recaptcha_site_key);

  const whitelist = Array.isArray(cfg.email_whitelist_suffix)
    ? cfg.email_whitelist_suffix.map(cleanText).filter(Boolean).slice(0, 100)
    : [];

  return json({
    ok: true,
    data: {
      emailVerify: Boolean(Number(cfg.is_email_verify || 0)),
      inviteRequired: Boolean(Number(cfg.is_invite_force || 0)),
      emailWhitelist: whitelist,
      captcha: {
        enabled: Boolean(Number(cfg.is_captcha ?? cfg.is_recaptcha ?? 0)),
        type,
        siteKey
      }
    }
  });
}

async function register(request, env) {
  const body = await readJson(request);
  const email = String(body?.email || '').trim();
  const password = String(body?.password || '');
  const confirmPassword = String(body?.confirmPassword || '');
  const inviteCode = String(body?.inviteCode || '').trim();
  const emailCode = String(body?.emailCode || '').trim();

  if (!email || email.length > 200 || password.length < 8 || password.length > 300) {
    return json({ ok: false, message: '请输入正确的邮箱，密码至少 8 位' }, 400);
  }
  if (password !== confirmPassword) {
    return json({ ok: false, message: '两次输入的密码不一致' }, 400);
  }

  const upstreamBody = { email, password };
  if (inviteCode) upstreamBody.invite_code = inviteCode.slice(0, 200);
  if (emailCode) upstreamBody.email_code = emailCode.slice(0, 20);
  Object.assign(upstreamBody, captchaPayload(body?.captcha));

  const upstream = await xboardFetch(env, '/api/v1/passport/auth/register', {
    method: 'POST',
    body: JSON.stringify(upstreamBody)
  });
  const payload = await safeJson(upstream);
  const authData = payload?.data?.auth_data;
  if (!upstream.ok || !authData || typeof authData !== 'string') {
    return json({ ok: false, message: publicMessage(payload, '注册失败，请检查填写内容') }, upstream.ok ? 400 : upstream.status);
  }

  return createSessionResponse(authData, env);
}

async function sendEmailCode(request, env) {
  const body = await readJson(request);
  const email = String(body?.email || '').trim();
  if (!email || email.length > 200) return json({ ok: false, message: '请输入正确的邮箱' }, 400);

  const upstreamBody = { email, ...captchaPayload(body?.captcha) };
  const upstream = await xboardFetch(env, '/api/v1/passport/comm/sendEmailVerify', {
    method: 'POST',
    body: JSON.stringify(upstreamBody)
  });
  const payload = await safeJson(upstream);
  if (!upstream.ok) return json({ ok: false, message: publicMessage(payload, '验证码发送失败') }, upstream.status);
  return json({ ok: true, message: '验证码已发送' });
}

function captchaPayload(captcha) {
  const type = String(captcha?.type || '');
  const token = String(captcha?.token || '').trim();
  if (!token || token.length > 5000) return {};
  if (type === 'turnstile') return { turnstile_token: token };
  if (type === 'recaptcha-v3') return { recaptcha_v3_token: token };
  if (type === 'recaptcha') return { recaptcha_data: token };
  return {};
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

async function login(request, env) {
  const body = await readJson(request);
  const email = String(body?.email || '').trim();
  const password = String(body?.password || '');

  if (!email || !password || email.length > 200 || password.length > 300) {
    return json({ ok: false, message: '请输入正确的邮箱和密码' }, 400);
  }

  const upstream = await xboardFetch(env, '/api/v1/passport/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  const payload = await safeJson(upstream);
  const authData = payload?.data?.auth_data;
  if (!upstream.ok || !authData || typeof authData !== 'string') {
    return json({ ok: false, message: publicMessage(payload, '登录失败，请检查账号或密码') }, upstream.ok ? 401 : upstream.status);
  }

  return createSessionResponse(authData, env);
}

async function createSessionResponse(authData, env) {
  const session = await seal({ auth: authData, iat: Date.now() }, env.SESSION_SECRET, 'session');
  const maxAge = Math.max(1, Number(env.SESSION_DAYS || 7)) * 86400;

  const headers = new Headers();
  headers.set('Set-Cookie', cookie('ob_session', session, maxAge));
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function logout() {
  const headers = new Headers();
  headers.set('Set-Cookie', 'ob_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

async function dashboard(request, env) {
  const auth = await getSessionAuth(request, env);
  if (!auth) return unauthorized();

  const [infoRes, subRes, plansRes] = await Promise.all([
    xboardFetch(env, '/api/v1/user/info', {}, auth),
    xboardFetch(env, '/api/v1/user/getSubscribe', {}, auth),
    xboardFetch(env, '/api/v1/user/plan/fetch', {}, auth)
  ]);

  if (infoRes.status === 401 || infoRes.status === 403 || subRes.status === 401 || subRes.status === 403) {
    return unauthorized(true);
  }

  const [infoPayload, subPayload, plansPayload] = await Promise.all([
    safeJson(infoRes), safeJson(subRes), safeJson(plansRes)
  ]);

  if (!infoRes.ok || !subRes.ok) {
    return json({ ok: false, message: '读取账号信息失败' }, 502);
  }

  const info = infoPayload?.data || {};
  const sub = subPayload?.data || {};
  const plans = Array.isArray(plansPayload?.data) ? plansPayload.data : [];
  const plan = plans.find(p => String(p?.id) === String(sub?.plan_id ?? info?.plan_id)) || null;

  let subscriptionUrl = null;
  if (sub?.token) {
    const opaque = await seal({ token: String(sub.token) }, env.LINK_SECRET, 'subscription');
    subscriptionUrl = `${new URL(request.url).origin}/s/${opaque}`;
  }

  const used = num(sub?.u) + num(sub?.d);
  const total = num(sub?.transfer_enable ?? info?.transfer_enable);

  return json({
    ok: true,
    data: {
      account: {
        email: cleanText(info?.email ?? sub?.email),
        createdAt: unix(info?.created_at),
        lastLoginAt: unix(info?.last_login_at),
        balance: num(info?.balance),
        banned: Boolean(Number(info?.banned || 0))
      },
      subscription: {
        planName: cleanText(plan?.name) || (sub?.plan_id ? `套餐 ${sub.plan_id}` : '暂无套餐'),
        planId: sub?.plan_id ?? info?.plan_id ?? null,
        expiredAt: unix(sub?.expired_at ?? info?.expired_at),
        resetDay: sub?.reset_day ?? null,
        used,
        upload: num(sub?.u),
        download: num(sub?.d),
        total,
        remaining: Math.max(0, total - used),
        url: subscriptionUrl
      }
    }
  });
}

async function notices(request, env) {
  const auth = await getSessionAuth(request, env);
  if (!auth) return unauthorized();

  const upstream = await xboardFetch(env, '/api/v1/user/notice/fetch', {}, auth);
  const payload = await safeJson(upstream);
  if (!upstream.ok) return json({ ok: false, message: '公告读取失败' }, upstream.status);

  const list = Array.isArray(payload?.data) ? payload.data : [];
  return json({
    ok: true,
    data: list.slice(0, 20).map(n => ({
      id: n?.id ?? null,
      title: cleanText(n?.title) || '公告',
      content: stripHtml(String(n?.content || '')).slice(0, 3000),
      createdAt: unix(n?.created_at)
    }))
  });
}


async function simpleUserList(request, env, path, fallback) {
  const auth = await getSessionAuth(request, env);
  if (!auth) return unauthorized();
  const upstream = await xboardFetch(env, path, {}, auth);
  if (upstream.status === 401 || upstream.status === 403) return unauthorized(true);
  const payload = await safeJson(upstream);
  if (!upstream.ok) return json({ ok: false, message: publicMessage(payload, fallback) }, upstream.status);
  return json({ ok: true, data: sanitizeJson(payload?.data) });
}

async function simpleUserObject(request, env, path, fallback) {
  return simpleUserList(request, env, path, fallback);
}

async function resetSubscription(request, env) {
  const auth = await getSessionAuth(request, env);
  if (!auth) return unauthorized();
  const upstream = await xboardFetch(env, '/api/v1/user/resetSecurity', { method: 'GET' }, auth);
  if (upstream.status === 401 || upstream.status === 403) return unauthorized(true);
  const payload = await safeJson(upstream);
  if (!upstream.ok) return json({ ok: false, message: publicMessage(payload, '重置失败') }, upstream.status);
  return json({ ok: true, message: '订阅凭据已重置，请重新复制订阅地址。' });
}

function sanitizeJson(value, depth = 0) {
  if (depth > 8) return null;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const text = String(value).slice(0, 10000);
    // 不把后台域名/原始订阅地址等 URL 直接透传给前端。
    if (/^https?:\/\//i.test(text)) return null;
    return text.replace(/[\u0000-\u001f]/g, '');
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(v => sanitizeJson(v, depth + 1));
  if (typeof value === 'object') {
    const blocked = new Set(['token', 'auth_data', 'subscribe_url', 'app_url', 'uuid']);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (blocked.has(k)) continue;
      out[k] = sanitizeJson(v, depth + 1);
    }
    return out;
  }
  return null;
}

async function changePassword(request, env) {
  const auth = await getSessionAuth(request, env);
  if (!auth) return unauthorized();

  const body = await readJson(request);
  const oldPassword = String(body?.oldPassword || '');
  const newPassword = String(body?.newPassword || '');
  if (!oldPassword || newPassword.length < 8 || newPassword.length > 128) {
    return json({ ok: false, message: '新密码至少 8 位' }, 400);
  }

  const upstream = await xboardFetch(env, '/api/v1/user/changePassword', {
    method: 'POST',
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
  }, auth);
  const payload = await safeJson(upstream);
  return json({ ok: upstream.ok, message: upstream.ok ? '密码已修改' : publicMessage(payload, '修改失败') }, upstream.ok ? 200 : upstream.status);
}

async function subscriptionProxy(request, env) {
  const url = new URL(request.url);
  const opaque = decodeURIComponent(url.pathname.slice(3));
  if (!opaque || opaque.length > 4096) return new Response('Not found', { status: 404 });

  let decoded;
  try {
    decoded = await unseal(opaque, env.LINK_SECRET, 'subscription');
  } catch {
    return new Response('Invalid subscription link', { status: 404 });
  }

  const token = String(decoded?.token || '');
  if (!token || token.length > 512) return new Response('Invalid subscription link', { status: 404 });

  const upstream = await xboardFetch(env, `/api/v1/client/subscribe?token=${encodeURIComponent(token)}`, {
    method: 'GET',
    headers: {
      'User-Agent': request.headers.get('User-Agent') || 'OumeiPortal/1.0'
    },
    redirect: 'manual'
  });

  const headers = new Headers();
  const allowHeaders = [
    'content-type',
    'content-disposition',
    'subscription-userinfo',
    'profile-update-interval',
    'profile-web-page-url'
  ];
  for (const name of allowHeaders) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, sanitizeUpstreamHeader(name, v, request));
  }
  headers.set('Cache-Control', 'no-store, private');
  headers.set('X-Content-Type-Options', 'nosniff');

  if (upstream.status >= 300 && upstream.status < 400) {
    return new Response('Subscription redirect blocked', { status: 502, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

async function xboardFetch(env, path, init = {}, auth = null) {
  const origin = String(env.XBOARD_ORIGIN || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(origin)) throw new Error('XBOARD_ORIGIN must use https');

  const headers = new Headers(init.headers || {});
  headers.set('Accept', headers.get('Accept') || 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (auth) headers.set('Authorization', auth);
  if (env.ORIGIN_KEY) headers.set('X-Oumei-Origin-Key', env.ORIGIN_KEY);

  return fetch(origin + path, {
    ...init,
    headers,
    cf: { cacheTtl: 0, cacheEverything: false }
  });
}

async function getSessionAuth(request, env) {
  const raw = parseCookies(request.headers.get('Cookie') || '').ob_session;
  if (!raw) return null;
  try {
    const payload = await unseal(raw, env.SESSION_SECRET, 'session');
    const maxAgeMs = Math.max(1, Number(env.SESSION_DAYS || 7)) * 86400 * 1000;
    if (!payload?.auth || !payload?.iat || Date.now() - Number(payload.iat) > maxAgeMs) return null;
    return String(payload.auth);
  } catch {
    return null;
  }
}

async function seal(value, secret, purpose) {
  const key = await cryptoKey(secret, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = te.encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return `${b64url(iv)}.${b64url(ciphertext)}`;
}

async function unseal(value, secret, purpose) {
  const [ivPart, dataPart] = String(value).split('.');
  if (!ivPart || !dataPart) throw new Error('bad sealed value');
  const key = await cryptoKey(secret, purpose);
  const iv = fromB64url(ivPart);
  const data = fromB64url(dataPart);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(td.decode(plaintext));
}

async function cryptoKey(secret, purpose) {
  if (!secret || String(secret).length < 32) throw new Error(`${purpose} secret must be at least 32 chars`);
  const digest = await crypto.subtle.digest('SHA-256', te.encode(`${purpose}:${secret}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(input) {
  const out = {};
  for (const part of input.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function safeJson(response) {
  try { return await response.json(); } catch { return null; }
}

function publicMessage(payload, fallback) {
  const msg = payload?.message;
  if (typeof msg === 'string' && msg.length <= 160) return msg;
  if (Array.isArray(msg) && msg[0] && typeof msg[0] === 'string') return msg[0].slice(0, 160);
  return fallback;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function unauthorized(clearCookie = false) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  if (clearCookie) headers.set('Set-Cookie', 'ob_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  return new Response(JSON.stringify({ ok: false, code: 'UNAUTHORIZED', message: '登录已失效' }), { status: 401, headers });
}

function unix(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function cleanText(value) {
  if (value == null) return null;
  return String(value).replace(/[<>\u0000-\u001f]/g, '').slice(0, 300);
}

function stripHtml(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeUpstreamHeader(name, value, request) {
  if (name === 'profile-web-page-url') return new URL(request.url).origin;
  return String(value).replace(/[\r\n]/g, '');
}
