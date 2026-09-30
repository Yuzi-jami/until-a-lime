import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import Floating from "../src/Floating";
import TitleBar from "../src/TitleBar";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (e: { payload: string }) => void>(),
  close: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: ipc.invoke,
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ipc }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, fn) => {
    ipc.listeners.set(name, fn);
    return () => ipc.listeners.delete(name);
  }),
}));
beforeEach(() => {
  ipc.listeners.clear();
  ipc.invoke.mockReset();
  ipc.close.mockReset().mockResolvedValue(undefined);
  ipc.minimize.mockReset().mockResolvedValue(undefined);
  ipc.toggleMaximize.mockReset().mockResolvedValue(undefined);
  ipc.invoke.mockImplementation(async (command) => {
    if (command === "quick_paste_accounts")
      return [
        {
          id: 1,
          name: "Demo",
          user: "test-user",
          url: "example.invalid",
          icon: "D",
        },
      ];
    if (command === "floating_layout") return null;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

test("search and waiting cards keep a full-size surface; completion notice expires", async () => {
  const { container } = render(<Floating />);
  fireEvent.click(screen.getByRole("button", { name: "展开快捷轮盘" }));
  fireEvent.click(await screen.findByRole("button", { name: /寻找账号/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Demo/ }));
  await screen.findByText(/连续填写已准备 · 最长 20 秒/);
  await waitFor(() =>
    expect(
      container.querySelector(".floating-surface")?.getAttribute("data-layout"),
    ).toBe("notice"),
  );
  await waitFor(() =>
    expect(ipc.invoke).toHaveBeenCalledWith("floating_layout", {
      layout: "notice",
    }),
  );
  vi.useFakeTimers();
  act(() =>
    ipc.listeners.get("lime-quick-paste")?.({ payload: "password-ready" }),
  );
  expect(screen.getByRole("status").textContent).toContain("密码已复制");
  expect(
    container.querySelector(".floating-surface")?.getAttribute("data-layout"),
  ).toBe("notice");
  await act(async () => {
    vi.advanceTimersByTime(4500);
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    container.querySelector(".floating-surface")?.getAttribute("data-layout"),
  ).toBe("compact");
  expect(
    ipc.invoke.mock.calls.some(([command]) => command === "desktop_action"),
  ).toBe(false);
});

test("locking clears floating account metadata and closes the search panel", async () => {
  render(<Floating />);
  fireEvent.click(screen.getByRole("button", { name: "展开快捷轮盘" }));
  fireEvent.click(await screen.findByRole("button", { name: /寻找账号/ }));
  await screen.findByText("test-user");
  act(() => ipc.listeners.get("lime-action")?.({ payload: "lock" }));
  expect(screen.queryByText("test-user")).toBeNull();
  expect(screen.queryByPlaceholderText("搜索账号")).toBeNull();
});

test("an imported entry without a username copies only the password without arming Tab", async () => {
  ipc.invoke.mockImplementation(async (command) => {
    if (command === "quick_paste_accounts")
      return [
        {
          id: 1,
          name: "Demo",
          user: "",
          url: "https://example.invalid",
          icon: "D",
        },
      ];
    if (command === "quick_paste_arm") return "password";
    return null;
  });
  render(<Floating />);
  fireEvent.click(screen.getByRole("button", { name: "展开快捷轮盘" }));
  fireEvent.click(await screen.findByRole("button", { name: /寻找账号/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Demo/ }));
  await screen.findByText("密码已复制 · 请按 Ctrl + V");
  expect(screen.queryByText(/连续填写已准备/)).toBeNull();
});

test("Windows corner controls call the same native actions as the left controls", async () => {
  render(<TitleBar />);
  const controls = within(screen.getByLabelText("Windows 窗口控制"));
  fireEvent.click(controls.getByRole("button", { name: "最小化窗口" }));
  fireEvent.click(controls.getByRole("button", { name: "最大化或还原窗口" }));
  fireEvent.click(
    controls.getByRole("button", { name: "关闭窗口，收起到托盘" }),
  );
  await waitFor(() => expect(ipc.close).toHaveBeenCalledTimes(1));
  expect(ipc.minimize).toHaveBeenCalledTimes(1);
  expect(ipc.toggleMaximize).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("PRIVATE COLLECTION")).toBeNull();
});

function dragFruit(button: HTMLElement) {
  Object.assign(button, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  // jsdom has no PointerEvent constructor; MouseEvent carries the screen coords.
  fireEvent(
    button,
    new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      screenX: 600,
      screenY: 500,
    }),
  );
  fireEvent(
    button,
    new MouseEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      screenX: 620,
      screenY: 520,
    }),
  );
}

test("drag holds the wheel anchor until native release, then settles exactly once", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  ipc.invoke.mockImplementation(async (command) => {
    if (command === "drag_floating") return held;
    return null;
  });
  const { container } = render(<Floating />);
  const fruit = screen.getByRole("button", { name: "展开快捷轮盘" });
  fireEvent.pointerEnter(fruit);
  const layout = () =>
    container.querySelector(".floating-surface")?.getAttribute("data-layout");
  await waitFor(() => expect(layout()).toBe("wheel"));
  ipc.invoke.mockClear();
  dragFruit(fruit);
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("drag_floating"));
  fireEvent.blur(window);
  fireEvent.mouseLeave(document.documentElement);
  // Native dragging can continue even after WebView loses pointer capture.
  fireEvent.pointerCancel(fruit);
  expect(layout()).toBe("wheel");
  expect(container.querySelector<HTMLElement>(".wheel-ring")?.hidden).toBe(
    true,
  );
  expect(fruit.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: /寻找账号/ })).toBeNull();
  expect(
    ipc.invoke.mock.calls.filter(([command]) => command === "floating_layout"),
  ).toHaveLength(0);
  await act(async () => release());
  await waitFor(() => expect(layout()).toBe("compact"));
  expect(container.querySelector<HTMLElement>(".wheel-ring")?.hidden).toBe(
    false,
  );
  expect(
    ipc.invoke.mock.calls.filter(([command]) => command === "floating_layout"),
  ).toEqual([["floating_layout", { layout: "compact", settle: true }]]);
});

