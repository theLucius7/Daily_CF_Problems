import './style.css';
import 'katex/dist/katex.min.css';
import katex from 'katex';
import { icon } from './icons.js';
import { CATALOG_STORAGE, validCatalog, newerCatalog, catalogCheckedToday, refreshCatalog } from './catalog.js';
import { TIMEZONE, STATUS, dayKey, completion, isComplete, filterTasks, monthCells, shiftMonth, stats, acceptanceDays, activityRange, validateMarks } from './model.js';

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? escape(url.href) : '#'; } catch { return '#'; } };
const link = (url, text, className = '') => `<a class="${className}" href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const prettyDate = date => new Intl.DateTimeFormat('zh-CN', { timeZone: TIMEZONE, month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T12:00:00+08:00`));
const timeText = date => date ? new Intl.DateTimeFormat('zh-CN', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date)) : '尚未同步';
const STORAGE = 'lucius7-calendar:marks:v1';
let today = dayKey();
let catalog, progress, marks = {}, storageAvailable = true, busy = false;
const state = { month: today.slice(0, 7), selected: today, view: 'calendar', mode: 'plan', query: '', status: 'all', difficulty: 'all', category: 'all', limit: 40 };
const categoryNames = { DP: '动态规划', greedy: '贪心', graph: '图论', probabilities: '概率', counting: '计数', games: '博弈', random: '随机化', shortest_path: '最短路', binary_search: '二分', matrix: '矩阵', sortings: '排序', number_theory: '数论', constructive: '构造', trees: '树', strings: '字符串', brain_teaser: '思维', two_pointers: '双指针', data_structures: '数据结构', geometry: '几何', brute_force: '枚举', bitmask: '位运算' };

function readMarks() {
  try {
    const stored = localStorage.getItem(STORAGE);
    marks = stored ? validateMarks(JSON.parse(stored), new Set(catalog.tasks.map(task => task.id))) : {};
  } catch { storageAvailable = false; }
}

function saveMarks(next) {
  try { localStorage.setItem(STORAGE, JSON.stringify({ version: 1, marks: next })); marks = next; return true; }
  catch { storageAvailable = false; toast('浏览器无法保存记录；请启用本地存储后重试。'); return false; }
}

function badge(task) {
  const status = completion(task, progress, marks), info = STATUS[status];
  return `<span class="badge ${info.tone}"><span class="status-dot"></span>${info.label}</span>`;
}

function difficulty(task) {
  return `<span class="difficulty ${task.difficulty >= 2000 ? 'hard' : task.difficulty >= 1600 ? 'medium' : 'easy'}" title="${task.estimated ? '题单估计难度' : '题单收录难度'}">${task.estimated ? '≈ ' : ''}${task.difficulty}</span>`;
}

function hintHTML(text) {
  // Treat source Markdown as text. Only render its math, with KaTeX trust disabled.
  return text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g).map(part => {
    if (!part.startsWith('$')) return escape(part);
    const display = part.startsWith('$$');
    return katex.renderToString(part.slice(display ? 2 : 1, display ? -2 : -1), { throwOnError: false, trust: false, strict: 'ignore', displayMode: display });
  }).join('');
}

