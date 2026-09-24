import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const source = 'https://streak-stats.demolab.com/?user=shutu-hub&type=json&timezone=Asia%2FShanghai';
const response = await fetch(source, { headers: { Accept: 'application/json' } });

if (!response.ok) {
  throw new Error(`Activity data request failed: ${response.status}`);
}

const activity = await response.json();
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

if (
  !isCount(activity.totalContributions) ||
  !isDate(activity.firstContribution) ||
  !isCount(activity.currentStreak?.length) ||
  !isCount(activity.longestStreak?.length) ||
  (activity.currentStreak.length > 0 && (!isDate(activity.currentStreak.start) || !isDate(activity.currentStreak.end))) ||
  (activity.longestStreak.length > 0 && (!isDate(activity.longestStreak.start) || !isDate(activity.longestStreak.end)))
) {
  throw new Error('Activity data has an unexpected shape');
}

const formatDate = (value) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );

const formatRange = ({ start, end, length }) =>
  length === 0 ? 'No streak yet' : `${formatDate(start)} – ${formatDate(end)}, ${end.slice(0, 4)}`;

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const themes = {
  light: { background: '#ffffff', text: '#1f2328', muted: '#57606a', line: '#d8dee4', accent: '#4f46e5', flame: '#0ea5e9' },
  dark: { background: '#0d1117', text: '#e6edf3', muted: '#8b949e', line: '#30363d', accent: '#818cf8', flame: '#38bdf8' },
};

function render(theme) {
  const current = escapeXml(activity.currentStreak.length.toLocaleString('en-US'));
  const total = escapeXml(activity.totalContributions.toLocaleString('en-US'));
  const longest = escapeXml(activity.longestStreak.length.toLocaleString('en-US'));
  const currentDates = escapeXml(formatRange(activity.currentStreak));
  const totalDates = escapeXml(`${formatDate(activity.firstContribution)}, ${activity.firstContribution.slice(0, 4)} – Present`);
  const longestDates = escapeXml(formatRange(activity.longestStreak));
  const font = '-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 195" width="720" height="195" role="img" aria-labelledby="title desc">
  <title id="title">GitHub activity for shutu-hub</title>
  <desc id="desc">Current streak: ${current} days. Total contributions: ${total}. Longest streak: ${longest} days.</desc>
  <rect width="720" height="195" fill="${theme.background}"/>
  <path d="M240 42v139M480 42v139" stroke="${theme.line}"/>
  <circle cx="360" cy="85" r="43" fill="none" stroke="${theme.accent}" stroke-width="5"/>
  <path d="M360 39c-9-11 5-16 2-25 12 8 4 15 8 19 3-2 4-5 4-8 8 12 4 22-9 22-7 0-11-3-11-9 2 2 4 2 6 1z" fill="${theme.flame}"/>
  <g font-family="${font}" text-anchor="middle" fill="${theme.text}">
    <text x="120" y="96" font-size="31" font-weight="700">${current}</text>
    <text x="360" y="95" font-size="27" font-weight="700">${total}</text>
    <text x="600" y="96" font-size="31" font-weight="700">${longest}</text>
    <text x="120" y="151" font-size="15" font-weight="600">Current Streak</text>
    <text x="360" y="151" font-size="15" font-weight="600">Total Contributions</text>
    <text x="600" y="151" font-size="15" font-weight="600">Longest Streak</text>
  </g>
  <g font-family="${font}" font-size="12" text-anchor="middle" fill="${theme.muted}">
    <text x="120" y="177">${currentDates}</text>
    <text x="360" y="177">${totalDates}</text>
    <text x="600" y="177">${longestDates}</text>
  </g>
</svg>\n`;
}

mkdirSync(outputDir, { recursive: true });
for (const [name, theme] of Object.entries(themes)) {
  writeFileSync(resolve(outputDir, `activity-${name}.svg`), render(theme));
}
