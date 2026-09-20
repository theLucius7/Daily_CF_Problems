export const TIMEZONE = 'Asia/Taipei';
export const STATUS = {
  accepted: { label: '已完成', short: 'AC', tone: 'accepted' },
  manual: { label: '已完成 · 手动', short: '自记', tone: 'accepted' },
  attempted: { label: '尝试中', short: '尝试', tone: 'attempted' },
  code: { label: '有代码 · 待核对', short: '代码', tone: 'code' },
  team: { label: '团队 AC', short: '团队', tone: 'team' },
  pending: { label: '未见 AC', short: '待做', tone: 'pending' },
  unknown: { label: '状态未知', short: '未知', tone: 'unknown' },
};

export function dayKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

export function completion(task, progress, marks = {}) {
  const record = progress.problems?.[task.id];
  if (record?.firstAccepted) return 'accepted';
  if (marks[task.id]?.completed === true) return 'manual';
  if (record?.teamAccepted) return 'team';
  if (record?.soloAttempts) return 'attempted';
  if (task.codeUrls?.length) return 'code';
  return progress.publicHistoryComplete ? 'pending' : 'unknown';
}

export function isComplete(status) { return status === 'accepted' || status === 'manual'; }

export function filterTasks(tasks, { query = '', status = 'all', difficulty = 'all', category = 'all' }, progress, marks) {
  const needle = query.trim().toLowerCase();
  return tasks.filter(task => {
    const state = completion(task, progress, marks);
    const name = progress.problems?.[task.id]?.name || '';
    return (!needle || `${task.code} ${task.id} ${name} ${task.date}`.toLowerCase().includes(needle))
      && (status === 'all' || (status === 'done' ? isComplete(state) : status === 'todo' ? !isComplete(state) : state === status))
      && (difficulty === 'all' || (difficulty === 'easy' ? task.difficulty < 1600 : difficulty === 'medium' ? task.difficulty >= 1600 && task.difficulty < 2000 : task.difficulty >= 2000))
      && (category === 'all' || task.categories.includes(category));
  });
}

export function monthCells(month) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const rows = Math.ceil((offset + length) / 7);
  return Array.from({ length: rows * 7 }, (_, i) => {
    const date = new Date(Date.UTC(year, number - 1, i - offset + 1)).toISOString().slice(0, 10);
    return { date, inMonth: date.startsWith(month) };
  });
}

export function shiftMonth(month, delta) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function uniqueTasks(tasks) { return [...new Map(tasks.map(task => [task.id, task])).values()]; }

export function stats(tasks, progress, marks) {
  const unique = uniqueTasks(tasks);
  const done = unique.filter(task => isComplete(completion(task, progress, marks))).length;
  return { total: unique.length, done, todo: unique.length - done, percent: unique.length ? Math.round(done / unique.length * 100) : 0 };
}

export function acceptanceDays(tasks, progress) {
  const days = new Map();
  for (const task of uniqueTasks(tasks)) {
    const evidence = progress.problems?.[task.id]?.firstAccepted;
    if (!evidence) continue;
    const date = dayKey(new Date(evidence.at * 1000));
    days.set(date, [...(days.get(date) || []), task]);
  }
  return days;
}

export function activityRange(endDate) {
  const end = new Date(`${endDate}T12:00:00+08:00`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 182);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return { start, end };
}

export function validateMarks(value, knownIds) {
  if (!value || value.version !== 1 || !value.marks || typeof value.marks !== 'object' || Array.isArray(value.marks)) throw new Error('不是有效的刷题日历备份');
  const marks = {};
  for (const [id, mark] of Object.entries(value.marks)) {
    if (!knownIds.has(id) || !mark || mark.completed !== true || typeof mark.updatedAt !== 'string' || !Number.isFinite(Date.parse(mark.updatedAt))) continue;
    marks[id] = { completed: true, updatedAt: mark.updatedAt };
  }
  return marks;
}
