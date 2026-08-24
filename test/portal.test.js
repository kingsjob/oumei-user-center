import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const baseEnv = () => ({
  XBOARD_ORIGIN: 'https://core.example.com',
  SESSION_SECRET: 's'.repeat(64),
  LINK_SECRET: 'l'.repeat(64),
  SESSION_DAYS: '7',
  ASSETS: {
    async fetch(request) {
      return new Response(`asset:${new URL(request.url).pathname}`, { status: 200 });
    }
  }
});

test('GET /login serves the dedicated login page', async () => {
  const res = await worker.fetch(new Request('https://portal.example.com/login'), baseEnv());
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'asset:/login.html');
});

test('anonymous GET /dashboard redirects to /login', async () => {
  const res = await worker.fetch(new Request('https://portal.example.com/dashboard'), baseEnv());
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
});

test('portal config exposes only registration fields needed by the custom frontend', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://core.example.com/api/v1/guest/comm/config');
    return Response.json({
      data: {
        is_email_verify: 1,
        is_invite_force: 1,
        email_whitelist_suffix: ['gmail.com'],
        is_captcha: 1,
        captcha_type: 'turnstile',
        turnstile_site_key: 'site-key',
        app_url: 'https://secret-panel.example.com',
        logo: 'https://secret-panel.example.com/logo.png'
      }
    });
  };

  try {
    const res = await worker.fetch(new Request('https://portal.example.com/api/portal/config'), baseEnv());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      ok: true,
      data: {
        emailVerify: true,
        inviteRequired: true,
        emailWhitelist: ['gmail.com'],
        captcha: { enabled: true, type: 'turnstile', siteKey: 'site-key' }
      }
    });
    assert.equal(JSON.stringify(body).includes('secret-panel.example.com'), false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('registration forwards supported XBoard fields and creates an HttpOnly session', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://core.example.com/api/v1/passport/auth/register');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), {
      email: 'user@example.com',
      password: '12345678',
      invite_code: 'INVITE',
      email_code: '123456',
      turnstile_token: 'captcha-token'
    });
    return Response.json({ data: { auth_data: 'Bearer generated-token' } });
  };

  try {
    const req = new Request('https://portal.example.com/api/portal/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password: '12345678',
        confirmPassword: '12345678',
        inviteCode: 'INVITE',
        emailCode: '123456',
        captcha: { type: 'turnstile', token: 'captcha-token' }
      })
    });
    const res = await worker.fetch(req, baseEnv());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    const cookie = res.headers.get('set-cookie') || '';
    assert.match(cookie, /^ob_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

import { readFile } from 'node:fs/promises';

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

test('login page contains login only and links to registration', async () => {
  const html = await readFile(publicFile('login.html'), 'utf8');
  assert.match(html, /id="loginForm"/);
  assert.match(html, /href="\/register"/);
  assert.doesNotMatch(html, /id="appView"/);
  assert.doesNotMatch(html, /id="registerForm"/);
});

test('register and dashboard are separate documents', async () => {
  const registerHtml = await readFile(publicFile('register.html'), 'utf8');
  const dashboardHtml = await readFile(publicFile('dashboard.html'), 'utf8');
  assert.match(registerHtml, /id="registerForm"/);
  assert.doesNotMatch(registerHtml, /id="loginForm"/);
  assert.match(dashboardHtml, /id="dashboardApp"/);
  assert.doesNotMatch(dashboardHtml, /id="loginForm"/);
  assert.doesNotMatch(dashboardHtml, /id="registerForm"/);
});
