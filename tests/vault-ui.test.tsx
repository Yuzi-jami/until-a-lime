import { beforeEach, expect, test, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VaultRoot from "../src/VaultRoot";
import App from "../src/App";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Set<(event: { payload: string }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: ipc.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, fn: (event: { payload: string }) => void) => {
      if (name === "lime-action") ipc.listeners.add(fn);
      return () => ipc.listeners.delete(fn);
    },
  ),
}));
const entry = {
  id: 1,
  name: "Test account",
  user: "test@example.invalid",
  category: "工作" as const,
  icon: "L",
  url: "example.invalid",
  favorite: false,
  note: "",
};
beforeEach(() => {
  ipc.listeners.clear();
  ipc.invoke.mockReset();
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === "vault_status")
      return { exists: false, locked: true, backup: false };
    if (command === "vault_auth") return [entry];
    if (command === "runtime_status") return "Tauri test";
  });
});

test("new accounts send a create id and persist the entered password", async () => {
  const added = { ...entry, id: 12, name: "New account", user: "new-user" };
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === "vault_save") return [entry, added];
  });
  const user = userEvent.setup();
  render(<App initialEntries={[entry]} persistent onVaultLock={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "＋ 添加账号" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("名称"), "New account");
  await user.type(within(dialog).getByLabelText("用户名"), "new-user");
  await user.type(within(dialog).getByLabelText("密码"), "test-only-secret");
  await user.click(within(dialog).getByRole("button", { name: "加密保存 ↗" }));
  await screen.findByRole("button", { name: "查看 New account" });
  const call = ipc.invoke.mock.calls.find((call) => call[0] === "vault_save");
  expect(call?.[1].entry.id).toBe(0);
  expect(call?.[1].password).toBe("test-only-secret");
  expect(call?.[1].entry.password).toBeUndefined();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("backup recovery uses explicit recovery mode and requires its master password", async () => {
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === "vault_status")
      return { exists: true, locked: true, backup: true };
    if (command === "vault_auth") return [];
  });
  const user = userEvent.setup();
  render(<VaultRoot />);
  await user.click(
    await screen.findByRole("button", { name: "从上次加密备份恢复" }),
  );
  await user.type(screen.getByLabelText("主密码"), "test-master-password");
  await user.click(screen.getByRole("button", { name: "验证主密码并恢复 ↗" }));
  await waitFor(() =>
    expect(ipc.invoke.mock.calls.some((call) => call[0] === "vault_auth")).toBe(
      true,
    ),
  );
  const call = ipc.invoke.mock.calls.find((call) => call[0] === "vault_auth");
  expect(call?.[1]).toEqual({
    password: "test-master-password",
    create: false,
    restore: true,
  });
});
test("creation waits for confirmation, clears input, and lock removes account data", async () => {
  const user = userEvent.setup();
  render(<VaultRoot />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "创建密码库 ↗",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  await user.type(screen.getByLabelText("主密码"), "test-master-password");
  await user.type(screen.getByLabelText("再次输入"), "different-password");
  await user.click(screen.getByRole("button", { name: "创建密码库 ↗" }));
  expect(screen.getByRole("alert").textContent).toContain("不一致");
  expect(ipc.invoke.mock.calls.some((call) => call[0] === "vault_auth")).toBe(
    false,
  );
  await user.clear(screen.getByLabelText("再次输入"));
  await user.type(screen.getByLabelText("再次输入"), "test-master-password");
  await user.click(screen.getByRole("button", { name: "创建密码库 ↗" }));
  await screen.findByRole("button", { name: "查看 Test account" });
  expect(ipc.invoke.mock.calls.some((call) => call[0] === "vault_reveal")).toBe(
    false,
  );
  await user.click(screen.getByRole("button", { name: /锁定收藏室/ }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "查看 Test account" }),
    ).toBeNull(),
  );
  expect(screen.queryByDisplayValue("test-master-password")).toBeNull();
});
test("late unlock response cannot reopen a vault locked while authenticating", async () => {
  let resolve: (value: unknown) => void = () => {};
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === "vault_status")
      return { exists: true, locked: true, backup: false };
    if (command === "vault_auth")
      return new Promise((result) => {
        resolve = result;
      });
  });
  const user = userEvent.setup();
  render(<VaultRoot />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "解锁收藏室 ↗",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  await user.type(screen.getByLabelText("主密码"), "test-master-password");
  await user.click(screen.getByRole("button", { name: "解锁收藏室 ↗" }));
  await act(async () => {
    ipc.listeners.forEach((listener) => listener({ payload: "lock" }));
    resolve([entry]);
  });
  expect(
    screen.queryByRole("button", { name: "查看 Test account" }),
  ).toBeNull();
});
test("save error preserves edit form and existing data; password reveal is explicit", async () => {
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === "vault_save") throw "模拟磁盘写入失败";
    if (command === "vault_reveal") return "test-secret-value";
  });
  const user = userEvent.setup();
  render(<App initialEntries={[entry]} persistent onVaultLock={vi.fn()} />);
  expect(ipc.invoke.mock.calls.some((call) => call[0] === "vault_reveal")).toBe(
    false,
  );
  await user.click(screen.getByRole("button", { name: "显示" }));
  await screen.findByText("test-secret-value");
  await user.click(screen.getByRole("button", { name: "编辑记录" }));
  const dialog = screen.getByRole("dialog");
  await user.clear(within(dialog).getByLabelText("名称"));
  await user.type(within(dialog).getByLabelText("名称"), "Unsaved");
  await user.click(within(dialog).getByRole("button", { name: "加密保存 ↗" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("alert").textContent).toContain("写入失败"),
  );
  expect(
    (within(dialog).getByLabelText("名称") as HTMLInputElement).value,
  ).toBe("Unsaved");
  expect(
    screen.getByRole("button", { name: "查看 Test account" }),
  ).toBeTruthy();
  expect(screen.queryByText("test-secret-value")).toBeNull();
});
