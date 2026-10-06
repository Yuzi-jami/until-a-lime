import type { Entry } from "./model";
import { academicSuffixes, categoryDomains } from "./category-catalog";

export const defaultCategories = [
  "未分类",
  "学习",
  "工作",
  "社交",
  "游戏",
  "购物",
  "金融",
  "工具",
  "生活",
  "娱乐",
];
export type SaveContext = {
  entries: Entry[];
  rules: Record<string, string>;
  epoch: number;
};
export type CategoryChange = { id: number; from: string; category: string };
export function groupingSuggestions(
  entries: Entry[],
  rules: Record<string, string>,
): CategoryChange[] {
  return entries.flatMap((entry) => {
    const category = suggestCategory(entry.url, entry.name, rules);
    return category !== "未分类" && category !== entry.category
      ? [{ id: entry.id, from: entry.category, category }]
      : [];
  });
}
export function siteKey(value: string): string {
  const text = value.trim();
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    if (["https:", "http:"].includes(url.protocol))
      return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    /* Application names are also valid. */
  }
  return text.toLowerCase();
}
export function siteDetails(value: string) {
  const text = value.trim();
  if (!text) throw new Error("请输入网站或应用名称。");
  const host = siteKey(text);
  if (text.includes("://") || (host.includes(".") && !/\s/.test(host))) {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("请使用不含账号密码的 HTTP 或 HTTPS 网址。");
    return { name: url.hostname.replace(/^www\./, ""), url: url.href };
  }
  return { name: text, url: text };
}
const domains = categoryDomains
  .flatMap(([category, sites]) => sites.map((site) => ({ category, site })))
  .sort((a, b) => b.site.length - a.site.length);
export function suggestCategory(
  url: string,
  name: string,
  rules: Record<string, string>,
): string {
  const host = siteKey(url);
  if (Object.hasOwn(rules, host)) return rules[host];
  for (const { category, site } of domains) {
    if (host === site || host.endsWith(`.${site}`)) return category;
  }
  if (academicSuffixes.some((suffix) => host.endsWith(`.${suffix}`)))
    return "学习";
  const apps: Record<string, string> = {
    steam: "游戏",
    学习通: "学习",
    超星: "学习",
    微信: "社交",
    qq: "社交",
  };
  const key = name.trim().toLowerCase();
  return Object.hasOwn(apps, key) ? apps[key] : "未分类";
}
export function unresolvedHosts(
  entries: Entry[],
  rules: Record<string, string>,
): string[] {
  const hosts = new Set<string>();
  for (const entry of entries) {
    if (suggestCategory(entry.url, entry.name, rules) !== "未分类") continue;
    try {
      const value = entry.url.trim();
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (["https:", "http:"].includes(url.protocol) && url.hostname)
        hosts.add(url.hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      /* No raw input or fallback names in the shareable list. */
    }
  }
  return [...hosts].sort();
}
export function categoryOptions(entries: Entry[]) {
  return [
    ...new Set([
      ...defaultCategories,
      ...entries.map((entry) => entry.category),
    ]),
  ];
}
