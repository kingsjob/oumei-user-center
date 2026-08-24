import { $, api } from '/common.js';

let portalConfig = null;
let captchaToken = '';
let captchaWidgetId = null;
let captchaReady = Promise.resolve();
let countdownTimer = null;

init().catch((err) => {
  $('registerError').textContent = err?.message || '注册配置加载失败';
});

async function init() {
  const result = await api('/api/portal/config');
  if (!result.ok) throw new Error(result.message || '注册配置加载失败');
  portalConfig = result.data;

  if (portalConfig.emailVerify) $('emailCodeRow').classList.remove('field-hidden');
  if (portalConfig.inviteRequired) {
    $('inviteCode').required = true;
    $('inviteOptional').textContent = '（必填）';
  }
  if (portalConfig.emailWhitelist?.length) {
    $('emailHint').textContent = `支持邮箱后缀：${portalConfig.emailWhitelist.join('、')}`;
  }

  if (portalConfig.captcha?.enabled) {
    $('captchaWrap').classList.remove('field-hidden');
    captchaReady = setupCaptcha(portalConfig.captcha);
    await captchaReady;
  }

  $('registerButton').disabled = false;
}

$('registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('registerButton');
  const error = $('registerError');
  const status = $('registerStatus');
  error.textContent = '';
  status.textContent = '';

  const email = $('registerEmail').value.trim();
  const password = $('registerPassword').value;
  const confirmPassword = $('confirmPassword').value;
  if (password.length < 8) return showError('密码至少 8 位');
  if (password !== confirmPassword) return showError('两次输入的密码不一致');
  if (portalConfig?.emailVerify && !/^\d{6}$/.test($('emailCode').value.trim())) {
    return showError('请输入 6 位邮箱验证码');
  }
  if (portalConfig?.inviteRequired && !$('inviteCode').value.trim()) {
    return showError('请输入邀请码');
  }

  button.disabled = true;
  button.textContent = '创建中…';
  try {
    const captcha = await getCaptchaPayload('register');
    const result = await api('/api/portal/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        confirmPassword,
        inviteCode: $('inviteCode').value.trim(),
        emailCode: $('emailCode').value.trim(),
        captcha
      })
    });
    if (!result.ok) throw new Error(result.message || '注册失败');
    status.textContent = '注册成功，正在进入用户中心…';
    window.location.replace('/dashboard');
  } catch (err) {
    error.textContent = err?.message || '注册失败，请稍后再试';
    resetVisibleCaptcha();
  } finally {
    button.disabled = false;
    button.textContent = '创建账号';
  }
});

$('sendCodeButton').addEventListener('click', async () => {
  const email = $('registerEmail').value.trim();
  const button = $('sendCodeButton');
  $('registerError').textContent = '';
  $('registerStatus').textContent = '';
  if (!/^\S+@\S+\.\S+$/.test(email)) return showError('请先填写正确的邮箱');

  button.disabled = true;
  button.textContent = '发送中…';
  try {
    const captcha = await getCaptchaPayload('send_email_code');
    const result = await api('/api/portal/send-email-code', {
      method: 'POST',
      body: JSON.stringify({ email, captcha })
    });
    if (!result.ok) throw new Error(result.message || '验证码发送失败');
    $('registerStatus').textContent = '验证码已发送，请检查邮箱。';
    resetVisibleCaptcha();
    startCountdown(60);
  } catch (err) {
    $('registerError').textContent = err?.message || '验证码发送失败';
    button.disabled = false;
    button.textContent = '发送验证码';
    resetVisibleCaptcha();
  }
});

function showError(message) {
  $('registerError').textContent = message;
}

async function setupCaptcha(config) {
  const { type, siteKey } = config;
  if (!siteKey) throw new Error('后台已启用人机验证，但未提供 Site Key');

  if (type === 'turnstile') {
    await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', 'turnstile');
    captchaWidgetId = window.turnstile.render('#captchaWidget', {
      sitekey: siteKey,
      callback: (token) => { captchaToken = token; },
      'expired-callback': () => { captchaToken = ''; },
      'error-callback': () => { captchaToken = ''; }
    });
    return;
  }

  if (type === 'recaptcha') {
    await loadScript('https://www.google.com/recaptcha/api.js?render=explicit', 'grecaptcha');
    await new Promise((resolve) => window.grecaptcha.ready(resolve));
    captchaWidgetId = window.grecaptcha.render('captchaWidget', {
      sitekey: siteKey,
      callback: (token) => { captchaToken = token; },
      'expired-callback': () => { captchaToken = ''; }
    });
    return;
  }

  if (type === 'recaptcha-v3') {
    $('captchaHint').textContent = '人机验证将在提交时自动完成。';
    await loadScript(`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`, 'grecaptcha');
    await new Promise((resolve) => window.grecaptcha.ready(resolve));
    return;
  }

  throw new Error('不支持的人机验证类型');
}

async function getCaptchaPayload(action) {
  const config = portalConfig?.captcha;
  if (!config?.enabled) return null;
  await captchaReady;

  if (config.type === 'recaptcha-v3') {
    const token = await window.grecaptcha.execute(config.siteKey, { action });
    if (!token) throw new Error('人机验证失败，请重试');
    return { type: config.type, token };
  }

  if (!captchaToken) throw new Error('请先完成人机验证');
  return { type: config.type, token: captchaToken };
}

function resetVisibleCaptcha() {
  const type = portalConfig?.captcha?.type;
  captchaToken = '';
  if (captchaWidgetId == null) return;
  if (type === 'turnstile' && window.turnstile) window.turnstile.reset(captchaWidgetId);
  if (type === 'recaptcha' && window.grecaptcha) window.grecaptcha.reset(captchaWidgetId);
}

function startCountdown(seconds) {
  clearInterval(countdownTimer);
  const button = $('sendCodeButton');
  let left = seconds;
  button.disabled = true;
  button.textContent = `${left}s 后重发`;
  countdownTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(countdownTimer);
      button.disabled = false;
      button.textContent = '发送验证码';
      return;
    }
    button.textContent = `${left}s 后重发`;
  }, 1000);
}

function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('人机验证组件加载失败'));
    document.head.appendChild(script);
  });
}