function shell() {
  $('#app').innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="刷题日历首页"><span class="brand-mark">L<span>7</span></span><span>刷题日历<small>ONE PROBLEM AT A TIME</small></span></a>
      <div class="workspace-label">我的工作台</div>
      <nav aria-label="主导航">
        <button data-view="calendar" class="nav-item active" aria-label="刷题日历">${icon('calendar')}<span>刷题日历</span></button>
        <button data-view="all" class="nav-item" aria-label="全部题目">${icon('grid')}<span>全部题目</span><span id="all-count" class="nav-count">${stats(catalog.tasks, progress, marks).total}</span></button>
        <button data-view="todo" class="nav-item" aria-label="待完成">${icon('flag')}<span>待完成</span><span id="todo-count" class="nav-count"></span></button>
        <button data-view="done" class="nav-item" aria-label="已完成">${icon('check')}<span>已完成</span></button>
      </nav>
      <div class="sidebar-note"><span class="note-line"></span><p>每天一点，<br>让思考留下痕迹。</p><small>DAILY CF PROBLEMS</small></div>
      <div class="sidebar-bottom">
        <button class="nav-item" id="about-button" aria-label="数据与说明">${icon('info')}<span>数据与说明</span></button>
        ${link('https://github.com/theLucius7/Daily_CF_Problems/tree/codex/lucius7-calendar', `${icon('github')}<span>项目仓库</span>${icon('external')}`, 'nav-item')}
        <div class="profile"><div class="avatar">L7</div><div><strong>Lucius7</strong><small>积累，正在发生</small></div><span class="online-dot"></span></div>
      </div>
    </aside>
    <main>
      <header class="topbar"><div class="breadcrumb">我的工作台<span>/</span><strong id="breadcrumb-view">刷题日历</strong></div><div class="top-actions"><span class="timezone">UTC+8</span><span class="live-pill" id="snapshot-status"></span><button id="refresh" class="button small">${icon('refresh')}<span>同步题单与进度</span></button></div></header>
      <section class="page-heading"><div><div class="eyebrow">LUCIUS7’S PRACTICE JOURNAL</div><h1 id="page-title">把每一次思考，记在日历上<span>。</span></h1><p id="page-subtitle">从一道题开始，看见自己的积累。</p></div><div class="today-label">${icon('calendar')}<div><strong>${today.replaceAll('-', ' / ')}</strong><span>${new Intl.DateTimeFormat('zh-CN', { timeZone: TIMEZONE, weekday: 'long' }).format(new Date())}</span></div></div></section>
      <div id="data-warning" class="data-warning" hidden></div>
      <section id="metrics" class="metrics" aria-label="刷题统计"></section>
      <section class="toolbar" aria-label="题目筛选"><div class="search-box">${icon('search')}<input id="search" type="search" placeholder="搜索题号、题名或日期…" aria-label="搜索题目"><kbd>/</kbd></div><div class="filters"><label class="sr-only" for="status-filter">完成状态</label><select id="status-filter"><option value="all">全部状态</option><option value="done">已完成</option><option value="todo">待完成</option><option value="attempted">尝试中</option><option value="code">有代码待核对</option><option value="team">团队 AC</option><option value="unknown">状态未知</option></select><label class="sr-only" for="difficulty-filter">难度</label><select id="difficulty-filter"><option value="all">全部难度</option><option value="easy">低于 1600</option><option value="medium">1600 – 1999</option><option value="hard">2000 及以上</option></select><label class="sr-only" for="category-filter">专题</label><select id="category-filter"><option value="all">全部专题</option>${[...new Set(catalog.tasks.flatMap(task => task.categories))].sort().map(category => `<option value="${escape(category)}">${escape(categoryNames[category] || category)}</option>`).join('')}</select><button class="text-button" id="clear-filters">重置</button></div></section>
      <div id="content"></div>
      <footer><span>每一道题，都算数。</span><span>题单来自 ${link('https://github.com/Yawn-Sean/Daily_CF_Problems', 'Daily_CF_Problems')}<span class="footer-divider">·</span>公开提交由 Codeforces 核对</span></footer>
    </main>
    <dialog id="about-dialog"><div class="dialog-title"><h2>数据与说明</h2><button class="icon-button" id="close-about" aria-label="关闭说明">×</button></div><div id="about-content"></div></dialog>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
    <div id="toast" role="status" aria-live="polite"></div>`;
  bindShell();
}

function renderMetrics() {
  const all = stats(catalog.tasks, progress, marks);
  const monthly = stats(catalog.tasks.filter(task => task.date.startsWith(state.month)), progress, marks);
  const accepted = Object.entries(progress.problems).filter(([id, record]) => record.firstAccepted && catalog.tasks.some(task => task.id === id)).length;
  $('#metrics').innerHTML = [
    [icon('book'), '收录题目', all.total.toLocaleString(), `${new Set(catalog.tasks.map(task => task.date)).size} 天每日题单`, 'ink'],
    [icon('check'), '累计完成', all.done.toLocaleString(), `${accepted} 题个人 AC${all.done > accepted ? ` · ${all.done - accepted} 题手动记录` : ' · 按题目去重'}`, 'green'],
    [icon('flag'), '待完成', all.todo.toLocaleString(), '尚未确认个人完成的题目', 'orange'],
    [icon('calendar'), `${Number(state.month.slice(5))} 月题单进度`, `${monthly.percent}<small>%</small>`, `${monthly.done} / ${monthly.total} 题已完成`, 'purple'],
  ].map(([symbol, label, number, sub, tone]) => `<article class="metric"><div class="metric-label">${label}<span class="metric-icon ${tone}">${symbol}</span></div><div class="metric-value">${number}</div><div class="metric-sub">${sub}</div>${tone === 'purple' ? `<div class="progress-track"><span style="width:${monthly.percent}%"></span></div>` : ''}</article>`).join('');
  $('#todo-count').textContent = all.todo;
  $('#all-count').textContent = all.total;
  const stale = progress.error || !progress.updatedAt || Date.now() - Date.parse(progress.updatedAt) > 86400000;
  const catalogStale = !catalogCheckedToday(catalog, today);
  $('#snapshot-status').innerHTML = `<span class="status-dot"></span>${catalogStale ? '题单待同步' : stale ? '进度待同步' : '已同步'}`;
  $('#snapshot-status').classList.toggle('stale', Boolean(stale || catalogStale));
  $('#snapshot-status').title = `题单：${timeText(catalog.updatedAt)}；提交：${timeText(progress.updatedAt)}`;
  const messages = [];
  if (progress.error) messages.push('最近同步未成功，正在保留上次进度。');
  else if (stale) messages.push('当前进度为历史快照，可点击「同步题单与进度」核对最新提交。');
  if (catalog.error) messages.push('题单同步暂不可用，正在显示上次成功获取的题单。');
  else if (catalogStale) messages.push('尚未核对今天的题单，可点击「同步题单与进度」更新。');
  if (!storageAvailable) messages.push('本地记录不可用，请检查浏览器存储设置。');
  $('#data-warning').hidden = !messages.length;
  $('#data-warning').textContent = messages.join(' ');
}

function visibleTasks() { return filterTasks(catalog.tasks, state, progress, marks); }

function groupDays(tasks) {
  if (state.mode === 'ac') return acceptanceDays(tasks, progress);
  const groups = new Map();
  for (const task of tasks) groups.set(task.date, [...(groups.get(task.date) || []), task]);
  return groups;
}

function render() {
  renderMetrics();
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === state.view); button.setAttribute('aria-current', button.dataset.view === state.view ? 'page' : 'false'); });
  const titles = { calendar: '刷题日历', all: '全部题目', todo: '待完成', done: '已完成' };
  $('#breadcrumb-view').textContent = titles[state.view];
  $('#status-filter').value = state.status;
  $('#difficulty-filter').value = state.difficulty;
  $('#category-filter').value = state.category;
  $('#category-filter').innerHTML = '<option value="all">全部专题</option>' + [...new Set(catalog.tasks.flatMap(task => task.categories))].sort().map(category => `<option value="${escape(category)}">${escape(categoryNames[category] || category)}</option>`).join('');
  $('#category-filter').value = state.category;
  const tasks = visibleTasks();
  if (state.view === 'calendar') renderCalendar(tasks); else renderList(tasks);
}

function renderCalendar(tasks) {
  const groups = groupDays(tasks);
  const fullGroups = groupDays(catalog.tasks);
  const [year, month] = state.month.split('-');
  const cells = monthCells(state.month);
  const allMonths = [...new Set([...catalog.tasks.map(task => task.date.slice(0, 7)), ...acceptanceDays(catalog.tasks, progress).keys()].map(date => date.slice(0, 7)).concat(today.slice(0, 7), state.month))].sort().reverse();
  const inMonth = [...groups].filter(([date]) => date.startsWith(state.month)).reduce((sum, [, values]) => sum + values.length, 0);
  $('#content').innerHTML = `<div class="calendar-layout"><section class="calendar-panel panel">
    <div class="calendar-heading"><div class="month-heading"><h2>${year}<span>年</span> ${Number(month)}<span>月</span></h2><span class="month-en">${new Date(`${state.month}-01T12:00:00`).toLocaleString('en-US', { month: 'long' }).toUpperCase()}</span></div><div class="calendar-controls"><label class="sr-only" for="month-picker">跳转月份</label><select id="month-picker">${allMonths.map(value => `<option value="${value}" ${value === state.month ? 'selected' : ''}>${value.replace('-', ' 年 ')} 月</option>`).join('')}</select><button id="prev-month" class="icon-button" aria-label="上个月">${icon('chevron', 'rotate')}</button><button id="go-today" class="button small">今天</button><button id="next-month" class="icon-button" aria-label="下个月">${icon('chevron')}</button></div></div>
    <div class="calendar-options"><div class="segmented" aria-label="日历日期依据"><button data-mode="plan" class="${state.mode === 'plan' ? 'selected' : ''}" aria-pressed="${state.mode === 'plan'}">题单日期</button><button data-mode="ac" class="${state.mode === 'ac' ? 'selected' : ''}" aria-pressed="${state.mode === 'ac'}">首次 AC 日期</button></div><span class="result-count">本月 ${inMonth} ${state.mode === 'ac' ? '题首次 AC' : '条推荐'}</span></div>
    <div class="weekdays">${['一', '二', '三', '四', '五', '六', '日'].map(day => `<span>${day}</span>`).join('')}</div>
    <div class="calendar-grid" role="group" aria-label="${year} 年 ${Number(month)} 月日历">${cells.map(({ date, inMonth }) => {
      const list = groups.get(date) || [], all = fullGroups.get(date) || [];
      const done = list.filter(task => isComplete(completion(task, progress, marks))).length;
      return `<button class="day ${!inMonth ? 'outside' : ''} ${date === today ? 'today' : ''} ${date === state.selected ? 'selected-day' : ''} ${list.length && done === list.length ? 'all-done' : ''}" data-date="${date}" aria-pressed="${date === state.selected}" aria-label="${date}，${list.length} 题，${done} 题完成"><div class="day-top"><span class="day-number">${Number(date.slice(8))}</span>${date === today ? '<span class="today-tag">今天</span>' : done ? `<span class="day-check">${icon('check')}</span>` : ''}</div><div class="day-problems">${list.slice(0, 2).map(task => `<span class="day-problem ${STATUS[completion(task, progress, marks)].tone}"><span class="status-dot"></span><span>${escape(task.code.replace('GYM', ''))}</span><span class="cell-rating">${task.difficulty}</span></span>`).join('')}${list.length > 2 ? `<span class="day-more">+${list.length - 2} 题</span>` : !list.length && inMonth ? `<span class="day-empty">${date > today ? '—' : all.length ? '已筛选' : state.mode === 'ac' ? '—' : new Date(`${date}T12:00:00`).getDay() === 0 ? '休息日' : '无题单'}</span>` : ''}</div>${list.length ? `<div class="day-progress"><span style="width:${done / list.length * 100}%"></span></div>` : ''}</button>`;
    }).join('')}</div>
    <div class="calendar-legend"><span><i class="legend-dot accepted"></i>已完成</span><span><i class="legend-dot attempted"></i>尝试中 / 有代码</span><span><i class="legend-dot team"></i>团队 AC</span><span><i class="legend-dot pending"></i>未确认完成</span></div>
    <div class="calendar-footnote">${state.mode === 'plan' ? '日期是题目发布到题单的日期；完成状态按最新快照显示。' : '仅统计当前题单内、公开记录中的首次个人 AC，日期按 UTC+8。'}</div>
    </section><aside id="day-detail" class="detail-panel panel" aria-label="所选日期题目"></aside></div>
    ${renderActivity()}`;
  renderDetail(groups);
  $('#prev-month').onclick = () => changeMonth(shiftMonth(state.month, -1));
  $('#next-month').onclick = () => changeMonth(shiftMonth(state.month, 1));
  $('#month-picker').onchange = event => changeMonth(event.target.value);
  $('#go-today').onclick = () => { updateToday(); state.month = today.slice(0, 7); state.selected = today; render(); };
  document.querySelectorAll('[data-date]').forEach(button => button.onclick = () => { state.selected = button.dataset.date; state.month = state.selected.slice(0, 7); render(); });
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => { state.mode = button.dataset.mode; render(); });
  bindProblemActions();
}

function changeMonth(month) {
  state.month = month;
  const dates = [...groupDays(visibleTasks()).keys()].filter(date => date.startsWith(month)).sort();
  state.selected = month === today.slice(0, 7) ? today : dates.at(-1) || `${month}-01`;
  render();
}

function renderDetail(groups) {
  const tasks = groups.get(state.selected) || [];
  const total = (groupDays(catalog.tasks).get(state.selected) || []).length;
  $('#day-detail').innerHTML = `<div class="detail-header"><div class="eyebrow">${state.mode === 'plan' ? 'DAILY PRACTICE' : 'FIRST ACCEPTED'}</div><h2>${prettyDate(state.selected)}</h2><p>${tasks.length ? `${tasks.length} 道题 · ${tasks.filter(task => isComplete(completion(task, progress, marks))).length} 道已完成` : '留一点时间，给下一次思考'}</p></div><div class="detail-body">${tasks.length ? tasks.map(task => problemCard(task)).join('') : `<div class="empty-state"><span class="empty-illustration">${icon(state.mode === 'ac' ? 'check' : 'book')}</span><h3>${total ? '没有符合筛选的题目' : state.mode === 'ac' ? '这一天没有首次 AC' : state.selected > today ? '题单尚未发布' : catalogCheckedToday(catalog, today) ? '上游暂未发布这天的题单' : '这天的题单尚未同步'}</h3><p>${total ? '试试调整筛选条件。' : state.mode === 'ac' ? '这里只显示题单内的个人 AC 记录。' : '可以翻翻之前的题目，继续上一次的思考。'}</p><button class="button" id="open-backlog">查看待完成 ${icon('arrow')}</button></div>`}</div><div class="detail-tip">${icon('bulb')}<span>先想一想，再展开提示。</span></div>`;
  if ($('#open-backlog')) $('#open-backlog').onclick = () => switchView('todo');
}

function problemCard(task, list = false) {
  const record = progress.problems[task.id], current = completion(task, progress, marks);
  const title = record?.name || task.code;
  const evidence = record?.firstAccepted || record?.teamAccepted;
  return `<article class="problem-card ${list ? 'list-card' : ''}"><div class="problem-top"><span class="problem-code">${escape(task.code)}</span>${difficulty(task)}</div><h3>${link(task.url, `${escape(title)} ${icon('external')}`)}</h3><div class="problem-status">${badge(task)}${list ? `<button class="date-link" data-jump-date="${task.date}">${task.date}</button>` : ''}</div>
    <div class="problem-actions">${link(task.url, `去做题 ${icon('arrow')}`, 'solve-link')}${task.editorial ? link(task.editorial, `${icon('book')} 题解`, 'editorial-link') : '<span class="no-editorial">题解暂缺</span>'}</div>
    <details class="hint"><summary>${icon('bulb')}<span>给我一点提示</span>${icon('chevron')}</summary><div class="hint-content">${hintHTML(task.hint || '这道题暂无提示。')}${task.categories.length ? `<div class="tags">${task.categories.map(category => `<span>${escape(categoryNames[category] || category)}</span>`).join('')}</div>` : ''}</div></details>
    ${evidence ? `<p class="evidence">${icon('check')}${link(evidence.url, `${record.firstAccepted ? '个人 AC' : '团队 AC'} · ${timeText(evidence.at * 1000)}`)}</p>` : record?.latest ? `<p class="evidence">${icon('clock')}${link(record.latest.url, `最近提交：${escape(record.latest.verdict)}`)}</p>` : ''}
    ${task.codeUrls.length ? `<div class="code-links">${task.codeUrls.map((url, i) => link(url, `${icon('code')} 我的代码${task.codeUrls.length > 1 ? ` ${i + 1}` : ''}`)).join('')}</div>` : ''}
    ${current !== 'accepted' ? `<button class="manual-button ${current === 'manual' ? 'marked' : ''}" data-mark="${escape(task.id)}" aria-pressed="${current === 'manual'}">${icon(current === 'manual' ? 'check' : 'flag')}${current === 'manual' ? '撤销手动完成' : '标记我已完成'}</button>` : ''}
    ${current === 'manual' ? '<small class="manual-note">个人记录 · 保存在此浏览器</small>' : ''}
    </article>`;
}

function renderList(tasks) {
  const sorted = [...tasks].sort((a, b) => b.date.localeCompare(a.date) || a.difficulty - b.difficulty);
  $('#content').innerHTML = `<section class="panel archive"><div class="archive-heading"><div><h2>${state.view === 'todo' ? '下一道，慢慢来' : state.view === 'done' ? '走过的每一步' : '题目档案'}</h2><p>共 ${new Set(tasks.map(task => task.id)).size} 道题 · ${tasks.length} 条推荐 · 按题单日期从新到旧</p></div><span class="archive-icon">${icon(state.view === 'done' ? 'check' : 'book')}</span></div>${tasks.length ? `<div class="problem-list">${sorted.slice(0, state.limit).map(task => problemCard(task, true)).join('')}</div>${tasks.length > state.limit ? `<div class="load-more"><button class="button" id="load-more">再看 ${Math.min(40, tasks.length - state.limit)} 条推荐</button><span>已显示 ${Math.min(state.limit, tasks.length)} / ${tasks.length} 条</span></div>` : ''}` : `<div class="empty-state"><span class="empty-illustration">${icon('search')}</span><h3>没有找到匹配的题目</h3><p>换一个题号，或重置筛选试试。</p><button id="empty-reset" class="button">重置筛选</button></div>`}</section>`;
  if ($('#load-more')) $('#load-more').onclick = () => { state.limit += 40; renderList(tasks); };
  if ($('#empty-reset')) $('#empty-reset').onclick = resetFilters;
  bindProblemActions();
}

function renderActivity() {
  const accepted = acceptanceDays(catalog.tasks, progress);
  const { start, end } = activityRange(today);
  let total = 0, active = 0;
  const days = [];
  for (let value = new Date(start); value <= end; value.setUTCDate(value.getUTCDate() + 1)) {
    const date = dayKey(value), count = accepted.get(date)?.length || 0;
    total += count; if (count) active++;
    days.push(`<button class="heat-cell heat-${Math.min(4, count)}" data-heat-date="${date}" title="${date}：${count} 道题单内首次个人 AC" aria-label="${date}：${count} 道首次个人 AC"></button>`);
  }
  return `<section class="panel activity"><div class="activity-heading"><div><h2>积累的痕迹</h2><p>近半年 · ${total} 道题单内首次个人 AC · ${active} 个活跃日</p></div><span class="activity-caption">每一个小格，都是认真思考过的一天。</span></div><div class="heatmap-wrap"><div class="heat-labels"><span>一</span><span>三</span><span>五</span><span>日</span></div><div class="heatmap">${days.join('')}</div></div><div class="heatmap-footer"><span>${dayKey(start)} — ${today}</span><div>少 ${[0,1,2,3,4].map(level => `<i class="heat-cell heat-${level}"></i>`).join('')} 多</div></div></section>`;
}

function bindProblemActions() {
  document.querySelectorAll('[data-mark]').forEach(button => button.onclick = () => {
    const id = button.dataset.mark, next = { ...marks };
    if (next[id]) delete next[id]; else next[id] = { completed: true, updatedAt: new Date().toISOString() };
    if (saveMarks(next)) { render(); toast(next[id] ? '已记录完成。可在「数据与说明」导出备份。' : '已撤销手动记录。'); }
  });
  document.querySelectorAll('[data-jump-date]').forEach(button => button.onclick = () => { state.view = 'calendar'; state.mode = 'plan'; state.selected = button.dataset.jumpDate; state.month = state.selected.slice(0, 7); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.querySelectorAll('[data-heat-date]').forEach(button => button.onclick = () => { state.mode = 'ac'; state.selected = button.dataset.heatDate; state.month = state.selected.slice(0, 7); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

function switchView(view) {
  state.view = view; state.limit = 40;
  state.status = view === 'todo' ? 'todo' : view === 'done' ? 'done' : 'all';
  render();
}

function resetFilters() { state.query = ''; state.status = 'all'; state.difficulty = 'all'; state.category = 'all'; state.limit = 40; if (state.view !== 'calendar') state.view = 'all'; $('#search').value = ''; render(); }

function bindShell() {
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => switchView(button.dataset.view));
  $('.brand').onclick = event => { event.preventDefault(); switchView('calendar'); };
  $('#search').oninput = event => { state.query = event.target.value; state.limit = 40; if (state.query && state.view === 'calendar') state.view = 'all'; render(); };
  for (const key of ['status', 'difficulty', 'category']) $(`#${key}-filter`).onchange = event => { state[key] = event.target.value; state.limit = 40; if (key === 'status' && state.view !== 'calendar') state.view = 'all'; render(); };
  $('#clear-filters').onclick = resetFilters;
  $('#refresh').onclick = () => syncData();
  $('#about-button').onclick = openAbout;
  $('#close-about').onclick = () => $('#about-dialog').close();
  $('#about-dialog').onclick = event => { if (event.target === $('#about-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } };
  document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('#about-dialog').open) { event.preventDefault(); $('#search').focus(); } });
  $('#import-file').onchange = importMarks;
}

