// Serialized by chrome.scripting into an explicitly selected document's isolated world.
// No page messaging, background listeners, storage, clipboard or submission.
export function fillPage(mode, expectedOrigin, ticket, credential) {
  if (mode === 'probe') { mode = 'prepare'; expectedOrigin = location.origin; }
  if (location.protocol !== "https:" || location.origin !== expectedOrigin || document.visibilityState !== "visible") return { error: "页面已变化或不可见，请重新选择。" };
  const visible = el => el instanceof HTMLInputElement && !el.disabled && !el.readOnly && el.type !== "hidden" && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
  const discover = () => {
    const passwords = [...document.querySelectorAll('input[type="password"]')].filter(el => visible(el) && el.autocomplete !== 'new-password');
    if (passwords.length !== 1) return null;
    const password = passwords[0], scope = password.form || document;
    const candidates = [...scope.querySelectorAll('input')].filter(el => visible(el) && ['text', 'email', 'tel'].includes(el.type)
      && !/captcha|verify|verification|验证码|搜索|search/i.test(`${el.name} ${el.id} ${el.placeholder} ${el.autocomplete}`));
    const named = candidates.filter(el => ['username','email'].includes(el.autocomplete));
    const hinted = candidates.filter(el => /username|userid|loginname|loginid|account|email|phone|mobile|手机号|用户名|账号|超星号/i.test(`${el.name} ${el.id} ${el.placeholder}`));
    const users = named.length ? named : hinted.length ? hinted : candidates;
    if (users.length !== 1) return null;
    if (password.form) {
      const target = new URL(password.form.action || location.href, location.href);
      if (target.origin !== expectedOrigin) return null;
    }
    return { user: users[0], password };
  };
  if (mode === 'prepare') {
    const fields = discover();
    if (!fields) return { error: "未找到唯一登录表单。请先在网站点击“登录 / Sign in”，打开登录框后再试。" };
    const nonce = crypto.randomUUID();
    globalThis.__limeFillPlan = { ...fields, nonce, deadline: Date.now() + 10000, url: location.href };
    return { ticket: nonce, origin: location.origin, focused: fields.user === document.activeElement || fields.password === document.activeElement };
  }
  const plan = globalThis.__limeFillPlan;
  delete globalThis.__limeFillPlan;
  if (mode !== 'fill' || !plan || plan.nonce !== ticket || plan.deadline <= Date.now() || plan.url !== location.href || !credential) return { error: "填写请求已失效，请重试。" };
  const fields = discover();
  if (!fields || fields.user !== plan.user || fields.password !== plan.password || !plan.user.isConnected || !plan.password.isConnected) return { error: "登录表单已变化，已取消填写。" };
  // Refuse overwriting a user-entered password.
  if (plan.password.value) return { error: "密码框已有内容，已取消覆盖。" };
  if (plan.user.value && plan.user.value !== credential.user) return { error: "用户名已有不同内容，已取消覆盖。" };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const notify = input => { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
  setter.call(plan.user, credential.user);
  notify(plan.user);
  // A controlled React form may re-render when username changes. Never set both
  // native values before delivering the first field's events.
  const refreshed = discover();
  if (location.href !== plan.url || document.visibilityState !== 'visible' || !refreshed || refreshed.user !== plan.user || refreshed.password !== plan.password || !plan.password.isConnected || plan.user.value !== credential.user || plan.password.value) return { error: '页面在填写用户名后发生变化，密码未填写，请重试。' };
  setter.call(plan.password, credential.password);
  notify(plan.password);
  if (!plan.password.isConnected || plan.password.value !== credential.password) return { error: '网页未保留已填密码，请检查页面或手动粘贴。' };
  return { filled: true };
}
