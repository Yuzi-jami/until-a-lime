import { fillPage } from './fill.js';

const host = 'dev.untilalime.browser';
async function native(request) {
  const reply = await chrome.runtime.sendNativeMessage(host, request);
  if (reply.error) throw new Error(reply.error);
  return reply;
}

// Requests come from our isolated content script, never window.postMessage.
// Credentials stay in this worker until delivered to the same prepared document.
export async function handleSuggestion(message, sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.documentId || !sender.url)
    throw new Error('请从当前登录框选择账号。');
  const origin = new URL(sender.url).origin;
  if (new URL(sender.url).protocol !== 'https:' || sender.origin !== origin)
    throw new Error('只为 HTTPS 登录页面填写。');
  const tab = await chrome.tabs.get(sender.tab.id);
  if (!tab.active || !tab.url || !sender.tab.url || new URL(tab.url).protocol !== 'https:' || tab.url !== sender.tab.url) throw new Error('标签页已变化或不是 HTTPS 页面，请重新选择。');
  if (message.type === 'lime-list') {
    const reply = await native({ operation: 'list', origin, id: null });
    return { entries: reply.entries, origin };
  }
  if (message.type !== 'lime-fill' || !Number.isSafeInteger(message.id) || message.id < 1)
    throw new Error('填写请求无效。');
  const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
  const [prepared] = await chrome.scripting.executeScript({ target, func: fillPage, args: ['prepare', origin, null, null] });
  if (prepared?.documentId !== sender.documentId || !prepared.result?.ticket)
    throw new Error(prepared?.result?.error || '请先打开登录表单。');
  let credential;
  try {
    ({ credential } = await native({ operation: 'fill', origin, id: message.id }));
    const current = await chrome.tabs.get(sender.tab.id);
    if (!current.active || current.url !== tab.url) throw new Error('标签页已变化，已取消填写。');
    const [result] = await chrome.scripting.executeScript({ target, func: fillPage, args: ['fill', origin, prepared.result.ticket, credential] });
    if (!result?.result?.filled) throw new Error(result?.result?.error || '登录表单已变化。');
    return { filled: true };
  } finally {
    if (credential) { credential.user = ''; credential.password = ''; }
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['lime-list', 'lime-fill'].includes(message?.type)) return false;
  handleSuggestion(message, sender).then(respond, error => respond({ error: error.message }));
  return true;
});