let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('show'); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }

async function fetchProgress() {
  const entries = new Map();
  for (let from = 1; ; from += 10000) {
    const response = await fetch(`https://codeforces.com/api/user.status?handle=Lucius7&from=${from}&count=10000`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.status !== 'OK' || !Array.isArray(body.result)) throw new Error(body.comment || '数据格式异常');
    body.result.forEach(row => entries.set(row.id, row));
    if (body.result.length < 10000) break;
    await new Promise(resolve => setTimeout(resolve, 2200));
  }
  const problems = {};
  for (const row of [...entries.values()].sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id)) {
    const { problem, author } = row;
    if (!problem?.contestId || !author?.members?.some(member => member.handle.toLowerCase() === 'lucius7')) continue;
    const id = `cf:${problem.contestId}:${problem.index.toUpperCase()}`;
    const entry = problems[id] ||= { name: problem.name, attempts: 0, soloAttempts: 0, firstAccepted: null, teamAccepted: null };
    const team = Boolean(author.teamId) || author.members.length !== 1;
    entry.attempts++; if (!team) entry.soloAttempts++;
    const evidence = { id: row.id, at: row.creationTimeSeconds, verdict: row.verdict || 'TESTING', url: `https://codeforces.com/${problem.contestId >= 100000 ? 'gym' : 'contest'}/${problem.contestId}/submission/${row.id}` };
    entry.latest = evidence;
    if (row.verdict === 'OK') entry[team ? 'teamAccepted' : 'firstAccepted'] ||= evidence;
  }
  return { ...progress, problems, submissionCount: entries.size, publicHistoryComplete: true, error: null, updatedAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString() };
}

