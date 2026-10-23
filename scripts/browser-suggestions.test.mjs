import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const calls = [];
globalThis.chrome = {
  runtime: {
    id: "test-extension",
    onMessage: { addListener() {} },
    async sendNativeMessage(_host, request) {
      calls.push(["native", request]);
      return request.operation === "list"
        ? { entries: [] }
        : { credential: { user: "fictional", password: "fictional-secret" } };
    },
  },
  tabs: {
    async get() {
      return { id: 1, active: true, url: "https://v1.chaoxing.com/login" };
    },
  },
  scripting: {
    async executeScript(options) {
      calls.push(["script", structuredClone(options.args), options.target]);
      return [
        {
          documentId: "doc-1",
          result:
            options.args[0] === "prepare"
              ? { ticket: "ticket" }
              : { filled: true },
        },
      ];
    },
  },
};
const { handleSuggestion } = await import("../extension/background.js");
const sender = {
  id: "test-extension",
  tab: { id: 1, url: "https://v1.chaoxing.com/login" },
  url: "https://passport2.chaoxing.com/login",
  origin: "https://passport2.chaoxing.com",
  documentId: "doc-1",
  frameId: 2,
};

test("inline suggestions query metadata only and bind a chosen fill to its HTTPS document", async () => {
  calls.length = 0;
  await handleSuggestion({ type: "lime-list" }, sender);
  assert.deepEqual(calls, [
    [
      "native",
      {
        operation: "list",
        origin: sender.origin,
        id: null,
        page_url: sender.url,
      },
    ],
  ]);
  calls.length = 0;
  const result = await handleSuggestion({ type: "lime-fill", id: 7 }, sender);
  assert.ok(result.filled);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["script", "native", "script", "native"],
  );
  assert.equal(calls[1][1].origin, sender.origin);
  assert.deepEqual(calls[2][2], { tabId: 1, documentIds: ["doc-1"] });
  assert.equal(result.credential, undefined);
});
test("invalid senders and navigation cannot deliver a credential to the page", async () => {
  for (const invalid of [
    { ...sender, id: "other" },
    { ...sender, documentId: undefined },
    { ...sender, origin: "https://evil.invalid" },
    {
      ...sender,
      url: "http://passport2.chaoxing.com/login",
      origin: "http://passport2.chaoxing.com",
    },
  ]) {
    calls.length = 0;
    await assert.rejects(
      handleSuggestion({ type: "lime-fill", id: 7 }, invalid),
    );
    assert.equal(calls.length, 0);
  }
  const original = chrome.tabs.get;
  let count = 0;
  chrome.tabs.get = async () => ({
    id: 1,
    active: true,
    url: ++count === 1 ? sender.tab.url : "https://elsewhere.invalid",
  });
  calls.length = 0;
  try {
    await assert.rejects(
      handleSuggestion({ type: "lime-fill", id: 7 }, sender),
    );
    assert.equal(calls.filter((c) => c[0] === "script").length, 1);
  } finally {
    chrome.tabs.get = original;
  }
});

test("page focus activates suggestions without toolbar clicks, selection fills only on click", async () => {
  const dom = new JSDOM(
    '<form><input id="user" autocomplete="username"><input type="password"></form>',
    {
      url: "https://example.invalid/login",
      pretendToBeVisual: true,
      runScripts: "outside-only",
    },
  );
  const messages = [];
  let shadow;
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
      async sendMessage(message) {
        messages.push(message);
        return message.type === "lime-list"
          ? {
              entries: [
                {
                  id: 1,
                  name: "Demo",
                  user: "fictional-user",
                  site: "https://example.invalid",
                },
              ],
            }
          : { filled: true };
      },
    },
  };
  dom.window.eval(
    readFileSync(
      new URL("../extension/suggestions.js", import.meta.url),
      "utf8",
    ),
  );
  dom.window.document.querySelector("#user").focus();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "lime-list");
  assert.ok(dom.window.document.querySelector("[data-lime-suggestions]"));
  shadow.querySelector(".items button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(messages[1].type, "lime-fill");
  assert.equal(
    dom.window.document.querySelector("[data-lime-suggestions]"),
    null,
  );
  dom.window.close();
});

test("toolbar picker locates the login iframe and binds credentials to its origin and document", async () => {
  const dom = new JSDOM(
    readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8"),
    { url: "https://extension.invalid", pretendToBeVisual: true },
  );
  const originalChrome = globalThis.chrome,
    originalDocument = globalThis.document;
  const messages = [],
    scripts = [];
  const tab = { id: 1, url: "https://v1.chaoxing.com/backSchool/toLogin" };
  globalThis.document = dom.window.document;
  globalThis.chrome = {
    tabs: {
      async query() {
        return [tab];
      },
    },
    runtime: {
      async sendMessage() {
        return {};
      },
      async sendNativeMessage(_host, request) {
        messages.push(request);
        return request.operation === "list"
          ? {
              entries: [
                {
                  id: 7,
                  name: "Demo",
                  user: "fictional",
                  site: "https://passport2.chaoxing.com",
                },
              ],
            }
          : { credential: { user: "fictional", password: "fictional-secret" } };
      },
    },
    scripting: {
      async executeScript(options) {
        scripts.push({
          target: options.target,
          args: structuredClone(options.args),
        });
        return options.args[0] === "probe"
          ? [
              { frameId: 0, documentId: "top", result: { error: "no form" } },
              {
                frameId: 2,
                documentId: "login-doc",
                result: {
                  ticket: "login-ticket",
                  origin: "https://passport2.chaoxing.com",
                  focused: true,
                },
              },
            ]
          : [{ documentId: "login-doc", result: { filled: true } }];
      },
    },
  };
  try {
    await import("../extension/popup.js");
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector("#accounts button").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(messages[1], {
      operation: "fill",
      origin: "https://passport2.chaoxing.com",
      id: 7,
    });
    assert.deepEqual(scripts[0].target, { tabId: 1, allFrames: true });
    assert.deepEqual(scripts[2].target, {
      tabId: 1,
      documentIds: ["login-doc"],
    });
    assert.equal(scripts[2].args[1], "https://passport2.chaoxing.com");
    assert.equal(messages[0].origin, "https://passport2.chaoxing.com");
    assert.match(document.querySelector("#status").textContent, /已填写/);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.document = originalDocument;
    dom.window.close();
  }
});
