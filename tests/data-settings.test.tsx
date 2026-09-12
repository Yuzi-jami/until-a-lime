import { beforeEach, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataSettings from "../src/DataSettings";
import ImportPanel from "../src/ImportPanel";
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
beforeEach(() => {
  ipc.invoke.mockReset();
});

test("password change validates confirmation, clears fields and reports failure", async () => {
  const user = userEvent.setup();
  ipc.invoke.mockRejectedValue("当前主密码错误");
  render(<DataSettings onImported={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "修改主密码" }));
  await user.type(screen.getByLabelText("当前主密码"), "test-current-master");
  await user.type(screen.getByLabelText("新主密码"), "test-new-master");
  await user.type(
    screen.getByLabelText("再次输入新主密码"),
    "different-master",
  );
  await user.click(screen.getByRole("button", { name: "验证并修改主密码" }));
  expect(ipc.invoke).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("不一致");
  await user.clear(screen.getByLabelText("再次输入新主密码"));
  await user.type(screen.getByLabelText("再次输入新主密码"), "test-new-master");
  await user.click(screen.getByRole("button", { name: "验证并修改主密码" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("当前主密码错误"),
  );
  expect(ipc.invoke).toHaveBeenCalledWith("vault_change_password", {
    oldPassword: "test-current-master",
    newPassword: "test-new-master",
  });
  expect((screen.getByLabelText("当前主密码") as HTMLInputElement).value).toBe(
    "",
  );
  expect((screen.getByLabelText("新主密码") as HTMLInputElement).value).toBe(
    "",
  );
});
test("successful rotation explains which password protects older backups", async () => {
  const user = userEvent.setup();
  ipc.invoke.mockResolvedValue(undefined);
  render(<DataSettings onImported={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "修改主密码" }));
  await user.type(screen.getByLabelText("当前主密码"), "test-current-master");
  await user.type(screen.getByLabelText("新主密码"), "test-new-master");
  await user.type(screen.getByLabelText("再次输入新主密码"), "test-new-master");
  await user.click(screen.getByRole("button", { name: "验证并修改主密码" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "旧备份仍使用旧主密码",
    ),
  );
  expect(screen.queryByLabelText("新主密码")).toBeNull();
});
test("import uses a backend selection ticket and suppresses stale results after unmount", async () => {
  const user = userEvent.setup(),
    onImported = vi.fn();
  let resolve: (result: unknown) => void = () => {};
  ipc.invoke.mockImplementation(async (command: string) =>
    command === "vault_choose_import"
      ? { ticket: "opaque-ticket", name: "backup.lime" }
      : new Promise((done) => {
          resolve = done;
        }),
  );
  const view = render(<ImportPanel onImported={onImported} />);
  await user.click(
    screen.getByRole("button", { name: "选择 .lime / .bak 文件" }),
  );
  await user.type(
    await screen.findByLabelText("备份的主密码"),
    "test-backup-master",
  );
  await user.click(screen.getByRole("button", { name: "验证并追加账号" }));
  expect(ipc.invoke).toHaveBeenCalledWith("vault_import", {
    ticket: "opaque-ticket",
    password: "test-backup-master",
  });
  expect(
    (screen.getByLabelText("备份的主密码") as HTMLInputElement).value,
  ).toBe("");
  view.unmount();
  await act(async () => resolve([]));
  expect(onImported).not.toHaveBeenCalled();
});
test("cancelling export is distinct from successful export", async () => {
  const user = userEvent.setup();
  ipc.invoke.mockResolvedValue(false);
  render(<DataSettings onImported={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "导出加密备份" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("已取消"),
  );
});