async function fetchCatalog() {
  let baseline = catalog;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/calendar.json`, { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
    if (response.ok) baseline = newerCatalog(baseline, await response.json());
  } catch { /* The current catalog can still be refreshed directly from upstream. */ }
  return refreshCatalog(baseline, { today });
}

function updateToday() {
  const next = dayKey();
  if (next === today) return false;
  if (state.selected === today) { state.selected = next; state.month = next.slice(0, 7); }
  today = next;
  $('.today-label strong').textContent = today.replaceAll('-', ' / ');
  $('.today-label div span').textContent = new Intl.DateTimeFormat('zh-CN', { timeZone: TIMEZONE, weekday: 'long' }).format(new Date());
  return true;
}

async function syncData({ catalogOnly = false, quiet = false } = {}) {
  if (busy) return;
  updateToday();
  const syncDay = today;
  busy = true; $('#refresh').disabled = true; $('#refresh').classList.add('syncing'); $('#refresh span').textContent = '正在同步';
  try {
    const oldKeys = new Set(catalog.tasks.map(task => task.key));
    const results = await Promise.allSettled([fetchCatalog(), ...(catalogOnly ? [] : [fetchProgress()])]);
    const messages = [];
    if (results[0].status === 'fulfilled') {
      catalog = results[0].value;
      readMarks();
      try { localStorage.setItem(CATALOG_STORAGE, JSON.stringify(catalog)); } catch { /* Keep the in-memory catalog. */ }
      const added = catalog.tasks.filter(task => !oldKeys.has(task.key)).length;
      messages.push(added ? `新增 ${added} 条题目推荐` : '题单已核对');
      if (!catalog.tasks.some(task => task.date === today)) messages.push('上游暂未发布今日题单');
    } else {
      catalog = { ...catalog, error: String(results[0].reason.message) };
      messages.push('题单同步失败，已保留原题单');
    }
    if (results[1]?.status === 'fulfilled') {
      progress = results[1].value;
      try { localStorage.setItem('lucius7-calendar:progress:v1', JSON.stringify(progress)); } catch { /* Keep the in-memory progress. */ }
      messages.push(`已核对 ${progress.submissionCount.toLocaleString()} 条公开提交`);
    } else if (results[1]?.status === 'rejected') {
      progress = { ...progress, error: String(results[1].reason.message), lastAttemptAt: new Date().toISOString() };
      messages.push('进度同步失败，已保留原进度');
    }
    render();
    if (!quiet || results.some(result => result.status === 'rejected')) toast(messages.join('；') + '。');
  } finally {
    busy = false; $('#refresh').disabled = false; $('#refresh').classList.remove('syncing'); $('#refresh span').textContent = '同步题单与进度';
    updateToday();
    if (today !== syncDay) void syncData({ catalogOnly: true, quiet: true });
  }
}

function openAbout() {
  $('#about-content').innerHTML = `<p>这里记录的是 <strong>Daily_CF_Problems 题单内</strong>的做题情况。</p><dl class="source-list"><dt>题单快照</dt><dd>${timeText(catalog.updatedAt)} · ${catalog.tasks.length} 条推荐</dd><dt>提交快照</dt><dd>${timeText(progress.updatedAt)} · ${progress.submissionCount} 条公开提交</dd><dt>完整题单版本</dt><dd>${link(`https://github.com/${catalog.source.repository}/commit/${catalog.source.revision}`, catalog.source.revision.slice(0, 10))}</dd>${catalog.source.liveRevision ? `<dt>近期题单版本</dt><dd>${link(`https://github.com/${catalog.source.repository}/commit/${catalog.source.liveRevision}`, catalog.source.liveRevision.slice(0, 10))} · ${catalog.source.liveFrom} — ${catalog.source.liveThrough}</dd>` : ''}</dl><h3>怎样判断完成？</h3><p><strong>已完成</strong>：查到 Lucius7 的单人 AC，或你主动手动标记。团队 AC、有代码、尝试中均单独显示，不自动计入个人完成。</p><p><strong>未见 AC</strong>：公开提交里尚未找到个人通过记录，不代表私有比赛或其他账号一定没做过。接口不可用且没有历史快照时显示“状态未知”。</p><p>月历默认按<strong>题单发布日期</strong>排列，也可切换到首次个人 AC 日期。所有日期采用 Asia/Taipei（UTC+8）。难度前的 <strong>≈</strong> 保留题单原有的 <strong>*</strong> 标记，表示估计难度。</p><p>提示与题解来自原题单，默认折叠提示；专题标签也放在提示中，以免提前透露解法。</p><h3>更新与本地记录</h3><p>「同步题单与进度」同时读取上游新题与 Codeforces 公开提交，并缓存到当前浏览器。打开页面时，若题单跨天或缺少今日题目，会自动核对，最近一周的提示和题解也会重新检查；历史专题和代码索引随部署完整更新。当前收录至 <strong>${catalog.tasks.at(-1).date}</strong>。</p><p>手动完成保存在此浏览器，清理浏览器数据后会丢失。可导出备份，在其他设备导入；导入会合并记录。</p><div class="backup-actions"><button id="export-marks" class="button">${icon('download')}导出手动记录</button><button id="import-marks" class="button">${icon('upload')}导入记录</button></div><p class="source-links">${link('https://codeforces.com/apiHelp/methods#user.status', 'Codeforces API 说明')}${link('https://github.com/Yawn-Sean/Daily_CF_Problems', '原始题单')}</p>`;
  $('#export-marks').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, handle: 'Lucius7', marks }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Lucius7-calendar-${today}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('#import-marks').onclick = () => $('#import-file').click();
  $('#about-dialog').showModal();
}

