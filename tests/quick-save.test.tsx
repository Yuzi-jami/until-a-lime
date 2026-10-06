import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import QuickSave from "../src/QuickSave";
import CategoryOrganizer from "../src/CategoryOrganizer";
import UsageGuide from "../src/UsageGuide";
import App from "../src/App";
import { listen } from "@tauri-apps/api/event";
import {
  siteDetails,
  suggestCategory,
  unresolvedHosts,
  type SaveContext,
} from "../src/categories";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: ipc.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
const entry = {
  id: 3,
  name: "Steam",
  user: "fictional-user",
  url: "https://store.steampowered.com/login",
  category: "生活",
  note: "fictional note",
  favorite: true,
  icon: "S",
};
const context: SaveContext = { entries: [entry], rules: {}, epoch: 7 };
beforeEach(() => {
  ipc.invoke.mockReset().mockResolvedValue(undefined);
  vi.mocked(listen).mockClear();
});

test("expanded catalog handles academic, gaming and developer sites with specific subdomain priority", () => {
  for (const [site, category] of [
    ["jwxt.wit.edu.cn", "学习"],
    ["future.example.edu.cn", "学习"],
    ["codeforces.com", "学习"],
    ["login.moocollege.com", "学习"],
    ["user.hypergryph.com", "游戏"],
    ["id.unity.com", "工作"],
    ["accounts.pixiv.net", "娱乐"],
    ["share.weiyun.com", "工具"],
    ["cg.163.com", "游戏"],
    ["dl.reg.163.com", "工具"],
    ["ui.ptlogin2.qq.com", "社交"],
    ["mail.qq.com", "工具"],
    ["chat.zju.edu.cn", "工具"],
    ["zwfw.mps.gov.cn", "生活"],
    ["10.1.2.3", "未分类"],
    ["localhost", "未分类"],
    ["unknown-portal.invalid", "未分类"],
    ["evilwit.edu.cn.attacker.invalid", "未分类"],
    ["notcodeforces.com", "未分类"],
    ["unity.com.attacker.invalid", "未分类"],
  ])
    expect(suggestCategory(`https://${site}/login`, "", {})).toBe(category);
  expect(
    suggestCategory("https://jwxt.wit.edu.cn", "", {
      "jwxt.wit.edu.cn": "我的学校",
    }),
  ).toBe("我的学校");
  expect(
    suggestCategory("https://codeforces.com", "", {
      "codeforces.com": "未分类",
    }),
  ).toBe("未分类");
});

test("shareable unresolved list strips credentials, paths, queries and fragments and deduplicates", () => {
  const rows = [
    {
      ...entry,
      url: "https://fictional-user:fictional-secret@unknown.invalid/login?token=fictional-token#private",
      name: "private-name",
    },
    { ...entry, url: "https://www.unknown.invalid/other" },
    { ...entry, url: "https://codeforces.com" },
    { ...entry, url: "not a url" },
    { ...entry, url: "file:///C:/private" },
  ];
  expect(unresolvedHosts(rows, {})).toEqual(["unknown.invalid"]);
});

