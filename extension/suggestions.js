// No password reads, automatic filling or persistent account cache on the page.
(() => {
  if (globalThis.__limeSuggestionsInstalled) return;
  globalThis.__limeSuggestionsInstalled = true;
  let host, shadow, anchor, generation = 0, blurTimer, working = false;
  const eligible = input => input instanceof HTMLInputElement && !input.disabled && !input.readOnly
    && ['text', 'email', 'tel', 'password'].includes(input.type) && input.autocomplete !== 'new-password'
    && !/captcha|verify|verification|验证码|搜索|search/i.test(`${input.name} ${input.id} ${input.placeholder}`)
    && [...(input.form || document).querySelectorAll('input[type=password]')].some(password => password.getClientRects().length && password.autocomplete !== 'new-password');
  function close() {
    generation++;
    clearTimeout(blurTimer);
    host?.remove(); host = shadow = anchor = null;
  }
  function position() {
    if (!anchor?.isConnected || !host) { close(); return; }
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(330, innerWidth - 16);
    Object.assign(host.style, { width: `${width}px`, left: `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`,
      top: `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - host.getBoundingClientRect().height - 8))}px` });
  }
  function render(entries, error) {
    if (!shadow) return;
    shadow.querySelector('.items').replaceChildren();
    shadow.querySelector('.status').textContent = error?.includes('锁定') ? '收藏室已锁定，请从托盘打开酸橙验证主密码，再点选输入框。' : error || (entries?.length ? '选择账号填写 · 不自动登录' : '此网站暂无匹配账号');
    for (const entry of entries || []) {
      const button = document.createElement('button');
      const user = document.createElement('b'), site = document.createElement('span');
      user.textContent = entry.user || entry.name;
      let savedSite = '';
      try { savedSite = new URL(entry.site.includes('://') ? entry.site : `https://${entry.site}`).host; } catch { /* Optional display label. */ }
      site.textContent = `${entry.name}${savedSite ? ` · ${savedSite}` : ''}`;
      button.append(user, site);
      button.addEventListener('click', async () => {
        if (working) return;
        working = true;
        const token = generation;
        shadow.querySelectorAll('.items button').forEach(item => { item.disabled = true; });
        try {
          const result = await chrome.runtime.sendMessage({ type: 'lime-fill', id: entry.id });
          if (token !== generation) return;
          if (result.error) render([], result.error);
          else close();
        } catch { if (token === generation) render([], '连接暂不可用，请刷新页面后重试。'); }
        finally { working = false; }
      });
      shadow.querySelector('.items').append(button);
    }
    position();
  }
  async function show(input) {
    close(); anchor = input;
    const token = generation;
    host = document.createElement('div');
    host.setAttribute('data-lime-suggestions', '');
    Object.assign(host.style, { position: 'fixed', zIndex: '2147483647', colorScheme: 'light dark' });
    shadow = host.attachShadow({ mode: 'closed' });
    // Static markup only; account metadata is assigned via textContent.
    shadow.innerHTML = `<style>
      :host { font: 13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif; }
      .panel { background:#fffaf3; color:#3d3028; border:1px solid #e7dccd; border-radius:13px; box-shadow:0 8px 28px #0003; padding:12px; }
      header { display:flex; align-items:center; justify-content:space-between; color:#aa5b24; font-weight:600; }
      button { font:inherit; cursor:pointer; border:0; color:inherit; }
      header button { background:transparent; padding:2px 7px; }
      .status { font-size:11px; opacity:.75; margin:6px 0; }
      .items { max-height:210px; overflow:auto; }
      .items button { background:transparent; border-radius:8px; text-align:left; display:block; width:100%; padding:9px; }
      .items button:hover,.items button:focus-visible { background:#fbecd8; outline:2px solid #eebc7b; outline-offset:-2px; }
      .items b,.items span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .items span { font-size:11px; opacity:.7; }
      @media(prefers-color-scheme:dark) { .panel { background:#282521; color:#f3eade; border-color:#494139; } header{color:#ffbc78}.items button:hover,.items button:focus-visible{background:#3b3025} }
    </style><section class="panel" aria-label="酸橙账号建议"><header>◉ 酸橙<button aria-label="关闭账号建议">×</button></header><p class="status" role="status">正在连接收藏室…</p><div class="items"></div></section>`;
    shadow.querySelector('header button').addEventListener('click', close);
    host.addEventListener('pointerdown', () => clearTimeout(blurTimer));
    document.documentElement.append(host); position();
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'lime-list' });
      if (token !== generation) return;
      render(reply.entries, reply.error);
    } catch { if (token === generation) render([], '请打开酸橙收藏室，解锁后重新点选输入框。'); }
  }
  document.addEventListener('focusin', event => {
    if (event.target === host) { clearTimeout(blurTimer); return; }
    if (eligible(event.target)) void show(event.target);
    else close();
  });
  document.addEventListener('focusout', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { if (document.activeElement !== host && document.activeElement !== anchor) close(); }, 120);
  });
  document.addEventListener('pointerdown', event => { if (event.target !== host && event.target !== anchor) close(); }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowDown' && document.activeElement === anchor && shadow?.querySelector('.items button')) {
      event.preventDefault(); shadow.querySelector('.items button').focus();
    }
  });
  document.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });
  window.addEventListener('pagehide', close);
})();
