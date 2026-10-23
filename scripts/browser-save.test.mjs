import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function page(html, response = { unchanged: true }) {
  const dom = new JSDOM(html, {
    url: "https://example.com/login",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const messages = [];
  let listener, shadow;
  dom.window.HTMLInputElement.prototype.getClientRects = () => [
    { width: 100, height: 20 },
  ];
  const attach = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function (options) {
    shadow = attach.call(this, options);
    return shadow;
  };
  dom.window.chrome = {
    runtime: {
      id: "test",
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
      async sendMessage(message) {
        messages.push(structuredClone(message));
        return message.type === "lime-capture" ? response : {};
      },
    },
  };
  dom.window.eval(
    readFileSync(new URL("../extension/capture.js", import.meta.url), "utf8"),
  );
  return {
    dom,
    messages,
    get shadow() {
      return shadow;
    },
    async manual() {
      return new Promise((resolve) =>
        listener({ type: "lime-manual-save" }, { id: "test" }, resolve),
      );
    },
  };
}
test("collection reads only on explicit manual action and ignores synthetic page submissions", async () => {
  const p = page(
    `<form><input autocomplete="username" value="fictional"><input type="password" value="fictional-password"></form>`,
  );
  try {
    p.dom.window.document
      .querySelector("form")
      .dispatchEvent(new p.dom.window.Event("submit", { bubbles: true }));
    p.dom.window.document.querySelector("input").focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(p.messages.filter((m) => m.type === "lime-capture").length, 0);
    await p.manual();
    assert.deepEqual(
      p.messages.find((m) => m.type === "lime-capture").credential,
      {
        user: "fictional",
        password: "fictional-password",
        password_change: false,
      },
    );
  } finally {
    p.dom.window.close();
  }
});
test("password changes select the new password and require matching confirmation", async () => {
  for (const confirm of ["fictional-new", "different"]) {
    const p = page(
      `<form><input type="password" autocomplete="current-password" value="fictional-old"><input type="password" autocomplete="new-password" value="fictional-new"><input type="password" autocomplete="new-password" value="${confirm}"></form>`,
    );
    try {
      await p.manual();
      const request = p.messages.find((m) => m.type === "lime-capture");
      if (confirm === "different") assert.equal(request, undefined);
      else
        assert.deepEqual(request.credential, {
          user: "",
          password: "fictional-new",
          password_change: true,
        });
    } finally {
      p.dom.window.close();
    }
  }
});
test("cross-origin actions and ambiguous forms do not collect credentials", async () => {
  for (const html of [
    `<form action="https://evil.example"><input value="fictional"><input type="password" value="fictional-password"></form>`,
    `<form><input value="fictional"><input type="password" value="fictional-password"></form><form><input value="other"><input type="password" value="other-password"></form>`,
    `<form><input value="fictional"><input value="ambiguous"><input type="password" value="fictional-password"></form>`,
  ]) {
    const p = page(html);
    try {
      await p.manual();
      assert.equal(
        p.messages.filter((m) => m.type === "lime-capture").length,
        0,
      );
    } finally {
      p.dom.window.close();
    }
  }
});
test("save prompt renders metadata as text and page scripts cannot synthetically confirm", async () => {
  const p = page(
    `<form><input value="fictional"><input type="password" value="fictional-password"></form>`,
    {
      proposal: {
        ticket: "fictional-ticket",
        site: "https://example.com",
        user: "<img src=x>",
        can_create: true,
        entries: [],
      },
    },
  );
  try {
    await p.manual();
    assert.ok(p.dom.window.document.querySelector("[data-lime-save]"));
    assert.match(p.shadow.querySelector(".account").textContent, /<img src=x>/);
    assert.equal(p.shadow.querySelector("img"), null);
    p.shadow.querySelector(".primary").click();
    assert.equal(p.messages.filter((m) => m.type === "lime-save").length, 0);
  } finally {
    p.dom.window.close();
  }
});

const session = {},
  nativeCalls = [];
let currentUrl = "https://example.com/login",
  nativeReply = {};
globalThis.chrome = {
  runtime: {
    id: "test",
    getURL: (name) => `chrome-extension://test/${name}`,
    onMessage: { addListener() {} },
    async sendNativeMessage(_host, request) {
      nativeCalls.push(structuredClone(request));
      return nativeReply;
    },
  },
  storage: {
    session: {
      async get(key) {
        return { [key]: session[key] };
      },
      async set(value) {
        Object.assign(session, value);
      },
      async remove(key) {
        delete session[key];
      },
    },
  },
  tabs: {
    async get() {
      return { id: 1, active: true, url: currentUrl };
    },
    async query() {
      return [{ id: 1, active: true, url: currentUrl }];
    },
  },
};
const { handleSuggestion, handleToolbar } =
  await import("../extension/background.js");
const sender = () => ({
  id: "test",
  tab: { id: 1, url: currentUrl },
  url: currentUrl,
  origin: new URL(currentUrl).origin,
  documentId: "doc",
  frameId: 0,
});
test("pending prompts survive same-origin navigation without storing passwords and reject foreign frames/tabs", async () => {
  currentUrl = "https://example.com/login?token=fictional#secret";
  nativeReply = {
    proposal: {
      ticket: "fictional-ticket",
      site: "https://example.com",
      user: "demo",
      can_create: true,
      entries: [],
    },
  };
  const message = {
    type: "lime-capture",
    credential: { user: "demo", password: "fictional-secret" },
  };
  await handleSuggestion(message, sender());
  assert.equal(nativeCalls.at(-1).page_url, "https://example.com/login");
  assert.equal(message.credential.password, "");
  assert.equal(JSON.stringify(session).includes("fictional-secret"), false);
  currentUrl = "https://example.com/dashboard";
  assert.equal(
    (await handleSuggestion({ type: "lime-pending" }, sender())).proposal
      .ticket,
    "fictional-ticket",
  );
  assert.deepEqual(
    await handleSuggestion(
      { type: "lime-pending" },
      { ...sender(), frameId: 9 },
    ),
    {},
  );
  await assert.rejects(
    handleSuggestion(
      { type: "lime-save", ticket: "wrong", id: null },
      sender(),
    ),
  );
  await assert.rejects(
    handleSuggestion(
      { type: "lime-save", ticket: "fictional-ticket", id: null },
      { ...sender(), frameId: 9 },
    ),
  );
  const toolbar = { id: "test", url: "chrome-extension://test/popup.html" };
  assert.equal(
    (await handleToolbar({ type: "lime-toolbar-pending" }, toolbar)).proposal
      .ticket,
    "fictional-ticket",
  );
  await assert.rejects(
    handleToolbar(
      { type: "lime-toolbar-save" },
      { ...toolbar, tab: { id: 1 } },
    ),
  );
  nativeReply = { saved: true };
  assert.ok(
    (
      await handleSuggestion(
        { type: "lime-save", ticket: "fictional-ticket", id: null },
        sender(),
      )
    ).saved,
  );
  assert.equal(session["lime-pending-1"], undefined);
  session["lime-pending-1"] = {
    proposal: { ticket: "old" },
    topOrigin: "https://elsewhere.example",
    deadline: Date.now() + 5000,
  };
  assert.equal(
    (await handleSuggestion({ type: "lime-pending" }, sender())).proposal,
    undefined,
  );
});
test("a submission arriving after same-origin navigation is retained; cross-origin navigation is rejected", async () => {
  currentUrl = "https://example.com/login";
  const original = sender();
  currentUrl = "https://example.com/dashboard";
  nativeReply = {
    proposal: {
      ticket: "navigation-ticket",
      site: "https://example.com",
      user: "demo",
      can_create: true,
      entries: [],
    },
  };
  await handleSuggestion(
    {
      type: "lime-capture",
      credential: { user: "demo", password: "fictional-secret" },
    },
    original,
  );
  assert.equal(session["lime-pending-1"].proposal.ticket, "navigation-ticket");
  currentUrl = "https://elsewhere.example/dashboard";
  const count = nativeCalls.length;
  await assert.rejects(
    handleSuggestion(
      {
        type: "lime-capture",
        credential: { user: "demo", password: "fictional-secret" },
      },
      original,
    ),
  );
  assert.equal(nativeCalls.length, count);
});
