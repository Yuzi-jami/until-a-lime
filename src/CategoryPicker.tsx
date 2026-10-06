import { useId, useState } from "react";

export default function CategoryPicker({
  value,
  onChange,
  options,
  label = "分类",
  optional = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label?: string;
  optional?: boolean;
}) {
  const id = useId();
  const [custom, setCustom] = useState(false);
  const choices = [...new Set([...options, ...(value ? [value] : [])])];
  return (
    <div className="category-picker">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={custom ? "new" : value ? `group:${value}` : ""}
        onChange={(e) => {
          if (e.target.value === "new") {
            setCustom(true);
            onChange("");
          } else {
            setCustom(false);
            onChange(e.target.value.replace(/^group:/, ""));
          }
        }}
      >
        <option value="">{optional ? "选择分类（可选）" : "选择分类"}</option>
        {choices.map((c) => (
          <option key={c} value={`group:${c}`}>
            {c}
          </option>
        ))}
        <option value="new">＋ 新分类</option>
      </select>
      {custom && (
        <input
          aria-label="新分类名称"
          autoFocus
          maxLength={24}
          value={value}
          placeholder="输入分类名称"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
