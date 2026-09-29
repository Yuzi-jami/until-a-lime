import { useId } from "react";
import type { Entry } from "./model";

export type Strength = { id: number; score: number };

// No passwords or password-derived hashes cross this component boundary.
export function OrangeStrength({ score }: { score?: number }) {
  const id = useId().replace(/:/g, "");
  const filled = score == null ? 0 : Math.max(0, Math.min(8, score));
  return (
    <div
      className="orange-strength"
      role="img"
      aria-label={
        score == null ? "密码强度暂不可用" : `密码强度粗略估计 ${filled} / 8`
      }
    >
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-peel`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ffc166" />
            <stop offset="1" stopColor="#e67526" />
          </linearGradient>
        </defs>
        <circle
          className="strength-track"
          cx="80"
          cy="80"
          r="73"
          fill="none"
          strokeWidth="2"
        />
        {score != null && (
          <circle
            cx="80"
            cy="80"
            r="73"
            fill="none"
            stroke="#ed943e"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${(filled / 8) * 459} 459`}
            transform="rotate(-90 80 80)"
          />
        )}
        <circle cx="80" cy="80" r="64" fill={`url(#${id}-peel)`} />
        <circle className="strength-pith" cx="80" cy="80" r="59" />
        {Array.from({ length: 8 }, (_, i) => (
          <path
            key={i}
            transform={`rotate(${i * 45} 80 80)`}
            d="M80 73 L83 29 Q83 26 87 27 A54 54 0 0 1 113 37 Q116 40 113 43 L85 76 Q80 80 80 73Z"
            className={
              i < filled ? "strength-segment filled" : "strength-segment"
            }
            style={
              i < filled
                ? { fill: ["#ffc17a", "#ffac53", "#f99436", "#ec8028"][i % 4] }
                : undefined
            }
          />
        ))}
        <circle cx="80" cy="80" r="5" className="strength-pith" />
        <path
          d="M34 50 Q47 29 68 25"
          stroke="#ffe5b5"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

export default function PasswordStatistics({
  entries,
  strengths,
  pending,
  error,
  persistent,
}: {
  entries: Entry[];
  strengths: Strength[];
  pending: boolean;
  error: string;
  persistent: boolean;
}) {
  const favorites = entries.filter((e) => e.favorite).length;
  const sites = new Set(
    entries.map((e) => e.url.trim().toLowerCase()).filter(Boolean),
  ).size;
  const groups = ["工作", "生活", "娱乐"];
  const bands = ["1–2", "3–4", "5–6", "7–8"].map((name, index) => ({
    name,
    count: strengths.filter(
      (s) => s.score > index * 2 && s.score <= (index + 1) * 2,
    ).length,
  }));
  return (
    <section className="statistics-page">
      <div className="page-intro">
        <span className="eyebrow">COLLECTION / OVERVIEW</span>
        <h1>密码统计</h1>
        <p>收藏的数量、分类与分布，一眼看清。</p>
      </div>
      <div className="stat-cards">
        {[
          ["全部密码", entries.length],
          ["收藏密码", favorites],
          ["网站地址", sites],
        ].map(([label, count]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <strong>
              {count}
              <small>项</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="statistics-grid">
        <section className="statistics-card">
          <h2>分类分布</h2>
          {groups.map((name) => {
            const count = entries.filter((e) => e.category === name).length;
            return (
              <div className="stat-row" key={name}>
                <div>
                  <span>{name}</span>
                  <span>{count}</span>
                </div>
                <div className="stat-track">
                  <span
                    style={{
                      width: `${entries.length ? (count / entries.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </section>
        <section className="statistics-card">
          <h2>强度分布</h2>
          <p className="statistics-caption">
            {persistent ? "本机估算 · 8 格刻度" : "示例分布 · 8 格刻度"}
          </p>
          {pending ? (
            <p role="status">正在整理…</p>
          ) : error ? (
            <p role="status">{error}</p>
          ) : (
            <div className="strength-histogram">
              {bands.map((band) => (
                <div key={band.name}>
                  <span>{band.count}</span>
                  <div className="histogram-track">
                    <i
                      style={{
                        height: `${strengths.length ? (band.count / strengths.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <small>{band.name}</small>
                </div>
              ))}
            </div>
          )}
          <p className="statistics-caption">
            根据长度与字符多样性粗略估算，不代表泄露检测或安全保证。
          </p>
        </section>
      </div>
      {!entries.length && (
        <p className="statistics-caption">
          添加账号后，这里会显示你的收藏分布。
        </p>
      )}
    </section>
  );
}
