import { fillPage } from './fill.js';
const host = 'dev.untilalime.browser';
const status = document.getElementById('status'), accounts = document.getElementById('accounts');
const retry = document.getElementById('retry');
let active = null, working = false;
async function native(request) {
  const reply = await chrome.runtime.sendNativeMessage(host, request);
  if (reply.error) throw new Error(reply.error);
  return reply;
}
async function current() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('请选择普通网站标签页。');
  const url = new URL(tab.url);
  if (url.protocol !== 'https:') throw new Error('只为 HTTPS 网站填写。');
  return { tabId: tab.id, origin: url.origin, url: tab.url };
}
async function load() {
  if (working) return;
  accounts.replaceChildren();
  working = true; retry.disabled = true;
  try {
    active = await current();
    document.getElementById('site').textContent = active.origin;
    const reply = await native({ operation: 'list', origin: active.origin, id: null });
    status.textContent = reply.entries.length ? '选择一个账号自动填写。' : '没有匹配账号。请在收藏室确认此网站的网址。';
    for (const entry of reply.entries) {
      const button = document.createElement('button'), user = document.createElement('span');
      button.textContent = entry.name; user.textContent = entry.user || '未填写用户名'; button.append(user);
      if (entry.site) { const site = document.createElement('small'); try { site.textContent = new URL(entry.site.includes('://') ? entry.site : `https://${entry.site}`).host; } catch { site.textContent = ''; } button.append(site); }
      button.addEventListener('click', () => void fill(entry.id)); accounts.append(button);
    }
  } catch (error) { status.textContent = `${error.message} 如尚未验证，请先在酸橙收藏室验证主密码，再刷新。`; }
  finally { working = false; retry.disabled = false; }
}
async function fill(id) {
  if (working || !active) return;
  working = true; retry.disabled = true;
  for (const el of accounts.children) el.disabled = true;
  let credential;
  try {
    const now = await current();
    if (now.tabId !== active.tabId || now.url !== active.url) throw new Error('标签页已变化，请刷新账号。');
    const frames = await chrome.scripting.executeScript({ target: { tabId: now.tabId, allFrames: true }, func: fillPage, args: ['probe', null, null, null] });
    const candidates = frames.filter(frame => frame.documentId && frame.result?.ticket);
    const focused = candidates.filter(frame => frame.result.focused);
    const choices = focused.length ? focused : candidates;
    if (choices.length !== 1) throw new Error('未找到唯一登录表单，请直接点击要填写的登录输入框，使用酸橙账号建议。');
    const prepared = choices[0];
    ({ credential } = await native({ operation: 'fill', origin: prepared.result.origin, id }));
    const later = await current();
    if (later.tabId !== now.tabId || later.url !== now.url) throw new Error('页面已变化，已取消填写。');
    const [result] = await chrome.scripting.executeScript({ target: { tabId: now.tabId, documentIds: [prepared.documentId] }, func: fillPage, args: ['fill', prepared.result.origin, prepared.result.ticket, credential] });
    if (!result?.result?.filled) throw new Error(result?.result?.error || '页面已变化，已取消填写。');
    status.textContent = '已填写。请核对后自行登录。';
  } catch (error) { status.textContent = error.message; }
  finally {
    if (credential) { credential.user = ''; credential.password = ''; credential = null; }
    working = false; retry.disabled = false;
    for (const el of accounts.children) el.disabled = false;
  }
}
retry.addEventListener('click', () => void load());
void load();