test("organizer offers a read-only domain list for the current unresolved scope", () => {
  render(
    <CategoryOrganizer
      entries={[
        {
          ...entry,
          url: "https://unknown.invalid/login?token=fictional-token",
          name: "Unknown",
          category: "未分类",
        },
        { ...entry, id: 4, url: "https://codeforces.com", category: "未分类" },
        { ...entry, id: 5, url: "https://other.invalid", category: "工作" },
      ]}
      persistent={false}
      busy={false}
      onApply={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("整理范围"), {
    target: { value: "group:未分类" },
  });
  fireEvent.click(screen.getByRole("button", { name: "更多" }));
  fireEvent.click(screen.getByRole("button", { name: "查看待识别域名" }));
  const field = screen.getByLabelText("待识别域名") as HTMLTextAreaElement;
  expect(field.readOnly).toBe(true);
  expect(field.value).toBe("unknown.invalid");
  fireEvent.change(screen.getByLabelText("筛选待分类账号"), {
    target: { value: "codeforces" },
  });
  expect(field.value).toBe("");
});

test("the main collection refreshes metadata after a floating save notification", async () => {
  const added = { ...entry, id: 8, name: "New fictional account" };
  ipc.invoke.mockImplementation(async (command) => {
    if (command === "vault_list") return [entry, added];
    if (command === "vault_strengths") return [];
  });
  render(<App initialEntries={[entry]} persistent onVaultLock={vi.fn()} />);
  await waitFor(() =>
    expect(
      vi
        .mocked(listen)
        .mock.calls.some((call) => call[0] === "lime-vault-changed"),
    ).toBe(true),
  );
  const notify = vi
    .mocked(listen)
    .mock.calls.find((call) => call[0] === "lime-vault-changed")![1];
  act(() => notify({ event: "lime-vault-changed", id: 1, payload: null }));
  expect(
    await screen.findByRole("button", { name: "查看 New fictional account" }),
  ).toBeTruthy();
  expect(ipc.invoke.mock.calls.some((call) => call[0] === "vault_reveal")).toBe(
    false,
  );
});

test("site suggestions stay local, respect confirmed rules and reject lookalike domains", () => {
  expect(suggestCategory("https://passport2.chaoxing.com/login", "", {})).toBe(
    "学习",
  );
  expect(suggestCategory("https://chaoxing.com.attacker.invalid", "", {})).toBe(
    "未分类",
  );
  expect(suggestCategory("https://evilchaoxing.com", "", {})).toBe("未分类");
  expect(
    suggestCategory(entry.url, entry.name, {
      "store.steampowered.com": "休闲",
    }),
  ).toBe("休闲");
  expect(suggestCategory("unknown.invalid", "constructor", {})).toBe("未分类");
  expect(siteDetails("example.invalid/login")).toEqual({
    name: "example.invalid",
    url: "https://example.invalid/login",
  });
  expect(siteDetails("Steam")).toEqual({ name: "Steam", url: "Steam" });
  expect(() => siteDetails("javascript://anything")).toThrow();
  expect(() => siteDetails("https://user:fictional@example.invalid")).toThrow();
});

test("quick save keeps a masked draft across generator navigation and saves only on request", async () => {
  const saved = vi.fn();
  render(<QuickSave context={context} onClose={vi.fn()} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("网站 / 应用"), {
    target: { value: "passport2.chaoxing.com" },
  });
  fireEvent.change(screen.getByLabelText("账号"), {
    target: { value: "fictional" },
  });
  expect((screen.getByLabelText("分类") as HTMLSelectElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "使用建议：学习" }));
  expect((screen.getByLabelText("分类") as HTMLSelectElement).value).toBe(
    "group:学习",
  );
  fireEvent.click(screen.getByRole("button", { name: "生成", exact: true }));
  const generated = screen.getByLabelText("生成的密码").textContent;
  fireEvent.click(
    screen.getByRole("button", { name: "使用密码", exact: true }),
  );
  expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe(
    generated,
  );
  expect((screen.getByLabelText("密码") as HTMLInputElement).type).toBe(
    "password",
  );
  expect((screen.getByLabelText("账号") as HTMLInputElement).value).toBe(
    "fictional",
  );
  expect(ipc.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "加密保存" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(ipc.invoke).toHaveBeenCalledWith(
    "quick_save_account",
    expect.objectContaining({
      epoch: 7,
      password: generated,
      updateId: null,
      separate: false,
      entry: expect.objectContaining({
        id: 0,
        category: "学习",
        url: "https://passport2.chaoxing.com/",
      }),
    }),
  );
  expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
});

test("saving with an empty category uses unclassified, and all groups remain selectable", async () => {
  render(<QuickSave context={context} onClose={vi.fn()} onSaved={vi.fn()} />);
  const picker = screen.getByLabelText("分类") as HTMLSelectElement;
  expect(picker.value).toBe("");
  expect(
    within(picker).getByRole("option", { name: "游戏", exact: true }),
  ).toBeTruthy();
  expect(
    within(picker).getByRole("option", { name: "学习", exact: true }),
  ).toBeTruthy();
  fireEvent.change(picker, { target: { value: "group:游戏" } });
  expect(picker.value).toBe("group:游戏");
  fireEvent.change(picker, { target: { value: "group:学习" } });
  expect(picker.value).toBe("group:学习");
  fireEvent.change(picker, { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("网站 / 应用"), {
    target: { value: "example.invalid" },
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: "fictional-only" },
  });
  fireEvent.click(screen.getByRole("button", { name: "加密保存" }));
  await waitFor(() =>
    expect(ipc.invoke).toHaveBeenCalledWith(
      "quick_save_account",
      expect.objectContaining({
        entry: expect.objectContaining({ category: "未分类" }),
      }),
    ),
  );
});

test("usage guide hides detailed instructions until requested and omits implementation jargon", () => {
  const { container } = render(<UsageGuide />);
  expect(screen.queryByText(/React|TypeScript|Tauri|当前运行环境/)).toBeNull();
  expect(container.querySelectorAll("details[open]").length).toBe(0);
  expect(screen.getByText("使用方法")).toBeTruthy();
});

test("duplicates require an explicit selection and failed saves preserve the draft", async () => {
  ipc.invoke.mockRejectedValue("fictional write failure");
  render(<QuickSave context={context} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("网站 / 应用"), {
    target: { value: "store.steampowered.com" },
  });
  fireEvent.change(screen.getByLabelText("账号"), {
    target: { value: entry.user },
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: "fictional-new" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "加密保存" }).closest("form")!,
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(ipc.invoke).not.toHaveBeenCalled();
  fireEvent.change(
    screen.getByRole("combobox", { name: /已有相同网站和账号/ }),
    { target: { value: "3" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "加密保存" }));
  await screen.findByText("fictional write failure");
  expect(ipc.invoke).toHaveBeenCalledWith(
    "quick_save_account",
    expect.objectContaining({ updateId: 3, separate: false }),
  );
  expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe(
    "fictional-new",
  );
});

test("late save completion after unmount does not reopen or report a cleared draft", async () => {
  let resolve!: () => void;
  ipc.invoke.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const saved = vi.fn();
  const view = render(
    <QuickSave context={context} onClose={vi.fn()} onSaved={saved} />,
  );
  fireEvent.change(screen.getByLabelText("网站 / 应用"), {
    target: { value: "example.invalid" },
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: "fictional-only" },
  });
  fireEvent.click(screen.getByRole("button", { name: "加密保存" }));
  view.unmount();
  await act(async () => resolve());
  expect(saved).not.toHaveBeenCalled();
});

test("manual grouping filters and selects records before choosing a complete category list", async () => {
  const apply = vi.fn(async () => true);
  render(
    <CategoryOrganizer
      entries={[
        entry,
        {
          ...entry,
          id: 4,
          name: "Unknown",
          url: "unknown.invalid",
          category: "未分类",
        },
      ]}
      persistent={false}
      onApply={apply}
      busy={false}
    />,
  );
  expect(screen.getByText("Steam")).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("筛选待分类账号"), {
    target: { value: "Unknown" },
  });
  fireEvent.click(screen.getByLabelText("全选当前列表"));
  fireEvent.change(screen.getByLabelText("移至分类"), {
    target: { value: "new" },
  });
  fireEvent.change(screen.getByLabelText("新分类名称"), {
    target: { value: "个人项目" },
  });
  fireEvent.click(screen.getByRole("button", { name: "移动所选" }));
  await waitFor(() =>
    expect(apply).toHaveBeenLastCalledWith([4], "个人项目", false),
  );
  expect(
    within(screen.getByText("Unknown").closest("label")!).getByText("未分类"),
  ).toBeTruthy();
});
