import { $, api } from '/common.js';

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('loginButton');
  const error = $('loginError');
  error.textContent = '';
  button.disabled = true;
  button.textContent = '登录中…';

  try {
    const result = await api('/api/portal/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('email').value.trim(),
        password: $('password').value
      })
    });
    if (!result.ok) throw new Error(result.message || '登录失败');
    $('password').value = '';
    window.location.replace('/dashboard');
  } catch (err) {
    error.textContent = err?.message || '登录失败，请稍后再试';
  } finally {
    button.disabled = false;
    button.textContent = '登录';
  }
});
