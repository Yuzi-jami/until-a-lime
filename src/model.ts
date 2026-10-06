export type Category = string;
export type Filter = "all" | "favorite" | "recent" | Category;
export interface Entry {
  id: number;
  name: string;
  user: string;
  category: Category;
  icon: string;
  url: string;
  favorite: boolean;
  note: string;
}
export const demoEntries: Entry[] = [
  {
    id: 1,
    name: "GitHub",
    user: "lime.collector@example.invalid",
    category: "工作",
    icon: "G",
    url: "github.com",
    favorite: true,
    note: "灵感与代码，都在这里生长。",
  },
  {
    id: 2,
    name: "Steam",
    user: "lime_in_the_afternoon",
    category: "娱乐",
    icon: "S",
    url: "store.steampowered.com",
    favorite: true,
    note: "留一点时间，去另一个世界散步。",
  },
  {
    id: 3,
    name: "网易云音乐",
    user: "lime.music@example.invalid",
    category: "生活",
    icon: "♪",
    url: "music.163.com",
    favorite: false,
    note: "收集夏天的声音。",
  },
  {
    id: 4,
    name: "Notion",
    user: "lime.notes@example.invalid",
    category: "工作",
    icon: "N",
    url: "notion.so",
    favorite: false,
    note: "那些还没有成形的想法。",
  },
  {
    id: 5,
    name: "哔哩哔哩",
    user: "一颗酸橙的午后",
    category: "娱乐",
    icon: "▣",
    url: "bilibili.com",
    favorite: false,
    note: "留给好奇心的一扇窗。",
  },
  {
    id: 6,
    name: "Microsoft",
    user: "lime.mail@example.invalid",
    category: "工作",
    icon: "⊞",
    url: "account.microsoft.com",
    favorite: false,
    note: "日常工作的小小入口。",
  },
];
export const navigation: { id: Filter; label: string; icon: string }[] = [
  { id: "all", label: "全部密码", icon: "▦" },
  { id: "favorite", label: "收藏密码", icon: "☆" },
  { id: "recent", label: "最近使用", icon: "◷" },
  { id: "工作", label: "工作与创作", icon: "◈" },
  { id: "生活", label: "日常生活", icon: "◉" },
  { id: "娱乐", label: "游戏与娱乐", icon: "◇" },
];
