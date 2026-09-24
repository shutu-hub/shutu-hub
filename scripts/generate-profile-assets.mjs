#!/usr/bin/env node
/**
 * generate-profile-assets.mjs
 *
 * Regenerates the profile card SVGs under assets/ from live GitHub data.
 *
 *   Local: node scripts/generate-profile-assets.mjs            (uses the gh CLI)
 *   CI:    GITHUB_TOKEN=xxx node scripts/generate-profile-assets.mjs
 *
 * Outputs: assets/stats.svg, assets/langs.svg, assets/contributions.svg
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGIN = process.env.PROFILE_LOGIN || 'shutu-hub';
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/* ------------------------------------------------------------------ theme */

const C = {
  text: '#E6EDF3',
  muted: '#8B98B0',
  dim: '#5A6982',
  line: '#1C2942',
  lineSoft: '#17233A',
  tile: '#101B2E',
  cyan: '#38BDF8',
  violet: '#A78BFA',
  emerald: '#34D399',
  amber: '#FBBF24',
  pink: '#F472B6',
  blue: '#60A5FA',
};

const HEAT = ['#151F33', '#0B3F52', '#0E6C8A', '#17A2C4', '#67E8F9'];

const FONT = "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/* ---------------------------------------------------------------- helpers */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const num = (n) => n.toLocaleString('en-US');

