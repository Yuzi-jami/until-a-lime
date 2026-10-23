import { fillPage } from "./fill.js";

const host = "dev.untilalime.browser";
async function native(request) {
  const reply = await chrome.runtime.sendNativeMessage(host, request);
  if (reply.error) throw new Error(reply.error);
  return reply;
}
const pageKey = (value) => {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href;
};
const pendingKey = (id) => `lime-pending-${id}`;
async function getPending(tab) {
  const key = pendingKey(tab.id);
  const record = (await chrome.storage.session.get(key))[key];
  if (!record) return null;
  if (
    record.deadline <= Date.now() ||
    new URL(tab.url).origin !== record.topOrigin
  ) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return record;
}
async function saveAction(message, tab, record) {
  if (!record || message.ticket !== record.proposal.ticket)
    throw new Error("保存提示已过期，请重新提交表单。");
  if (
    message.type.includes("save") &&
    !(message.id === null && record.proposal.can_create) &&
    !record.proposal.entries.some((e) => e.id === message.id)
  )
    throw new Error("请选择提示中的账号。");
  const reply = await native({
    operation: message.type.includes("dismiss") ? "dismiss" : "save",
    origin: record.proposal.site,
    id: message.id ?? null,
    ticket: record.proposal.ticket,
  });
  const latest = await getPending(tab);
  if (latest?.proposal.ticket === record.proposal.ticket)
    await chrome.storage.session.remove(pendingKey(tab.id));
  return reply;
}
export async function handleToolbar(message, sender) {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    sender.url !== chrome.runtime.getURL("popup.html")
  )
    throw new Error("请从酸橙插件操作。");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || new URL(tab.url).protocol !== "https:")
    throw new Error("请选择 HTTPS 网站。");
  const record = await getPending(tab);
  if (message.type === "lime-toolbar-pending")
    return { proposal: record?.proposal };
  if (
    message.type === "lime-toolbar-save" ||
    message.type === "lime-toolbar-dismiss"
  )
    return saveAction(message, tab, record);
  if (message.type === "lime-toolbar-manual") {
    // Select the focused form, or the only recognizable form. Never collect all frames credentials.
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => ({
        eligible: !!globalThis.__limeCaptureProbe?.(),
        focused: !!globalThis.__limeCaptureProbe?.()?.focused,
      }),
    });
    const candidates = frames.filter((f) => f.documentId && f.result?.eligible);
    const focused = candidates.filter((f) => f.result.focused);
    const choices = focused.length ? focused : candidates;
    if (choices.length !== 1)
      throw new Error("请在目标账号表单内点击输入框后重试。");
    return chrome.tabs.sendMessage(
      tab.id,
      { type: "lime-manual-save" },
      { documentId: choices[0].documentId },
    );
  }
  throw new Error("操作无效。");
}

// Requests come from our isolated content script, never window.postMessage.
// Credentials stay in this worker until delivered to the same prepared document.
export async function handleSuggestion(message, sender) {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.tab?.id ||
    !sender.documentId ||
    !sender.url
  )
    throw new Error("请从当前登录框选择账号。");
  const origin = new URL(sender.url).origin;
  if (new URL(sender.url).protocol !== "https:" || sender.origin !== origin)
    throw new Error("只为 HTTPS 登录页面填写。");
  const tab = await chrome.tabs.get(sender.tab.id);
  if (
    !tab.active ||
    !tab.url ||
    !sender.tab.url ||
    new URL(tab.url).protocol !== "https:" ||
    (tab.url !== sender.tab.url &&
      !(
        message.type === "lime-capture" &&
        new URL(tab.url).origin === new URL(sender.tab.url).origin
      ))
  )
    throw new Error("标签页已变化或不是 HTTPS 页面，请重新选择。");
  if (["lime-pending", "lime-save", "lime-dismiss"].includes(message.type)) {
    const record = await getPending(tab);
    if (
      record &&
      (record.frameOrigin !== origin || record.frameId !== sender.frameId)
    ) {
      if (message.type === "lime-pending") return {};
      throw new Error("保存页面已变化，请从插件工具栏重新确认。");
    }
    return message.type === "lime-pending"
      ? { proposal: record?.proposal }
      : saveAction(message, tab, record);
  }
  if (message.type === "lime-capture") {
    if (
      !message.credential ||
      typeof message.credential.user !== "string" ||
      typeof message.credential.password !== "string" ||
      message.credential.user.length > 1024 ||
      !message.credential.password ||
      message.credential.password.length > 4096
    )
      throw new Error("账号信息无效。");
    let reply;
    try {
      reply = await native({
        operation: "capture",
        origin,
        page_url: pageKey(sender.url),
        id: null,
        credential: {
          user: message.credential.user,
          password: message.credential.password,
          password_change: message.credential.password_change === true,
        },
      });
    } finally {
      message.credential.password = "";
      message.credential.user = "";
    }
    if (reply.proposal) {
      await chrome.storage.session.set({
        [pendingKey(tab.id)]: {
          proposal: reply.proposal,
          topOrigin: new URL(tab.url).origin,
          frameOrigin: origin,
          frameId: sender.frameId,
          deadline: Date.now() + 115000,
        },
      });
    } else if (reply.unchanged) {
      await chrome.storage.session.remove(pendingKey(tab.id));
    }
    return reply;
  }
  if (message.type === "lime-list") {
    const reply = await native({
      operation: "list",
      origin,
      id: null,
      page_url: pageKey(sender.url),
    });
    return { entries: reply.entries, origin };
  }
  if (
    message.type !== "lime-fill" ||
    !Number.isSafeInteger(message.id) ||
    message.id < 1
  )
    throw new Error("填写请求无效。");
  const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
  const [prepared] = await chrome.scripting.executeScript({
    target,
    func: fillPage,
    args: ["prepare", origin, null, null],
  });
  if (prepared?.documentId !== sender.documentId || !prepared.result?.ticket)
    throw new Error(prepared?.result?.error || "请先打开登录表单。");
  let credential;
  try {
    ({ credential } = await native({
      operation: "fill",
      origin,
      id: message.id,
    }));
    const current = await chrome.tabs.get(sender.tab.id);
    if (!current.active || current.url !== tab.url)
      throw new Error("标签页已变化，已取消填写。");
    const [result] = await chrome.scripting.executeScript({
      target,
      func: fillPage,
      args: ["fill", origin, prepared.result.ticket, credential],
    });
    if (!result?.result?.filled)
      throw new Error(result?.result?.error || "登录表单已变化。");
    try {
      await native({
        operation: "remember",
        origin,
        id: message.id,
        page_url: pageKey(sender.url),
      });
    } catch {
      /* A preference failure must not report successful filling as a failure. */
    }
    return { filled: true };
  } finally {
    if (credential) {
      credential.user = "";
      credential.password = "";
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type?.startsWith("lime-toolbar-")) {
    handleToolbar(message, sender).then(respond, (error) =>
      respond({ error: error.message }),
    );
    return true;
  }
  if (
    ![
      "lime-list",
      "lime-fill",
      "lime-capture",
      "lime-pending",
      "lime-save",
      "lime-dismiss",
    ].includes(message?.type)
  )
    return false;
  handleSuggestion(message, sender).then(respond, (error) =>
    respond({ error: error.message }),
  );
  return true;
});
chrome.tabs.onRemoved?.addListener((id) => {
  void chrome.storage.session.remove(pendingKey(id));
});