async function importMarks(event) {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2000000) throw new Error('备份文件过大');
    const incoming = validateMarks(JSON.parse(await file.text()), new Set(catalog.tasks.map(task => task.id)));
    if (saveMarks({ ...marks, ...incoming })) { render(); toast(`已合并 ${Object.keys(incoming).length} 条手动记录。`); }
  } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
}

async function start() {
  try {
    const responses = await Promise.all(['calendar', 'progress'].map(name => fetch(`${import.meta.env.BASE_URL}data/${name}.json`, { cache: 'no-cache' }).then(response => { if (!response.ok) throw new Error(`${name} ${response.status}`); return response.json(); })));
    [catalog, progress] = responses;
    if (!validCatalog(catalog) || !progress.problems || progress.handle !== 'Lucius7') throw new Error('数据格式异常');
    try {
      catalog = newerCatalog(catalog, JSON.parse(localStorage.getItem(CATALOG_STORAGE) || 'null'));
      const cached = JSON.parse(localStorage.getItem('lucius7-calendar:progress:v1') || 'null');
      if (cached?.schemaVersion === 1 && cached.handle === 'Lucius7' && cached.problems && Date.parse(cached.updatedAt) > Date.parse(progress.updatedAt || 0)) progress = cached;
    } catch { /* Use the bundled snapshot when storage is unavailable. */ }
    readMarks(); shell(); render();
    if (!catalogCheckedToday(catalog, today) || !catalog.tasks.some(task => task.date === today)) void syncData({ catalogOnly: true, quiet: true });
    const checkDay = () => { if (!document.hidden && updateToday()) { render(); void syncData({ catalogOnly: true, quiet: true }); } };
    window.addEventListener('focus', checkDay);
    document.addEventListener('visibilitychange', checkDay);
    setInterval(checkDay, 60000);
  } catch (error) {
    $('#app').innerHTML = `<div class="boot-error">${icon('book')}<h1>日历暂时没有打开</h1><p>数据加载失败，请检查连接后重试。</p><button class="button" id="retry">重新加载</button><details><summary>错误详情</summary>${escape(error.message)}</details></div>`;
    $('#retry').onclick = () => location.reload();
  }
}

start();