/** Nudge very dark palette colours upward so they stay legible on a dark card. */
function readable(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return C.muted;
  const int = parseInt(m[1], 16);
  let [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 96) {
    const t = 0.42;
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
  }
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const cardDefs = (id) => `
  <defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#101A2E"/>
      <stop offset="55%" stop-color="#0B1322"/>
      <stop offset="100%" stop-color="#070B14"/>
    </linearGradient>
    <radialGradient id="${id}-glowA" cx="0" cy="0" r="1">
      <stop offset="0%" stop-color="${C.cyan}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${C.cyan}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-glowB" cx="1" cy="1" r="1">
      <stop offset="0%" stop-color="${C.violet}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${C.violet}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

const cardBase = (id, w, h) => `
  ${cardDefs(id)}
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="16" fill="url(#${id}-bg)" stroke="${C.line}"/>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="16" fill="url(#${id}-glowA)"/>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="16" fill="url(#${id}-glowB)"/>`;

const cardTitle = (x, y, text) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="15" font-weight="600" fill="${C.text}" letter-spacing="0.2">${esc(text)}</text>`;

const cardMeta = (xRight, y, text) =>
  `<text x="${xRight}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.dim}">${esc(text)}</text>`;

const divider = (x1, x2, y) =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`;

const open = (w, h, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;

/* -------------------------------------------------------------- fetch data */

const QUERY = `
query {
  user(login: "${LOGIN}") {
    followers { totalCount }
    repositories(first: 100, ownerAffiliations: [OWNER], isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        name
        stargazerCount
        isArchived
        languages(first: 15, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
  mergedPullRequests: search(query: "author:${LOGIN} is:pr is:merged", type: ISSUE) { issueCount }
}`;

async function gql(query) {
  if (process.env.GITHUB_TOKEN) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: 'bearer ' + process.env.GITHUB_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': 'shutu-hub-profile-assets',
      },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }
  const stdout = execFileSync('gh', ['api', 'graphql', '-f', 'query=' + query], { encoding: 'utf8' });
  const json = JSON.parse(stdout);
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/* ------------------------------------------------------------ derive stats */

const today = new Date().toISOString().slice(0, 10);

const data = await gql(QUERY);
const user = data.user;
const repos = user.repositories.nodes;

const stars = repos.reduce((sum, r) => sum + r.stargazerCount, 0);
const langs = new Map();
for (const repo of repos) {
  for (const edge of repo.languages.edges) {
    const key = edge.node.name;
    const prev = langs.get(key);
    langs.set(key, { size: (prev?.size || 0) + edge.size, color: edge.node.color });
  }
}
const totalBytes = [...langs.values()].reduce((sum, l) => sum + l.size, 0) || 1;
const topLangs = [...langs.entries()]
  .map(([name, v]) => ({ name, size: v.size, color: readable(v.color), pct: (v.size / totalBytes) * 100 }))
  .sort((a, b) => b.size - a.size)
  .filter((l) => l.pct >= 0.5)
  .slice(0, 6);

const cal = user.contributionsCollection.contributionCalendar;
const grid = cal.weeks.map((week) => {
  const col = new Array(7).fill(null);
  for (const day of week.contributionDays) {
    col[new Date(day.date + 'T00:00:00Z').getUTCDay()] = day;
  }
  return col;
});

const allDays = grid.flat().filter(Boolean).filter((d) => d.date <= today);
let longestStreak = 0;
let run = 0;
for (const day of allDays) {
  run = day.contributionCount > 0 ? run + 1 : 0;
  longestStreak = Math.max(longestStreak, run);
}
let currentStreak = 0;
for (let i = allDays.length - 1; i >= 0; i--) {
  if (allDays[i].contributionCount > 0) currentStreak++;
  else if (i === allDays.length - 1) continue;
  else break;
}

/* ------------------------------------------------------------ stats card */

function renderStats() {
  const W = 860;
  const H = 174;
  const pad = 26;
  const tiles = [
    { value: num(stars), label: '总 Star', color: C.amber },
    { value: num(user.repositories.totalCount), label: '公开仓库', color: C.cyan },
    { value: num(cal.totalContributions), label: '年度贡献', color: C.emerald },
    { value: num(user.contributionsCollection.totalCommitContributions), label: '提交', color: C.violet },
    { value: num(data.mergedPullRequests.issueCount), label: '合并 PR', color: C.pink },
    { value: num(user.followers.totalCount), label: '关注者', color: C.blue },
  ];

  const gap = 12;
  const tw = (W - pad * 2 - gap * (tiles.length - 1)) / tiles.length;
  const ty = 68;
  const th = 80;

  const cells = tiles
    .map((tile, i) => {
      const tx = pad + i * (tw + gap);
      const cx = tx + 16;
      return `
  <g>
    <rect x="${tx.toFixed(2)}" y="${ty}" width="${tw.toFixed(2)}" height="${th}" rx="12" fill="${C.tile}" stroke="${C.lineSoft}"/>
    <rect x="${cx}" y="${ty + 15}" width="32" height="3" rx="1.5" fill="${tile.color}"/>
    <text x="${cx}" y="${ty + 48}" font-family="${FONT}" font-size="26" font-weight="700" fill="${tile.color}" letter-spacing="-0.5">${esc(tile.value)}</text>
    <text x="${cx}" y="${ty + 68}" font-family="${FONT}" font-size="11.5" fill="${C.muted}">${esc(tile.label)}</text>
  </g>`;
    })
    .join('');

  return `${open(W, H, 'GitHub stats')}
${cardBase('s', W, H)}
${cardTitle(pad, 34, '数据速览')}
${cardMeta(W - pad, 34, 'updated ' + today)}
${divider(pad, W - pad, 52)}
${cells}
</svg>
`;
}

/* ------------------------------------------------------- languages card */

function renderLangs() {
  const W = 860;
  const H = 172;
  const pad = 26;
  const barY = 66;
  const barH = 14;
  const barW = W - pad * 2;

  let cursor = pad;
  const segments = topLangs
    .map((lang, i) => {
      const isLast = i === topLangs.length - 1;
      const w = Math.max((lang.pct / 100) * barW - (isLast ? 0 : 2), 3);
      const rect = `<rect x="${cursor.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}" rx="3" fill="${lang.color}"/>`;
      cursor += w + 2;
      return rect;
    })
    .join('');

  const cols = [pad, pad + 270, pad + 540];
  const legend = topLangs
    .map((lang, i) => {
      const cx = cols[i % 3];
      const cy = i < 3 ? 122 : 152;
      return `
  <g>
    <circle cx="${cx + 5}" cy="${cy - 4}" r="4.5" fill="${lang.color}"/>
    <text x="${cx + 19}" y="${cy}" font-family="${FONT}" font-size="12.5" fill="${C.text}">${esc(lang.name)}</text>
    <text x="${cx + 236}" y="${cy}" text-anchor="end" font-family="${MONO}" font-size="11.5" fill="${C.muted}">${lang.pct.toFixed(1)}%</text>
  </g>`;
    })
    .join('');

  return `${open(W, H, 'Top languages')}
${cardBase('l', W, H)}
  <defs>
    <clipPath id="l-clip"><rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}"/></clipPath>
  </defs>
${cardTitle(pad, 34, '主要语言')}
${cardMeta(W - pad, 34, '按仓库代码字节统计')}
${divider(pad, W - pad, 52)}
  <rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="${C.tile}"/>
  <g clip-path="url(#l-clip)">${segments}</g>
${legend}
</svg>
`;
}

/* --------------------------------------------------- contributions card */

function renderContributions() {
  const W = 860;
  const H = 214;
  const pad = 26;
  const cell = 11;
  const step = 14;
  const gridW = grid.length * step - (step - cell);
  const x0 = pad + (W - pad * 2 - gridW) / 2;
  const y0 = 84;

  const monthLabels = [];
  let lastMonth = -1;
  grid.forEach((col, i) => {
    const first = col.find(Boolean);
    if (!first) return;
    const d = new Date(first.date + 'T00:00:00Z');
    const month = d.getUTCMonth();
    if (month === lastMonth) return;
    lastMonth = month;
    const x = x0 + i * step;
    if (monthLabels.length && x - monthLabels[monthLabels.length - 1].x < 24) return;
    monthLabels.push({ x, label: month + 1 + '月' });
  });

  const labels = monthLabels
    .map((m) => `<text x="${m.x.toFixed(1)}" y="76" font-family="${FONT}" font-size="10.5" fill="${C.dim}">${esc(m.label)}</text>`)
    .join('');

  const cells = grid
    .map((col, i) =>
      col
        .map((day, dow) => {
          if (!day) return '';
          const level = day.contributionCount <= 0 ? 0
            : day.contributionCount <= 2 ? 1
            : day.contributionCount <= 5 ? 2
            : day.contributionCount <= 9 ? 3
            : 4;
          const x = x0 + i * step;
          const y = y0 + dow * step;
          return `<rect x="${x.toFixed(1)}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${HEAT[level]}"><title>${esc(day.date)} &#183; ${day.contributionCount}</title></rect>`;
        })
        .join(''),
    )
    .join('');

  const legend = HEAT.map(
    (color, i) => `<rect x="${W - pad - 5 * 17 + i * 17 - 60}" y="190" width="${cell}" height="${cell}" rx="2.5" fill="${color}"/>`,
  ).join('');

  return `${open(W, H, 'Contribution heatmap')}
${cardBase('c', W, H)}
${cardTitle(pad, 34, '贡献热力图')}
${cardMeta(W - pad, 34, '过去一年共 ' + num(cal.totalContributions) + ' 次贡献')}
${divider(pad, W - pad, 52)}
${labels}
${cells}
  <text x="${pad}" y="201" font-family="${FONT}" font-size="11.5" fill="${C.muted}">当前连续 ${currentStreak} 天 &#183; 最长 ${longestStreak} 天</text>
  <text x="${W - pad - 5 * 17 - 66}" y="200" text-anchor="end" font-family="${FONT}" font-size="11" fill="${C.dim}">少</text>
${legend}
  <text x="${W - pad}" y="200" text-anchor="end" font-family="${FONT}" font-size="11" fill="${C.dim}">多</text>
</svg>
`;
}

/* ------------------------------------------------------------------- main */

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, 'stats.svg'), renderStats(), 'utf8');
writeFileSync(resolve(OUT_DIR, 'langs.svg'), renderLangs(), 'utf8');
writeFileSync(resolve(OUT_DIR, 'contributions.svg'), renderContributions(), 'utf8');

console.log('assets regenerated  ' + today);
console.log('  stars=' + stars + ' repos=' + user.repositories.totalCount + ' contributions=' + cal.totalContributions);
console.log('  streak current=' + currentStreak + ' longest=' + longestStreak);
console.log('  langs=' + topLangs.map((l) => l.name + ' ' + l.pct.toFixed(1) + '%').join(', '));