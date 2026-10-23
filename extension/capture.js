// Runs in the extension isolated world. Read fields only on submit/user action;
// no page messages, credential storage, network requests or automatic writes.
(() => {
  if (globalThis.__limeCaptureInstalled || location.protocol !== "https:")
    return;
  globalThis.__limeCaptureInstalled = true;
  let panel,
    shadow,
    proposal,
    timer,
    lastAttempt = 0,
    working = false;
  const visible = (input) =>
    input instanceof HTMLInputElement &&
    !input.disabled &&
    input.type !== "hidden" &&
    input.getClientRects().length > 0 &&
    getComputedStyle(input).visibility !== "hidden" &&
    getComputedStyle(input).display !== "none";
  function discover(scope) {
    const passwords = [
      ...scope.querySelectorAll('input[type="password"]'),
    ].filter((input) => visible(input) && !input.readOnly);
    if (!passwords.length || passwords.length > 3) return null;
    const form = passwords[0].form;
    if (passwords.some((input) => input.form !== form)) return null;
    const action = new URL(form?.action || location.href, location.href);
    if (action.origin !== location.origin || action.protocol !== "https:")
      return null;
    const candidates = [...scope.querySelectorAll("input")].filter(
      (input) =>
        visible(input) &&
        ["text", "email", "tel"].includes(input.type) &&
        !/captcha|verify|verification|验证码|搜索|search/i.test(
          `${input.name} ${input.id} ${input.placeholder} ${input.autocomplete}`,
        ),
    );
    const named = candidates.filter((input) =>
      ["username", "email"].includes(input.autocomplete),
    );
    const hinted = candidates.filter((input) =>
      /username|userid|loginname|loginid|account|email|phone|mobile|手机号|用户名|账号/i.test(
        `${input.name} ${input.id} ${input.placeholder}`,
      ),
    );
    const users = named.length ? named : hinted.length ? hinted : candidates;
    if (users.length > 1) return null;
    return {
      passwords,
      user: users[0],
      form,
      focused: [...passwords, ...users].includes(document.activeElement),
    };
  }
  function choose(scope) {
    if (scope) return discover(scope);
    const forms = [...document.forms].map(discover).filter(Boolean);
    if (!forms.length) return discover(document);
    const focused = forms.filter((form) => form.focused);
    return (focused.length ? focused : forms).length === 1
      ? focused[0] || forms[0]
      : null;
  }
  // Probe returns booleans only. The worker invokes it before manual collection.
  globalThis.__limeCaptureProbe = () => {
    const fields = choose();
    return fields ? { focused: fields.focused } : null;
  };
  function read(fields) {
    const fresh = fields.passwords.filter(
      (input) =>
        input.autocomplete === "new-password" ||
        /new.?pass|confirm.?pass|repeat.?pass|新密码|确认密码/i.test(
          `${input.name} ${input.id} ${input.placeholder}`,
        ),
    );
    let password;
    if (fresh.length) {
      const following = fields.passwords.slice(
        fields.passwords.indexOf(fresh[0]),
      );
      if (
        fresh.some((input) => !input.value) ||
        fresh.some((input) => input.value !== fresh[0].value) ||
        following.some((input) => input.value !== fresh[0].value)
      )
        return null;
      password = fresh[0].value;
    } else if (fields.passwords.length === 1)
      password = fields.passwords[0].value;
    else if (
      fields.passwords.length === 2 &&
      fields.passwords[0].value === fields.passwords[1].value
    )
      password = fields.passwords[0].value;
    else if (
      fields.passwords.length === 3 &&
      fields.passwords[1].value === fields.passwords[2].value
    )
      password = fields.passwords[1].value;
    else return null;
    const password_change = fields.passwords.length > 1 || fresh.length > 0;
    const user = fields.user?.value || "";
    if (
      !password ||
      (!user && !password_change) ||
      user.length > 1024 ||
      password.length > 4096
    )
      return null;
    return { user, password, password_change };
  }
  function close() {
    clearTimeout(timer);
    panel?.remove();
    panel = shadow = proposal = null;
  }
  function surface() {
    close();
    panel = document.createElement("div");
    panel.setAttribute("data-lime-save", "");
    Object.assign(panel.style, {
      position: "fixed",
      top: "18px",
      right: "18px",
      width: "340px",
      maxWidth: "calc(100vw - 36px)",
      zIndex: "2147483647",
      colorScheme: "light dark",
    });
    shadow = panel.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      :host{font:13px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}.panel{background:#fffaf3;color:#3d3028;border:1px solid #e7dccd;border-radius:16px;box-shadow:0 12px 36px #0003;padding:18px}header{display:flex;align-items:center;justify-content:space-between;color:#aa5b24;font-weight:600}p{margin:10px 0;overflow-wrap:anywhere}.hint{font-size:11px;opacity:.7}button,select{font:inherit;color:inherit;border:1px solid #dfcfbb;border-radius:9px;padding:8px 12px;background:transparent}button{cursor:pointer}button:focus-visible,select:focus-visible{outline:2px solid #ed9b40;outline-offset:2px}header button{border:0;padding:0 5px}select{width:100%;margin:6px 0}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.primary{background:#f3ae58;color:#322414;border-color:#f3ae58}button:disabled{opacity:.5}.message{font-size:12px} @media(prefers-color-scheme:dark){.panel{background:#282521;color:#f3eade;border-color:#494139}header{color:#ffbc78}button,select{border-color:#655443}select{background:#282521}}
    </style><section class="panel" role="dialog" aria-label="酸橙保存账号"><header><span class="title"></span><button class="close" aria-label="关闭保存提示">×</button></header><p class="account"></p><p class="hint">确认网站登录或改密成功后，再保存到收藏室。</p><select aria-label="选择要更新的账号" hidden></select><p class="message" role="status"></p><div class="actions"><button class="later">暂不</button><button class="primary">保存</button></div></section>`;
    document.documentElement.append(panel);
    for (const selector of [".close", ".later"])
      shadow.querySelector(selector).addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        if (proposal)
          void chrome.runtime
            .sendMessage({ type: "lime-dismiss", ticket: proposal.ticket })
            .catch(() => {});
        close();
      });
  }
  function show(record) {
    surface();
    proposal = record;
    const currentTicket = record.ticket;
    shadow.querySelector(".title").textContent = record.can_create
      ? "◉ 酸橙 · 保存账号"
      : "◉ 酸橙 · 更新密码";
    shadow.querySelector(".account").textContent =
      `${record.user || "选择需要更新的账号"} · ${record.site}`;
    const select = shadow.querySelector("select");
    if (!record.can_create) {
      select.hidden = false;
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "选择要更新的账号";
      select.append(placeholder);
      for (const entry of record.entries) {
        const option = document.createElement("option");
        option.value = String(entry.id);
        option.textContent = `${entry.name} · ${entry.user}`;
        select.append(option);
      }
      if (record.entries.length === 1)
        select.value = String(record.entries[0].id);
    }
    const save = shadow.querySelector(".primary");
    save.textContent = record.can_create ? "保存账号" : "更新密码";
    save.addEventListener("click", async (event) => {
      if (!event.isTrusted || working || proposal?.ticket !== currentTicket)
        return;
      if (!record.can_create && !select.value) {
        shadow.querySelector(".message").textContent = "请选择要更新的账号。";
        return;
      }
      working = true;
      save.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({
          type: "lime-save",
          ticket: currentTicket,
          id: record.can_create ? null : Number(select.value),
        });
        if (proposal?.ticket !== currentTicket) return;
        if (result.error) throw new Error(result.error);
        shadow.querySelector(".message").textContent = "已保存到收藏室。";
        clearTimeout(timer);
        timer = setTimeout(close, 1600);
      } catch (error) {
        if (proposal?.ticket === currentTicket) {
          shadow.querySelector(".message").textContent = error.message;
          save.disabled = false;
        }
      } finally {
        working = false;
      }
    });
    timer = setTimeout(close, 115000);
  }
  function notice(message) {
    surface();
    shadow.querySelector(".title").textContent = "◉ 酸橙";
    shadow.querySelector(".message").textContent = message;
    shadow.querySelector(".hint").hidden = true;
    shadow.querySelector(".primary").hidden = true;
    timer = setTimeout(close, 8000);
  }
  async function capture(scope, manual = false) {
    if (
      document.visibilityState !== "visible" ||
      location.protocol !== "https:"
    )
      return {};
    if (!manual && Date.now() - lastAttempt < 1200) return {};
    const fields = choose(scope);
    const credential = fields && read(fields);
    if (!credential) {
      if (manual)
        notice(
          "请填写账号和密码；新密码与确认密码需一致。复杂表单可使用悬浮窗保存。",
        );
      return {};
    }
    lastAttempt = Date.now();
    try {
      const result = await chrome.runtime.sendMessage({
        type: "lime-capture",
        credential,
      });
      if (result.proposal) show(result.proposal);
      else if (result.error) notice(result.error);
      else if (manual && result.unchanged)
        notice("这个账号与密码已经保存在收藏室。​");
      return { captured: true, error: result.error };
    } catch {
      if (manual) notice("连接暂不可用，请打开酸橙并解锁后重试。");
      return {};
    } finally {
      credential.password = "";
      credential.user = "";
    }
  }
  document.addEventListener(
    "submit",
    (event) => {
      if (
        event.submitter?.hasAttribute("formaction") &&
        new URL(event.submitter.formAction, location.href).origin !==
          location.origin
      )
        return;
      if (event.isTrusted) void capture(event.target);
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) return;
      const button = event.target.closest?.(
        "button,input[type=submit],[role=button]",
      );
      if (
        button?.hasAttribute("formaction") &&
        new URL(button.formAction, location.href).origin !== location.origin
      )
        return;
      if (
        button &&
        (button.type === "submit" ||
          /登录|注册|保存|修改密码|确认修改|sign.?in|log.?in|sign.?up|register|save|change.?password|update.?password/i.test(
            button.textContent || button.value || "",
          ))
      )
        void capture(button.form || undefined);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.isTrusted &&
        event.key === "Enter" &&
        event.target instanceof HTMLInputElement
      )
        void capture(event.target.form || undefined);
    },
    true,
  );
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab ||
      message?.type !== "lime-manual-save"
    )
      return false;
    void capture(undefined, true).then(respond);
    return true;
  });
  async function restore() {
    if (document.visibilityState !== "visible" || proposal) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "lime-pending" });
      if (result.proposal) show(result.proposal);
    } catch {
      /* No prompt without a pending operation. */
    }
  }
  void restore();
  setTimeout(restore, 600);
  setTimeout(restore, 1800);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void restore();
  });
  window.addEventListener("pagehide", close);
})();
