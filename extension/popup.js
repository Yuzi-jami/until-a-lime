import { fillPage } from "./fill.js";
const host = "dev.untilalime.browser";
const status = document.getElementById("status"),
  accounts = document.getElementById("accounts");
const retry = document.getElementById("retry");
let active = null,
  working = false;
async function pendingSave() {
  const area = document.getElementById("pending");
  const record = await chrome.runtime.sendMessage({
    type: "lime-toolbar-pending",
  });
  if (!record.proposal) {
    area.hidden = true;
    return;
  }
  const proposal = record.proposal;
  area.hidden = false;
  document.getElementById("pending-label").textContent =
    `${proposal.can_create ? "保存账号" : "更新密码"} · ${proposal.user || proposal.site}`;
  const select = document.getElementById("pending-account");
  select.replaceChildren();
  select.hidden = proposal.can_create;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "选择要更新的账号";
  select.append(placeholder);
  for (const entry of proposal.entries) {
    const option = document.createElement("option");
    option.value = String(entry.id);
    option.textContent = `${entry.name} · ${entry.user}`;
    select.append(option);
  }
  if (proposal.entries.length === 1)
    select.value = String(proposal.entries[0].id);
  const save = document.getElementById("confirm-save");
  save.textContent = proposal.can_create ? "保存账号" : "更新密码";
  save.onclick = async () => {
    if (!proposal.can_create && !select.value) {
      status.textContent = "请选择要更新的账号。";
      return;
    }
    save.disabled = true;
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "lime-toolbar-save",
        ticket: proposal.ticket,
        id: proposal.can_create ? null : Number(select.value),
      });
      if (reply.error) throw new Error(reply.error);
      area.hidden = true;
      await load();
      status.textContent = "已保存到收藏室。";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      save.disabled = false;
    }
  };
  document.getElementById("dismiss-save").onclick = async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "lime-toolbar-dismiss",
        ticket: proposal.ticket,
      });
      area.hidden = true;
    } catch (error) {
      status.textContent = error.message;
    }
  };
}
async function native(request) {
  const reply = await chrome.runtime.sendNativeMessage(host, request);
  if (reply.error) throw new Error(reply.error);
  return reply;
}
async function current() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("请选择普通网站标签页。");
  const url = new URL(tab.url);
  if (url.protocol !== "https:") throw new Error("只为 HTTPS 网站填写。");
  return { tabId: tab.id, origin: url.origin, url: tab.url };
}
async function load() {
  if (working) return;
  accounts.replaceChildren();
  working = true;
  retry.disabled = true;
  try {
    active = await current();
    let context = { origin: active.origin, page_url: active.url };
    try {
      const frames = await chrome.scripting.executeScript({
        target: { tabId: active.tabId, allFrames: true },
        func: fillPage,
        args: ["probe", null, null, null],
      });
      const candidates = frames.filter(
        (frame) => frame.documentId && frame.result?.ticket,
      );
      const focused = candidates.filter((frame) => frame.result.focused);
      const choices = focused.length ? focused : candidates;
      if (choices.length === 1)
        context = {
          origin: choices[0].result.origin,
          page_url: choices[0].result.page_url || choices[0].result.origin,
        };
    } catch {
      /* Pages without a login form still support saved account listing. */
    }
    document.getElementById("site").textContent = context.origin;
    const reply = await native({
      operation: "list",
      origin: context.origin,
      id: null,
      page_url: context.page_url,
    });
    status.textContent = reply.entries.length
      ? "选择一个账号自动填写。"
      : "没有匹配账号。请在收藏室确认此网站的网址。";
    for (const entry of reply.entries) {
      const button = document.createElement("button"),
        user = document.createElement("span");
      button.textContent = entry.name;
      user.textContent = entry.user || "未填写用户名";
      button.append(user);
      if (entry.site) {
        const site = document.createElement("small");
        try {
          site.textContent = new URL(
            entry.site.includes("://") ? entry.site : `https://${entry.site}`,
          ).host;
        } catch {
          site.textContent = "";
        }
        button.append(site);
      }
      button.addEventListener("click", () => void fill(entry.id));
      accounts.append(button);
    }
    await pendingSave();
  } catch (error) {
    status.textContent = `${error.message} 如尚未验证，请先在酸橙收藏室验证主密码，再刷新。`;
  } finally {
    working = false;
    retry.disabled = false;
  }
}
async function fill(id) {
  if (working || !active) return;
  working = true;
  retry.disabled = true;
  for (const el of accounts.children) el.disabled = true;
  let credential;
  try {
    const now = await current();
    if (now.tabId !== active.tabId || now.url !== active.url)
      throw new Error("标签页已变化，请刷新账号。");
    const frames = await chrome.scripting.executeScript({
      target: { tabId: now.tabId, allFrames: true },
      func: fillPage,
      args: ["probe", null, null, null],
    });
    const candidates = frames.filter(
      (frame) => frame.documentId && frame.result?.ticket,
    );
    const focused = candidates.filter((frame) => frame.result.focused);
    const choices = focused.length ? focused : candidates;
    if (choices.length !== 1)
      throw new Error(
        "未找到唯一登录表单，请直接点击要填写的登录输入框，使用酸橙账号建议。",
      );
    const prepared = choices[0];
    ({ credential } = await native({
      operation: "fill",
      origin: prepared.result.origin,
      id,
    }));
    const later = await current();
    if (later.tabId !== now.tabId || later.url !== now.url)
      throw new Error("页面已变化，已取消填写。");
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: now.tabId, documentIds: [prepared.documentId] },
      func: fillPage,
      args: [
        "fill",
        prepared.result.origin,
        prepared.result.ticket,
        credential,
      ],
    });
    if (!result?.result?.filled)
      throw new Error(result?.result?.error || "页面已变化，已取消填写。");
    try {
      await native({
        operation: "remember",
        origin: prepared.result.origin,
        id,
        page_url: prepared.result.page_url || prepared.result.origin,
      });
    } catch {
      /* Filling already succeeded. */
    }
    status.textContent = "已填写。请核对后自行登录。";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    if (credential) {
      credential.user = "";
      credential.password = "";
      credential = null;
    }
    working = false;
    retry.disabled = false;
    for (const el of accounts.children) el.disabled = false;
  }
}
retry.addEventListener("click", () => void load());
document.getElementById("save-current").addEventListener("click", async () => {
  try {
    const reply = await chrome.runtime.sendMessage({
      type: "lime-toolbar-manual",
    });
    if (reply?.error) throw new Error(reply.error);
    await pendingSave();
    status.textContent = reply?.captured
      ? "请核对保存提示。"
      : "请在页面填写账号与密码后重试。";
  } catch (error) {
    status.textContent = error.message;
  }
});
void load();
