import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  defaultGeneratorOptions,
  generatePassword,
  type CharacterGroup,
  type GeneratorOptions,
} from "./generator";

const choices: { key: CharacterGroup; label: string; example: string }[] = [
  { key: "uppercase", label: "大写字母", example: "A–Z" },
  { key: "lowercase", label: "小写字母", example: "a–z" },
  { key: "digits", label: "数字", example: "0–9" },
  { key: "symbols", label: "符号", example: "! @ #" },
];
function sample(options: GeneratorOptions) {
  try {
    return { value: generatePassword(options), error: "" };
  } catch (error) {
    return {
      value: "",
      error:
        error instanceof Error ? error.message : "随机数生成不可用，请重试。",
    };
  }
}
export default function Generator() {
  const [options, setOptions] = useState(defaultGeneratorOptions);
  const [result, setResult] = useState(() => sample(defaultGeneratorOptions));
  const [copying, setCopying] = useState(false),
    [copyStatus, setCopyStatus] = useState(""),
    [ready, setReady] = useState(false);
  const ticket = useRef<number | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    if (isTauri())
      listen<{ ticket: number; status: string }>("lime-clipboard", (event) => {
        if (event.payload.ticket !== ticket.current) return;
        setCopyStatus(
          event.payload.status === "cleared"
            ? "已清理本次复制的密码。"
            : event.payload.status === "changed"
              ? "剪贴板已更新，已保留你后来复制的内容。"
              : "自动清理未完成，剪贴板可能仍有本次密码。",
        );
      })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          cleanup = unlisten;
          setReady(true);
        })
        .catch(() => {
          if (!disposed) setCopyStatus("复制服务连接失败，请重新打开面板。");
        });
    return () => {
      disposed = true;
      mounted.current = false;
      cleanup?.();
    };
  }, []);
  const change = (next: GeneratorOptions) => {
    ticket.current = null;
    setCopyStatus("");
    setOptions(next);
    setResult(sample(next));
  };
  const copy = async () => {
    setCopying(true);
    setCopyStatus("");
    try {
      const id = await invoke<number>("copy_generated_password", {
        value: result.value,
      });
      if (mounted.current) {
        ticket.current = id;
        setCopyStatus("已复制 · 30 秒后尝试自动清理。");
      }
    } catch (error) {
      if (mounted.current)
        setCopyStatus(typeof error === "string" ? error : "复制失败，请重试。");
    } finally {
      if (mounted.current) setCopying(false);
    }
  };
  const count = choices.filter((choice) => options[choice.key]).length;
  return (
    <section className="generator">
      <div className="eyebrow">FRESHLY PICKED / 按你的规则生长</div>
      <h2>摘一颗新密码</h2>
      <p>每种选中的字符至少出现一次。结果仅在当前面板中展示，尚未保存。</p>
      <div className="generated" aria-label="生成的密码">
        {result.value || "暂时无法生成"}
      </div>
      {result.error && <p role="alert">{result.error}</p>}
      <label className="generator-length" htmlFor="password-length">
        <span>密码长度</span>
        <strong>
          {options.length}
          <small> 位</small>
        </strong>
      </label>
      <input
        id="password-length"
        disabled={copying}
        type="range"
        min="8"
        max="64"
        value={options.length}
        onChange={(e) => change({ ...options, length: Number(e.target.value) })}
      />
      <div className="generator-scale" aria-hidden="true">
        <span>8</span>
        <span>32</span>
        <span>64</span>
      </div>
      <fieldset disabled={copying}>
        <legend>包含字符</legend>
        <div className="generator-options">
          {choices.map((choice) => (
            <label
              key={choice.key}
              className={options[choice.key] ? "chosen" : ""}
            >
              <input
                type="checkbox"
                checked={options[choice.key]}
                disabled={count === 1 && options[choice.key]}
                onChange={(e) =>
                  change({ ...options, [choice.key]: e.target.checked })
                }
              />
              <span>
                {choice.label}
                <small>{choice.example}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="generator-ambiguous">
        <input
          disabled={copying}
          type="checkbox"
          checked={options.excludeAmbiguous}
          onChange={(e) =>
            change({ ...options, excludeAmbiguous: e.target.checked })
          }
        />
        <span>
          排除易混淆字符<small>I、l、1、O、0、o</small>
        </span>
      </label>
      <div className="generator-actions">
        <button
          className="generator-refresh"
          disabled={copying}
          onClick={() => change(options)}
        >
          再摘一颗 ↻
        </button>
        <button
          className="primary"
          disabled={!result.value || copying || !ready}
          onClick={() => void copy()}
        >
          {copying ? "正在复制…" : "复制密码"}
        </button>
      </div>
      <p className="generator-copy-status" role="status">
        {copyStatus ||
          (isTauri()
            ? "复制后 30 秒清理；期间复制其他内容则保留新内容。"
            : "复制功能需在桌面版使用。")}
      </p>
    </section>
  );
}