test("CSS keeps its anchor until the corresponding native resize completes", async () => {
  let resized!: () => void;
  const pending = new Promise<void>((resolve) => {
    resized = resolve;
  });
  ipc.invoke.mockImplementation(async (_command, args) => {
    if (args?.layout === "wheel") await pending;
    return null;
  });
  const { container } = render(<Floating />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: "展开快捷轮盘" }));
  await waitFor(() =>
    expect(ipc.invoke).toHaveBeenCalledWith("floating_layout", {
      layout: "wheel",
    }),
  );
  expect(
    container.querySelector(".floating-surface")?.getAttribute("data-layout"),
  ).toBe("compact");
  await act(async () => resized());
  expect(
    container.querySelector(".floating-surface")?.getAttribute("data-layout"),
  ).toBe("wheel");
});

test("a drag failure releases the layout guard and leaves the fruit usable", async () => {
  ipc.invoke.mockImplementation(async (command) => {
    if (command === "drag_floating") throw new Error("window unavailable");
    return null;
  });
  const { container } = render(<Floating />);
  const fruit = screen.getByRole("button", { name: "展开快捷轮盘" });
  dragFruit(fruit);
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(
      container.querySelector(".floating-surface")?.getAttribute("data-layout"),
    ).toBe("notice"),
  );
  fireEvent.pointerLeave(fruit);
  fireEvent.pointerEnter(fruit);
  await waitFor(() =>
    expect(
      container.querySelector(".floating-surface")?.getAttribute("data-layout"),
    ).toBe("wheel"),
  );
  expect(container.querySelector<HTMLElement>(".wheel-ring")?.hidden).toBe(
    false,
  );
  expect(screen.getByRole("button", { name: /寻找账号/ })).toBeTruthy();
});

