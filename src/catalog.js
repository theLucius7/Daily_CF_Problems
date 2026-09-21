import { dayKey } from './model.js';

export const REPOSITORY = 'Yawn-Sean/Daily_CF_Problems';
export const CATALOG_STORAGE = 'lucius7-calendar:catalog:v1';

export function validCatalog(value) {
  return value?.schemaVersion === 1 && value.handle === 'Lucius7'
    && value.source?.repository === REPOSITORY && Array.isArray(value.tasks) && value.tasks.length > 0
    && Number.isFinite(Date.parse(value.updatedAt)) && /^[a-f0-9]{40}$/.test(value.source.revision)
    && value.tasks.every(task => /^\d{4}-\d{2}-\d{2}$/.test(task.date) && /^cf:\d+:[A-Z0-9]+$/.test(task.id)
      && task.key === `${task.date}:${task.id}` && Array.isArray(task.categories) && Array.isArray(task.codeUrls)
      && typeof task.hint === 'string' && typeof task.code === 'string' && Number.isFinite(task.difficulty));
}

export function newerCatalog(bundled, cached) {
  return validCatalog(cached) && Date.parse(cached.updatedAt) > Date.parse(bundled.updatedAt) ? cached : bundled;
}

export function catalogCheckedToday(catalog, today = dayKey()) {
  return !catalog.error && Number.isFinite(Date.parse(catalog.updatedAt))
    && (catalog.checkedThrough || dayKey(new Date(catalog.updatedAt))) >= today;
}

export function refreshDates(catalog, today) {
  // Recheck the recent week for edited hints and late editorials, and fill every
  // intervening day if this browser has not been opened for a while.
  const recent = new Date(`${today}T00:00:00Z`);
  recent.setUTCDate(recent.getUTCDate() - 6);
  const latest = catalog.tasks.filter(task => task.date <= today).map(task => task.date).sort().at(-1) || today;
  const start = [latest, recent.toISOString().slice(0, 10)].sort()[0];
  const dates = [];
  for (const date = new Date(`${start}T00:00:00Z`); date.toISOString().slice(0, 10) <= today; date.setUTCDate(date.getUTCDate() + 1)) dates.push(date.toISOString().slice(0, 10));
  return dates;
}

export function parseProblems(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/);
    const rating = parts[0]?.match(/\d{3,4}/);
    const link = parts[1]?.match(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/);
    const problem = link?.[2].match(/^https:\/\/codeforces\.com\/(?:problemset\/problem\/(\d+)\/([a-z\d]+)|(?:gym|contest)\/(\d+)\/problem\/([a-z\d]+))/i);
    if (!rating || !problem) continue;
    const contest = Number(problem[1] || problem[3]), index = (problem[2] || problem[4]).toUpperCase();
    const hint = parts.slice(2).join('|').split(/\|\s*\[(?:Editorial|Solution)\]/i)[0].trim().replaceAll('\\|', '|');
    rows.push({ id: `cf:${contest}:${index}`, code: link[1], url: link[2], difficulty: Number(rating[0]), estimated: parts[0].includes('*'), hint });
  }
  if (!rows.length || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('上游题单格式异常');
  return rows;
}

export async function refreshCatalog(current, { today = dayKey(), request = fetch, now = () => new Date().toISOString() } = {}) {
  const get = async (url, method = 'GET') => {
    const response = await request(url, { method, cache: 'no-cache', credentials: 'omit', signal: AbortSignal.timeout(20000) });
    if (!response.ok && response.status !== 404) throw new Error(`题单请求失败（HTTP ${response.status}）`);
    return response;
  };
  // Freeze all requests to one upstream commit. No credentials are sent from
  // the browser, and a failed batch never replaces the last usable catalog.
  const response = await get(`https://api.github.com/repos/${REPOSITORY}/commits/main`);
  if (!response.ok) throw new Error('无法读取上游题单版本');
  const { sha: revision } = await response.json();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('上游题单版本异常');
  const dates = refreshDates(current, today), replacements = new Map();
  const known = new Map(current.tasks.map(task => [task.id, task]));
  let next = 0;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(4, dates.length) }, async () => {
    while (next < dates.length) {
      const date = dates[next++], [year, month, day] = date.split('-');
      const directory = `daily_problems/${year}/${month}/${month}${day}`;
      const raw = `https://raw.githubusercontent.com/${REPOSITORY}/${revision}/${directory}`;
      const blob = `https://github.com/${REPOSITORY}/blob/${revision}/${directory}`;
      const file = await get(`${raw}/problems.md`);
      if (file.status === 404) {
        if (current.tasks.some(task => task.date === date)) throw new Error(`${date} 的原有题单暂时无法读取`);
        replacements.set(date, []); // An unpublished day is different from a failed request.
        continue;
      }
      const tasks = [];
      for (const row of parseProblems(await file.text())) {
        const [, contest, index] = row.id.split(':');
        const solution = `solution/cf${contest}${index.toLowerCase()}.md`;
        const editorial = await get(`${raw}/${solution}`, 'HEAD');
        tasks.push({ ...row, date, key: `${date}:${row.id}`, sourceUrl: `${blob}/problems.md`,
          editorial: editorial.ok ? `${blob}/${solution}` : null,
          categories: known.get(row.id)?.categories || [], codeUrls: known.get(row.id)?.codeUrls || [] });
      }
      replacements.set(date, tasks);
    }
  }));
  const failed = workers.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  const tasks = current.tasks.filter(task => !replacements.has(task.date)).concat(...replacements.values()).sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  return { ...current, tasks, error: null, updatedAt: now(), checkedThrough: today,
    source: { ...current.source, liveRevision: revision, liveFrom: dates[0], liveThrough: today } };
}
