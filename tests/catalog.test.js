import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProblems, refreshCatalog, refreshDates, newerCatalog, validCatalog, catalogCheckedToday, REPOSITORY } from '../src/catalog.js';

const revision = 'a'.repeat(40);
const line = (contest = 101798, index = 'G', hint = 'Think first.') => `| *1500 | [GYM${contest}${index}](https://codeforces.com/gym/${contest}/problem/${index}) | ${hint} |`;
const task = (date, contest = 101798) => ({ ...parseProblems(line(contest))[0], date, key: `${date}:cf:${contest}:G`, categories: ['greedy'], codeUrls: ['https://github.com/example/code'], editorial: null });
const baseline = () => ({ schemaVersion: 1, handle: 'Lucius7', source: { repository: REPOSITORY, revision: 'b'.repeat(40) }, updatedAt: '2026-09-19T00:00:00Z', tasks: [task('2026-09-19')] });
function upstream(files, { status = 200, missingEditorial = false } = {}) {
  const calls = [];
  return { calls, request: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('api.github.com')) return new Response(JSON.stringify({ sha: revision }), { status });
    assert.ok(url.includes(`/${revision}/`));
    assert.equal(options.credentials, 'omit');
    if (options.method === 'HEAD') return new Response(null, { status: missingEditorial ? 404 : 200 });
    const date = url.match(/daily_problems\/(\d{4})\/(\d{2})\/\d{2}(\d{2})\/problems.md/).slice(1).join('-');
    const content = files[date];
    return new Response(content || null, { status: content ? 200 : 404 });
  } };
}

test('parses source hints including math pipes, escaped pipes, and editorial column', () => {
  const row = parseProblems(line(123, 'B1', 'Try $|x|$ and \\|y\\|. | [Editorial](https://example.com)'))[0];
  assert.equal(row.id, 'cf:123:B1');
  assert.equal(row.hint, 'Try $|x|$ and |y|.');
  assert.equal(row.estimated, true);
  assert.throws(() => parseProblems('<html>upstream unavailable</html>'));
  assert.throws(() => parseProblems(`${line()}\n${line()}`));
});

test('old September 19 snapshot gains September 21 recommendations without a deployment', async () => {
  const current = baseline(), before = structuredClone(current);
  const fake = upstream({ '2026-09-19': line(), '2026-09-21': `${line()}\n${line(105109, 'D')}` });
  const refreshed = await refreshCatalog(current, { today: '2026-09-21', request: fake.request, now: () => '2026-09-21T01:00:00Z' });
  assert.deepEqual(current, before);
  assert.equal(refreshed.tasks.length, 3);
  const today = refreshed.tasks.filter(t => t.date === '2026-09-21');
  assert.equal(today.length, 2);
  assert.deepEqual(today[0].categories, ['greedy']);
  assert.match(today[0].editorial, new RegExp(`/blob/${revision}/daily_problems/2026/09/0921/solution/cf101798g.md$`));
  assert.equal(refreshed.source.revision, current.source.revision);
  assert.equal(refreshed.source.liveRevision, revision);
  assert.ok(catalogCheckedToday(refreshed, '2026-09-21'));
  assert.equal(fake.calls.filter(call => call.url.includes('api.github.com')).length, 1);
});

test('same-day refresh replaces revised hints and verifies missing editorials without duplicates', async () => {
  const current = baseline();
  const fake = upstream({ '2026-09-19': line(101798, 'G', 'Updated hint.') }, { missingEditorial: true });
  const refreshed = await refreshCatalog(current, { today: '2026-09-21', request: fake.request });
  assert.equal(refreshed.tasks.length, 1);
  assert.equal(refreshed.tasks[0].hint, 'Updated hint.');
  assert.equal(refreshed.tasks[0].editorial, null);
  assert.equal(refreshed.checkedThrough, '2026-09-21');
});

test('network/API failure and malformed day cannot erase the previous catalog or timestamp', async () => {
  for (const fake of [upstream({}, { status: 403 }), upstream({ '2026-09-19': '<html>Error</html>' }), upstream({})]) {
    const current = baseline(), before = structuredClone(current);
    await assert.rejects(refreshCatalog(current, { today: '2026-09-21', request: fake.request }));
    assert.deepEqual(current, before);
  }
});

test('fills a gap across years and rechecks recent dates using calendar days', () => {
  const current = baseline();
  current.tasks = [task('2025-12-20')];
  const dates = refreshDates(current, '2026-01-02');
  assert.equal(dates[0], '2025-12-20');
  assert.equal(dates.at(-1), '2026-01-02');
  assert.equal(dates.length, 14);
  current.tasks = [task('2024-03-01')];
  assert.ok(refreshDates(current, '2024-03-01').includes('2024-02-29'));
});

test('uses valid newer cache and expires at UTC+8 midnight', () => {
  const bundled = baseline(), cached = { ...baseline(), updatedAt: '2026-09-20T16:00:00Z' };
  assert.equal(newerCatalog(bundled, cached), cached);
  assert.equal(newerCatalog(cached, bundled), cached);
  assert.equal(newerCatalog(bundled, { ...cached, tasks: [] }), bundled);
  assert.ok(catalogCheckedToday(cached, '2026-09-21'));
  assert.equal(catalogCheckedToday(cached, '2026-09-22'), false);
  assert.equal(catalogCheckedToday({ ...cached, error: 'offline' }, '2026-09-21'), false);
  assert.equal(catalogCheckedToday({ ...cached, updatedAt: null }, '2026-09-21'), false);
  assert.equal(catalogCheckedToday({ ...cached, checkedThrough: '2026-09-20' }, '2026-09-21'), false);
  assert.ok(validCatalog(JSON.parse(readFileSync(new URL('../public/data/calendar.json', import.meta.url)))));
});