test("dragging a half-hidden compact fruit keeps its clipped anchor until settlement", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  ipc.invoke.mockImplementation(async (command, args) => {
    if (command === "drag_floating") return held;
    return args?.settle ? null : "left";
  });
  const { container } = render(<Floating />);
  const surface = () => container.querySelector(".floating-surface");
  await waitFor(() =>
    expect(surface()?.getAttribute("data-edge")).toBe("left"),
  );
  ipc.invoke.mockClear();
  dragFruit(screen.getByRole("button", { name: "展开快捷轮盘" }));
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("drag_floating"));
  expect(surface()?.getAttribute("data-layout")).toBe("compact");
  expect(surface()?.getAttribute("data-edge")).toBe("left");
  expect(
    ipc.invoke.mock.calls.filter(([command]) => command === "floating_layout"),
  ).toHaveLength(0);
  await act(async () => release());
  await waitFor(() =>
    expect(surface()?.getAttribute("data-edge")).toBe("none"),
  );
  expect(
    ipc.invoke.mock.calls.filter(([command]) => command === "floating_layout"),
  ).toEqual([["floating_layout", { layout: "compact", settle: true }]]);
});

test("docking slides before cropping and ignores hover/focus until a fresh exit and entry", async () => {
  let release!: () => void;
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const animation = { finished, cancel: vi.fn(), finish: () => finish() };
  const animate = vi.fn(() => animation);
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  ipc.invoke.mockImplementation(async (command, args) => {
    if (command === "drag_floating") return held;
    if (command === "prepare_floating_motion" && args.settle)
      return { id: 7, fromX: 150, fromY: 138, toX: 300, toY: 138 };
    if (command === "finish_floating_motion") return "right";
    return null;
  });
  const { container } = render(<Floating />);
  const fruit = screen.getByRole("button", { name: "展开快捷轮盘" });
  const surface = () => container.querySelector(".floating-surface");
  fireEvent.pointerEnter(fruit);
  await waitFor(() =>
    expect(surface()?.getAttribute("data-layout")).toBe("wheel"),
  );
  dragFruit(fruit);
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("drag_floating"));
  await act(async () => release());
  await waitFor(() => expect(animate).toHaveBeenCalledTimes(1));
  expect(surface()?.getAttribute("data-motion")).toBe("sliding");
  expect(surface()?.getAttribute("data-layout")).toBe("wheel");
  expect(ipc.invoke).not.toHaveBeenCalledWith("finish_floating_motion", {
    id: 7,
  });
  expect(animate.mock.calls[0]).toEqual([
    [{ translate: "0px 0px" }, { translate: "150px 0px" }],
    {
      duration: 230,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards",
    },
  ]);
  fireEvent.pointerLeave(fruit);
  fireEvent.pointerEnter(fruit);
  fireEvent.focus(fruit);
  expect(screen.queryByRole("button", { name: /寻找账号/ })).toBeNull();
  await act(async () => finish());
  await waitFor(() =>
    expect(surface()?.getAttribute("data-edge")).toBe("right"),
  );
  expect(surface()?.getAttribute("data-layout")).toBe("compact");
  expect(surface()?.hasAttribute("data-motion")).toBe(false);
  expect(animation.cancel).toHaveBeenCalledOnce();
  fireEvent.pointerEnter(fruit);
  fireEvent.focus(fruit);
  expect(fruit.getAttribute("aria-expanded")).toBe("false");
  fireEvent.pointerLeave(fruit);
  fireEvent.pointerEnter(fruit);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /寻找账号/ })).toBeTruthy(),
  );
});

test("reduced motion skips animation staging and still settles the fruit", async () => {
  const animate = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query === "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
  render(<Floating />);
  await waitFor(() =>
    expect(ipc.invoke).toHaveBeenCalledWith("floating_layout", {
      layout: "compact",
    }),
  );
  expect(
    ipc.invoke.mock.calls.some(
      ([command]) => command === "prepare_floating_motion",
    ),
  ).toBe(false);
  expect(animate).not.toHaveBeenCalled();
});
