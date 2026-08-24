# OU MEI XBoard Portal V2

Cloudflare Worker + 独立静态前端实现的 XBoard 自有用户中心。XBoard 继续负责账户、套餐、订阅等后端数据，普通用户只访问自有 Portal 域名。

## V2 主要变化

- `/login`：独立登录页，只包含登录功能。
- `/register`：独立注册页，支持 XBoard 原生注册、邀请码、邮箱验证码以及 Turnstile / reCAPTCHA v2 / reCAPTCHA v3。
- `/dashboard`：独立用户中心页面，不包含登录或注册表单。
- 未登录直接访问 `/dashboard` 时，Worker 在服务端 302 跳转到 `/login`。
- 已登录访问 `/login` 或 `/register` 时，Worker 直接跳转到 `/dashboard`。
- 登录或注册成功后，XBoard `auth_data` 不返回给前端；Worker 将其 AES-GCM 加密后写入 `HttpOnly + Secure + SameSite=Lax` Cookie。
- 原始 XBoard `subscribe_url` 不返回浏览器。用户只看到 `https://你的Portal域名/s/<opaque>`。
- `/s/<opaque>` 由 Worker 解密后请求 XBoard `/api/v1/client/subscribe?token=...`。
- API JSON 会过滤 token、auth_data、subscribe_url、app_url、uuid 等敏感/源站信息。
- 可使用 `ORIGIN_KEY` 让隐藏 XBoard 源站只接受带共享请求头的 Portal 请求。

## 页面与路由

```text
/             -> 根据 Session 跳 /login 或 /dashboard
/login        -> 登录页
/register     -> 注册页
/dashboard    -> 用户中心
/s/<opaque>   -> 隐藏订阅入口
```

Portal API：

```text
GET  /api/portal/config
POST /api/portal/login
POST /api/portal/register
POST /api/portal/send-email-code
POST /api/portal/logout
GET  /api/portal/dashboard
GET  /api/portal/notices
GET  /api/portal/plans
GET  /api/portal/orders
GET  /api/portal/invite
GET  /api/portal/tickets
POST /api/portal/reset-subscription
POST /api/portal/password
```

## 注册兼容

V2 会读取 XBoard：

```text
GET /api/v1/guest/comm/config
```

根据后台配置自动处理：

- `is_email_verify`
- `is_invite_force`
- `email_whitelist_suffix`
- `captcha_type`
- `recaptcha_site_key`
- `recaptcha_v3_site_key`
- `turnstile_site_key`

注册实际提交到：

```text
POST /api/v1/passport/auth/register
```

邮箱验证码提交到：

```text
POST /api/v1/passport/comm/sendEmailVerify
```

如果 XBoard 同时启用了邮箱验证码和可见式 CAPTCHA，发送验证码后 CAPTCHA 会重置；用户注册提交前需要再次完成人机验证。这是为了给两个独立的 XBoard 请求分别提供有效 CAPTCHA token。

## 部署

1. 修改 `wrangler.toml`：

```toml
XBOARD_ORIGIN = "https://你的XBoard隐藏后端域名"
```

只写协议和域名，不要以 `/` 结尾。

2. 安装依赖：

```bash
npm install
```

3. 设置两个至少 32 字符的 Secret：

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put LINK_SECRET
```

`LINK_SECRET` 上线后不要随意更换，否则已经下发给用户的 `/s/...` 链接无法解密。

4. 可选：隐藏源站共享密钥：

```bash
npx wrangler secret put ORIGIN_KEY
```

Worker 请求 XBoard 时会增加：

```text
X-Oumei-Origin-Key: <ORIGIN_KEY>
```

5. 本地测试与开发：

```bash
npm test
npm run dev
```

6. 发布：

```bash
npm run deploy
```

7. 在 Cloudflare Worker 中绑定自定义域名，例如：

```text
my.oumei.lat
```

## 推荐域名结构

```text
oumei.lat             公开品牌/导航页
my.oumei.lat          V2 Portal，用户唯一业务入口
core.<隐藏域名>       XBoard 用户 API 后端
admin.<隐藏域名>      XBoard 管理入口，可再套 Cloudflare Access
server.<隐藏域名>     如有需要，单独给 V2bX / 服务端 API 使用
```

不要在网页、邮件模板、公告、支付回跳地址或帮助文档中再次输出 XBoard 隐藏源站域名，否则仍可能逐步暴露真实面板入口。

## 目录

```text
public/
  index.html
  login.html
  login.js
  register.html
  register.js
  dashboard.html
  dashboard.js
  common.js
  styles.css
src/
  index.js
test/
  portal.test.js
wrangler.toml
package.json
README.md
```

## 后续可继续扩展

现有 Worker 已预留套餐、订单、邀请、工单、修改密码、重置订阅等 API。下一阶段可以把 `/dashboard` 扩展成完整多功能用户中心，而无需重新改变认证架构。
