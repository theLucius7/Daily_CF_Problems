import test from 'node:test';
import assert from 'node:assert/strict';
import { completion, dayKey, monthCells, shiftMonth, filterTasks, stats, acceptanceDays, activityRange, validateMarks } from '../src/model.js';

const task = { id: 'cf:123:A', date: '2026-09-12', code: 'CF123A', difficulty: 1800, categories: ['graph'], codeUrls: [] };
const base = { publicHistoryComplete: true, problems: {} };

test('personal AC takes precedence; team AC and repository code do not prove individual completion', () => {
  assert.equal(completion(task, base), 'pending');
  assert.equal(completion(task, { ...base, publicHistoryComplete: false }), 'unknown');
  assert.equal(completion({ ...task, codeUrls: ['code'] }, base), 'code');
  assert.equal(completion(task, { ...base, problems: { [task.id]: { soloAttempts: 2 } } }), 'attempted');
  const team = { ...base, problems: { [task.id]: { teamAccepted: { id: 1 }, soloAttempts: 1 } } };
  assert.equal(completion(task, team), 'team');
  assert.equal(completion(task, team, { [task.id]: { completed: true } }), 'manual');
  assert.equal(completion(task, { ...base, problems: { [task.id]: { firstAccepted: { id: 2 } } } }, { [task.id]: { completed: true } }), 'accepted');
});

test('monthly grid starts Monday and correctly includes leap day and a six-row month', () => {
  const february = monthCells('2024-02');
  assert.equal(february[0].date, '2024-01-29');
  assert.equal(february.filter(cell => cell.inMonth).length, 29);
  assert.equal(monthCells('2026-08').length, 42);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('first AC is mapped to its actual UTC+8 date and duplicate recommendations do not inflate totals', () => {
  const progress = { ...base, problems: { [task.id]: { firstAccepted: { at: Date.parse('2026-09-13T17:00:00Z') / 1000 } } } };
  const tasks = [task, { ...task, date: '2026-09-17' }];
  assert.deepEqual(stats(tasks, progress, {}), { total: 1, done: 1, todo: 0, percent: 100 });
  assert.equal(acceptanceDays(tasks, progress).get('2026-09-14').length, 1);
  assert.equal(dayKey(new Date('2026-09-13T17:00:00Z')), '2026-09-14');
  assert.equal(activityRange('2026-09-20').start.getUTCDay(), 1);
});

test('search and filters combine across IDs, names, date, difficulty and completion', () => {
  const tasks = [task, { ...task, id: 'cf:124:B', code: 'CF124B', difficulty: 2200 }];
  const progress = { ...base, problems: { [task.id]: { name: 'Graph Walk', firstAccepted: { id: 1 } } } };
  assert.deepEqual(filterTasks(tasks, { query: 'graph walk', status: 'done', difficulty: 'medium', category: 'graph' }, progress, {}), [task]);
  assert.equal(filterTasks(tasks, { query: '2026-09-12', status: 'todo' }, progress, {}).length, 1);
  assert.equal(filterTasks(tasks, { query: 'nothing' }, progress, {}).length, 0);
});

test('backup import accepts only known problem IDs and valid completion records', () => {
  const mark = { completed: true, updatedAt: '2026-09-20T01:00:00Z' };
  assert.deepEqual(validateMarks({ version: 1, marks: { [task.id]: mark, fake: mark } }, new Set([task.id])), { [task.id]: mark });
  assert.deepEqual(validateMarks({ version: 1, marks: { [task.id]: { ...mark, completed: 'true' } } }, new Set([task.id])), {});
  assert.throws(() => validateMarks({ version: 2 }, new Set()));
});
