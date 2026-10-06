import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import App from "../src/App";
import CategoryOrganizer from "../src/CategoryOrganizer";
import { groupingSuggestions } from "../src/categories";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: ipc.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
const entries = [
  {
    id: 1,
    name: "Steam",
    url: "https://store.steampowered.com",
    category: "工作",
    user: "fictional",
    note: "",
    favorite: false,
    icon: "S",
  },
  {
    id: 2,
    name: "学习通",
    url: "https://passport2.chaoxing.com",
    category: "工作",
    user: "fictional",
    note: "",
    favorite: false,
    icon: "L",
  },
  {
    id: 3,
    name: "Unknown",
    url: "https://unknown.invalid",
    category: "工作",
    user: "fictional",
    note: "",
    favorite: false,
    icon: "U",
  },
];
beforeEach(() => {
  ipc.invoke.mockReset().mockImplementation(async (command) => {
    if (command === "quick_save_context")
      return {
        entries,
        epoch: 1,
        rules: {
          "store.steampowered.com": "工作",
          "passport2.chaoxing.com": "工作",
        },
      };
    if (command === "vault_strengths") return [];
  });
});

test("catalog correction ignores poisoned remembered groups and leaves unknown sites untouched", async () => {
  const apply = vi.fn(async () => true),
    regroup = vi.fn(async () => true);
  render(
    <CategoryOrganizer
      entries={entries}
      persistent
      busy={false}
      onApply={apply}
      onRegroup={regroup}
    />,
  );
  await waitFor(() =>
    expect(ipc.invoke).toHaveBeenCalledWith("quick_save_context"),
  );
  expect(screen.queryByText("Unknown")).toBeNull();
  expect(screen.getByText("游戏", { selector: "b" })).toBeTruthy();
  expect(screen.getByText("学习", { selector: "b" })).toBeTruthy();
  expect(regroup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "应用 2 项建议" }));
  await waitFor(() =>
    expect(regroup).toHaveBeenCalledWith(
      [
        { id: 1, from: "工作", category: "游戏" },
        { id: 2, from: "工作", category: "学习" },
      ],
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "更多" }));
  fireEvent.change(screen.getByLabelText("分组建议来源"), {
    target: { value: "remembered" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "返回列表" })[0]);
  expect(screen.getByText("暂时没有需要调整的分类")).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
});

test("failed correction keeps preview available and does not claim success", async () => {
  render(
    <CategoryOrganizer
      entries={entries}
      persistent={false}
      busy={false}
      onApply={vi.fn()}
      onRegroup={vi.fn(async () => false)}
    />,
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "应用 2 项建议" })),
  );
  expect(screen.getByRole("button", { name: "应用 2 项建议" })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

test("quick group updates metadata through a dedicated command without revealing or replacing passwords", async () => {
  ipc.invoke.mockImplementation(async (command) => {
    if (command === "vault_strengths") return [];
    if (command === "vault_regroup")
      return [{ ...entries[0], category: "游戏" }];
  });
  render(
    <App initialEntries={[entries[0]]} persistent onVaultLock={vi.fn()} />,
  );
  fireEvent.click(screen.getByText(/分组 · 工作/));
  fireEvent.change(screen.getByLabelText("更换分组"), {
    target: { value: "游戏" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用分组" }));
  await screen.findByText(/分组 · 游戏/);
  expect(ipc.invoke).toHaveBeenCalledWith("vault_regroup", {
    changes: [{ id: 1, from: "工作", category: "游戏" }],
    remember: false,
  });
  expect(
    ipc.invoke.mock.calls.some(([command]) =>
      ["vault_reveal", "vault_save"].includes(command),
    ),
  ).toBe(false);
});

test("mixed suggestions include only actual changes with original groups", () => {
  expect(
    groupingSuggestions(
      [...entries, { ...entries[0], id: 4, category: "游戏" }],
      {},
    ),
  ).toEqual([
    { id: 1, from: "工作", category: "游戏" },
    { id: 2, from: "工作", category: "学习" },
  ]);
});

test("suggestions can be excluded; manual mode and filtering reset selections without changing records", async () => {
  const regroup = vi.fn(async () => true);
  render(
    <CategoryOrganizer
      entries={entries}
      persistent={false}
      busy={false}
      onApply={vi.fn()}
      onRegroup={regroup}
    />,
  );
  fireEvent.click(screen.getByLabelText("选择 Steam fictional"));
  expect(screen.getByLabelText("全选当前列表").getAttribute("type")).toBe(
    "checkbox",
  );
  expect(
    (screen.getByLabelText("全选当前列表") as HTMLInputElement).indeterminate,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "应用 1 项建议" }));
  await waitFor(() =>
    expect(regroup).toHaveBeenCalledWith(
      [{ id: 2, from: "工作", category: "学习" }],
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "手动分组" }));
  fireEvent.click(screen.getByLabelText("全选当前列表"));
  expect(screen.getByText("已选 3 项")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("筛选待分类账号"), {
    target: { value: "Unknown" },
  });
  expect(screen.getByText("已选 0 项")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "移动所选" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
