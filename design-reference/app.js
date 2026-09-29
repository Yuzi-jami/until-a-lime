/* UI concept only. All records are fictional and live in memory until refresh. */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const records = [
    { id: 1, name: 'Figma', domain: 'figma.com', username: 'lime@example.com', password: 'Fresh!Citrus_2026#F', category: '工作', brand: 'figma', favorite: true, weak: false, updated: '今天 09:41', recent: 6 },
    { id: 2, name: 'GitHub', domain: 'github.com', username: 'lime.studio', password: 'Orbit#83_Blue&Lime', category: '工作', brand: 'github', favorite: true, weak: false, updated: '昨天 16:20', recent: 5 },
    { id: 3, name: 'Notion', domain: 'notion.so', username: 'lime@example.com', password: 'demo1234', category: '工作', brand: 'notion', favorite: false, weak: true, updated: '9 月 21 日', recent: 2 },
    { id: 4, name: 'Google', domain: 'accounts.google.com', username: 'lime@example.com', password: 'Cloud@River_62!Mint', category: '生活', brand: 'google', favorite: true, weak: false, updated: '今天 08:30', recent: 4 },
    { id: 5, name: 'Linear', domain: 'linear.app', username: 'lime@example.com', password: 'Tiny$Planet_94&Sky', category: '工作', brand: 'linear', favorite: false, weak: false, updated: '9 月 24 日', recent: 3 },
    { id: 6, name: 'Spotify', domain: 'spotify.com', username: 'little.lime', password: 'Sound#Garden_27!Sun', category: '生活', brand: 'spotify', favorite: false, weak: false, updated: '9 月 20 日', recent: 1 },
  ];
  let currentView = 'vault', filter = 'all', category = 'all', selectedId = 1, passwordVisible = false;
  let toastTimer, focusBeforeLock, generated = '', showConnection = true, saveSuggestion = true;
  const filterNames = { all: '全部密码', favorite: '我的收藏', recent: '最近使用', weak: '安全检查' };
  // Keep the browser scene internally consistent if vault samples are edited.
  const extensionSample = { username: 'lime@example.com', password: 'Fresh!Citrus_2026#F' };
  const recordUrl = record => record.url || `https://${record.domain}`;

  function siteIcon(record) {
    const logos = {
      figma: '<svg class="figma-logo" viewBox="0 0 18 27" aria-hidden="true"><path d="M4.5 0h4.5v9H4.5a4.5 4.5 0 0 1 0-9" fill="#F57158"/><path d="M9 0h4.5a4.5 4.5 0 0 1 0 9H9" fill="#FFA495"/><path d="M4.5 9H9v9H4.5a4.5 4.5 0 0 1 0-9" fill="#A987F6"/><circle cx="13.5" cy="13.5" r="4.5" fill="#68BEF0"/><path d="M4.5 18H9v4.5a4.5 4.5 0 1 1-4.5-4.5" fill="#83CCAA"/></svg>',
      github: '<svg width="23" height="23" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.1.39-1.99 1.03-2.7-.1-.25-.45-1.28.1-2.66 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.77c.85 0 1.7.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.41.1 2.66.64.71 1.03 1.6 1.03 2.7 0 3.85-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>',
      notion: 'N', google: 'G', linear: '◒',
      spotify: '<svg width="25" height="25" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#70C99A"/><g fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round"><path d="M6 9c4-1.4 8-1 12 1M7 12c3-1 6.5-.7 9.5 1M8 15c2.4-.6 4.7-.4 7 .8"/></g></svg>',
      custom: escape(record.name.slice(0, 1).toUpperCase()),
    };
    return `<span class="site-icon ${escape(record.brand)}">${logos[record.brand] || logos.custom}</span>`;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').classList.add('show');
    toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3000);
  }

  function filteredRecords() {
    const query = $('#search').value.trim().toLocaleLowerCase();
    const list = records.filter(record => (filter !== 'favorite' || record.favorite) && (filter !== 'weak' || record.weak) && (category === 'all' || record.category === category) && `${record.name} ${record.domain} ${record.username}`.toLocaleLowerCase().includes(query));
    return filter === 'recent' ? list.sort((a, b) => b.recent - a.recent) : list;
  }

  function renderList() {
    const list = filteredRecords();
    if (!list.some(record => record.id === selectedId)) { selectedId = list[0]?.id ?? null; passwordVisible = false; }
    $('#account-list').innerHTML = list.map(record => `<div role="listitem"><button class="account-row ${record.id === selectedId ? 'selected' : ''}" data-id="${record.id}" aria-pressed="${record.id === selectedId}" aria-label="查看 ${escape(record.name)} 的账号详情"><span class="account-identity">${siteIcon(record)}<span style="min-width:0"><span class="account-name">${escape(record.name)}</span><span class="account-email">${escape(record.username)}</span></span></span><span class="category-pill ${record.category === '生活' ? 'life' : ''}">${record.category === '生活' ? '日常生活' : '工作创作'}</span><span class="strength-label ${record.weak ? 'weak' : ''}"><i></i>${record.weak ? '待改善' : '安全'}</span>${icon('star', `row-star ${record.favorite ? 'favorited' : ''}`)}</button></div>`).join('');
    $('#empty-state').hidden = !!list.length;
    $('#list-count').textContent = String(list.length).padStart(2, '0');
    $('#visible-count').textContent = `${list.length} 个项目`;
    $('#vault-title').firstChild.textContent = `${filter === 'all' ? '我的密码' : filterNames[filter]} `;
    $('#list-subtitle').textContent = filter === 'weak' ? (list.length ? '给这些密码换一点新鲜感，让秘密更安心。' : '每一枚密码，都很有安全感。') : '让每一次登录，都变得轻松一点。';
    $('#nav-count').textContent = records.length;
    const favorites = records.filter(record => record.favorite).length;
    $('#favorite-count').textContent = favorites;
    $('#stat-count').innerHTML = `${records.length}<em>个</em>`;
    $('#stat-favorites').innerHTML = `${favorites}<em>个</em>`;
    const health = records.length ? Math.round(records.filter(record => !record.weak).length / records.length * 100) : 100;
    $('#stat-health').innerHTML = `${health}<em>分</em>`;
    $('.notification-dot').hidden = !records.some(record => record.weak);
    renderDetail();
  }

  function renderDetail() {
    const record = records.find(item => item.id === selectedId);
    if (!record) { $('#detail-panel').innerHTML = `<div class="empty-state">${icon('key')}<strong>为每一个秘密，留一个位置</strong><p>选择一个账号，在这里查看详情。</p></div>`; return; }
    $('#detail-panel').innerHTML = `<div class="detail-heading">${siteIcon(record)}<div><h3>${escape(record.name)}</h3><p>${escape(record.domain)}</p></div><div class="detail-top-actions"><button class="icon-button favorite-button ${record.favorite ? 'is-favorite' : ''}" data-action="favorite" aria-label="${record.favorite ? '取消收藏' : '收藏账号'}" aria-pressed="${record.favorite}">${icon('star')}</button><a class="icon-button" href="${escape(recordUrl(record))}" target="_blank" rel="noopener noreferrer" aria-label="访问 ${escape(record.name)} 网站">${icon('external')}</a></div></div><div class="detail-field"><label>账号 / 电子邮箱</label><div class="field-value"><span>${escape(record.username)}</span><button class="icon-button" data-action="copy-username" aria-label="复制账号">${icon('copy')}</button></div></div><div class="detail-field"><label>密码</label><div class="field-value"><code>${passwordVisible ? escape(record.password) : '••••••••••••••'}</code><button class="icon-button" data-action="toggle-password" aria-label="${passwordVisible ? '隐藏密码' : '显示密码'}" aria-pressed="${passwordVisible}">${icon('eye')}</button><button class="icon-button" data-action="copy-password" aria-label="复制密码">${icon('copy')}</button></div><div class="detail-strength ${record.weak ? 'weak' : ''}"><span class="strength-line"></span>${icon(record.weak ? 'key' : 'shield')}${record.weak ? '建议换一个更长的密码' : '强密码 · 安心收藏'}</div></div><div class="detail-field"><label>网站地址</label><div class="field-value"><span>${escape(recordUrl(record))}</span><button class="icon-button" data-action="copy-url" aria-label="复制网站地址">${icon('copy')}</button></div></div><div class="detail-bottom"><span>更新于 ${escape(record.updated)}</span><button data-action="edit">编辑详情</button></div><div class="detail-note">${icon('laptop')}保存在我的私人空间</div>`;
  }

  function navigate(view = 'vault', newFilter = 'all') {
    currentView = view;
    filter = newFilter;
    category = 'all';
    passwordVisible = false;
    $('#search').value = '';
    $$('.page-view').forEach(section => section.hidden = section.id !== `view-${view}`);
    $$('.nav-item[data-view]').forEach(button => {
      const active = button.dataset.view === view && (view !== 'vault' || button.dataset.filter === filter);
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    $$('.filter-tabs button').forEach(button => { const active = button.dataset.category === 'all'; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', active); });
    $('#breadcrumb-title').textContent = view === 'vault' ? filterNames[filter] : view === 'extension' ? '浏览器扩展' : '密码生成器';
    if (view === 'vault') renderList();
    if (view === 'generator') generate();
  }

  async function copy(text, label) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement('textarea'); textarea.value = text;
        textarea.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(textarea); textarea.select();
        const success = document.execCommand('copy'); textarea.remove();
        if (!success) throw new Error('Copy unavailable');
      }
      toast(`${label}已复制`);
    } catch { toast('浏览器未允许复制，请显示后手动选中复制'); }
  }

  function openDialog(markup) { $('#dialog-content').innerHTML = markup; $('#app-dialog').showModal(); }
  function closeDialog() { $('#app-dialog').close(); }
  function showEntryForm(record = null) {
    openDialog(`<span class="dialog-eyebrow">A NEW LITTLE SECRET</span><h2 id="dialog-title">${record ? '打理这枚密码' : '收藏一枚新密码'}</h2><p>给一个常用账号，找个安心的位置。</p><form id="entry-form"><label class="form-field">网站名称<input name="name" required maxlength="60" placeholder="例如：Figma" value="${escape(record?.name || '')}"></label><label class="form-field">网站地址<input name="url" type="url" required placeholder="https://example.com" value="${record ? `${escape(recordUrl(record))}` : ''}"></label><label class="form-field">账号 / 电子邮箱<input name="username" required maxlength="100" autocomplete="off" placeholder="name@example.com" value="${escape(record?.username || '')}"></label><label class="form-field">密码<input name="password" type="password" required maxlength="128" autocomplete="new-password" placeholder="输入这枚账号的密码" value="${escape(record?.password || '')}"></label><label class="form-field">分类<select name="category"><option value="工作" ${record?.category !== '生活' ? 'selected' : ''}>工作与创作</option><option value="生活" ${record?.category === '生活' ? 'selected' : ''}>日常生活</option></select></label><div class="dialog-actions"><button type="button" class="secondary-button" data-close>取消</button><button type="submit" class="primary-button">${icon('check')}保存到密码库</button></div><p class="dialog-hint">设计预览：仅在本次页面中保留，请使用虚构账号。</p></form>`);
    $('#entry-form').addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget), urlField = event.currentTarget.elements.url;
      let url;
      try { url = new URL(data.get('url')); if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) throw new Error(); }
      catch { urlField.setCustomValidity('请输入以 https:// 或 http:// 开头的网站地址'); urlField.reportValidity(); return; }
      const name = data.get('name').trim(), username = data.get('username').trim(), password = data.get('password');
      if (!name || !username) { toast('请填写网站名称和账号'); return; }
      const changes = { name, username, password, url: url.href, domain: url.host, category: data.get('category'), weak: password.length < 12, updated: '刚刚', recent: Date.now() };
      if (record) { Object.assign(record, changes); selectedId = record.id; }
      else { const entry = { ...changes, id: Math.max(...records.map(item => item.id)) + 1, brand: 'custom', favorite: false }; records.push(entry); selectedId = entry.id; }
      closeDialog(); navigate('vault'); toast(record ? '这一枚密码，已更新' : '新密码已加入本次预览');
    });
    $('#entry-form').elements.url.addEventListener('input', event => event.target.setCustomValidity(''));
  }

  function randomIndex(max) {
    const bytes = new Uint32Array(1), limit = Math.floor(4294967296 / max) * max;
    do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
    return bytes[0] % max;
  }
  function generate() {
    const groups = ['abcdefghjkmnpqrstuvwxyz'];
    if ($('#include-uppercase').checked) groups.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
    if ($('#include-numbers').checked) groups.push('23456789');
    if ($('#include-symbols').checked) groups.push('!@#$%&*_-+');
    const length = Number($('#password-length').value), pool = groups.join('');
    const chars = groups.map(group => group[randomIndex(group.length)]);
    while (chars.length < length) chars.push(pool[randomIndex(pool.length)]);
    for (let i = chars.length - 1; i > 0; i--) { const j = randomIndex(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    generated = chars.join(''); $('#generated-password').textContent = generated; $('#length-output').innerHTML = `${length} <span>位</span>`;
  }

  function lock() {
    focusBeforeLock = document.activeElement;
    closeDialog(); passwordVisible = false; renderDetail();
    $('.app-shell').inert = true; $('#lock-screen').hidden = false; $('#unlock-button').focus();
  }
  function unlock() { $('#lock-screen').hidden = true; $('.app-shell').inert = false; focusBeforeLock?.focus(); toast('欢迎回来，酸橙收藏家'); }

  function showSavePreview() {
    if (!saveSuggestion) { toast('请先在偏好设置中开启保存提示预览'); return; }
    openDialog(`<span class="dialog-eyebrow">ONE LESS THING TO REMEMBER</span><h2 id="dialog-title">要替你记住吗？</h2><p>下次见面，就不用再输入密码了。</p><div class="save-account">${siteIcon({ name: 'Dribbble', brand: 'custom' })}<span>Dribbble<small>lime@example.com</small></span><span class="category-pill" style="margin-left:auto">新账号</span></div><div class="detail-note">${icon('laptop')}保存到「我的私人空间」</div><div class="dialog-actions"><button class="secondary-button" data-close>这次不用</button><button class="primary-button" id="save-demo-account">${icon('check')}替我记住</button></div><p class="dialog-hint">浏览器自动保存提示的交互示意。</p>`);
    $('#save-demo-account').addEventListener('click', () => {
      let record = records.find(item => item.domain === 'dribbble.com');
      if (!record) { record = { id: Math.max(...records.map(item => item.id)) + 1, name: 'Dribbble', domain: 'dribbble.com', username: 'lime@example.com', password: 'Design!Lime_84#Sky', category: '工作', brand: 'custom', favorite: false, weak: false, updated: '刚刚', recent: Date.now() }; records.push(record); }
      selectedId = record.id; closeDialog(); renderList(); toast('已记住这枚密码，回到密码库就能看到');
    });
  }

  function showSettings() {
    openDialog(`<span class="dialog-eyebrow">MAKE YOURSELF AT HOME</span><h2 id="dialog-title">你的酸橙，你来决定。</h2><p>一点小偏好，让使用更顺手。</p><div class="settings-row"><span>显示浏览器连接横幅<small>在密码库底部，保留扩展入口。</small></span><button class="switch ${showConnection ? 'on' : ''}" id="setting-banner" role="switch" aria-checked="${showConnection}" aria-label="显示浏览器连接横幅"></button></div><div class="settings-row"><span>启用保存提示预览<small>体验浏览器记住新账号的交互。</small></span><button class="switch ${saveSuggestion ? 'on' : ''}" id="setting-save" role="switch" aria-checked="${saveSuggestion}" aria-label="启用保存提示预览"></button></div><p class="dialog-hint">偏好仅在本次设计预览中生效。</p><div class="dialog-actions"><button class="primary-button" data-close>刚刚好，完成</button></div>`);
    $('#setting-banner').addEventListener('click', () => { showConnection = !showConnection; $('.connection-strip').hidden = !showConnection; });
    $('#setting-save').addEventListener('click', () => { saveSuggestion = !saveSuggestion; const button = $('.extension-settings .switch'); button.classList.toggle('on', saveSuggestion); button.setAttribute('aria-checked', saveSuggestion); });
  }

  $$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view, button.dataset.filter || 'all')));
  $$('.stat-card').forEach(button => button.addEventListener('click', () => button.dataset.stat === 'extension' ? navigate('extension') : navigate('vault', button.dataset.stat)));
  $('.brand').addEventListener('click', event => { event.preventDefault(); navigate('vault'); });
  $('#hero-generator').addEventListener('click', () => navigate('generator'));
  $('#connection-button').addEventListener('click', () => navigate('extension'));
  $('#popup-generator').addEventListener('click', () => navigate('generator'));
  $('#popup-vault').addEventListener('click', () => navigate('vault'));
  $('#search').addEventListener('input', () => { passwordVisible = false; renderList(); });
  $$('.filter-tabs button').forEach(button => button.addEventListener('click', () => {
    category = button.dataset.category; passwordVisible = false;
    $$('.filter-tabs button').forEach(item => { const active = item === button; item.classList.toggle('selected', active); item.setAttribute('aria-pressed', active); }); renderList();
  }));
  $('#account-list').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (!button) return; selectedId = Number(button.dataset.id); passwordVisible = false; renderList(); });
  $('#detail-panel').addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action, record = records.find(item => item.id === selectedId);
    if (!record || !action) return;
    if (action === 'favorite') { record.favorite = !record.favorite; renderList(); toast(record.favorite ? '已放进我的收藏' : '已移出我的收藏'); }
    if (action === 'toggle-password') { passwordVisible = !passwordVisible; renderDetail(); $('[data-action="toggle-password"]').focus(); }
    if (action === 'copy-username') copy(record.username, '账号');
    if (action === 'copy-password') copy(record.password, '演示密码');
    if (action === 'copy-url') copy(recordUrl(record), '网站地址');
    if (action === 'edit') showEntryForm(record);
  });
  $('#add-button').addEventListener('click', () => showEntryForm());
  $('#dialog-close').addEventListener('click', closeDialog);
  $('#app-dialog').addEventListener('click', event => { if (event.target.closest('[data-close]')) closeDialog(); });
  $('#lock-button').addEventListener('click', lock); $('#top-lock').addEventListener('click', lock); $('#unlock-button').addEventListener('click', unlock);
  $('#settings-button').addEventListener('click', showSettings);
  $('#mobile-settings').addEventListener('click', showSettings);
  $('#password-length').addEventListener('input', generate);
  $$('.generator-options input').forEach(input => input.addEventListener('change', generate));
  $('#regenerate').addEventListener('click', generate);
  $('#copy-generated').addEventListener('click', () => copy(generated, '新密码'));
  $('#fill-button').addEventListener('click', () => {
    const record = extensionSample;
    $('#demo-email').value = record.username; $('#demo-password').value = record.password;
    $('#fill-button').innerHTML = `${icon('check')}已填入，轻松一点`; toast('已在示意登录表单中填入演示账号');
  });
  $('#demo-login').addEventListener('click', () => toast($('#demo-email').value ? '填写完成。这是设计预览，不会提交登录。' : '点击扩展中的「一键填入」，体验自动填写'));
  $('#save-preview').addEventListener('click', showSavePreview);
  $$('.browser-choice button').forEach(button => button.addEventListener('click', () => {
    $$('.browser-choice button').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', item === button); });
    $('.extension-stat').innerHTML = `${escape(button.dataset.browser)} <span class="status-dot"></span>`;
    toast(`正在预览 ${button.dataset.browser} 扩展界面`);
  }));
  document.addEventListener('click', event => {
    const button = event.target.closest('.switch'); if (!button) return;
    const checked = button.getAttribute('aria-checked') !== 'true'; button.setAttribute('aria-checked', checked); button.classList.toggle('on', checked);
    if (button === $('.extension-settings .switch')) saveSuggestion = checked;
    if (button === $$('.extension-settings .switch')[1]) { $('.extension-popup').hidden = !checked; toast(checked ? '填充建议已显示' : '填充建议已隐藏'); }
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && $('#lock-screen').hidden && !$('#app-dialog').open) { event.preventDefault(); if (currentView !== 'vault') navigate('vault'); $('#search').focus(); }
    if (event.altKey && event.key.toLowerCase() === 'l' && $('#lock-screen').hidden) { event.preventDefault(); lock(); }
  });
  navigate('vault');
})();
