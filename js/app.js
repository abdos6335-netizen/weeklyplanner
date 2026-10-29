// WeeklyPlanner — المرحلة 1: الدخول، المهام الأسبوعية، الإعدادات والثيم.
import { createStore } from './store.js';
import { t, setLang, lang, dir, locale } from './i18n.js';
import * as D from './dates.js';
import { icon, badge } from './icons.js';
import {
  applyTheme, mergeTheme, DEFAULT_THEME, PRESETS, FONTS, ensureFont,
  effectiveMode, shownColors, watchSystemMode,
} from './theme.js';

const VERSION = '2.0.0';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const DEFAULT_SETTINGS = { id: 'prefs', lang: 'ar', weekStartDay: 6, accordion: 'single', theme: DEFAULT_THEME };

const S = {
  store: null,
  user: null,
  tasks: [],
  projects: [],
  deliverables: [],
  financeEntries: [],
  activeProjectId: null,
  settings: mergeSettings(null),
  section: 'tasks',
  prevSection: 'tasks',
  week: null,
  sel: null,
  openGroups: new Set(['appearance']),
  unsubs: [],
  lastSettingsTouch: 0,
  saveTimer: null,
  sheet: null,
};

function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  s.theme = mergeTheme(saved && saved.theme);
  s.id = 'prefs';
  return s;
}

// ================================================================== المهام: نموذج البيانات
function normalizeTask(raw, trustId = false) {
  const date = D.isValidISO(raw.date) ? raw.date : null;
  const now = Date.now();
  const idOk = typeof raw.id === 'string' && (trustId ? raw.id.length > 0 : /^[A-Za-z0-9_-]{1,64}$/.test(raw.id));
  return {
    id: idOk ? raw.id : uid(),
    title: String(raw.title ?? '').slice(0, 300),
    notes: String(raw.notes ?? '').slice(0, 5000),
    date,
    weekRef: D.isValidISO(raw.weekRef) ? raw.weekRef : (date || D.todayISO()),
    priority: [1, 2, 3].includes(Number(raw.priority)) ? Number(raw.priority) : 2,
    status: ['todo', 'doing', 'done'].includes(raw.status) ? raw.status : 'todo',
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    doneAt: raw.doneAt ? Number(raw.doneAt) : null,
    projectId: raw.projectId ?? null,
  };
}

const startDay = () => S.settings.weekStartDay;
const isDone = (x) => x.status === 'done';
const weekOfTask = (x) => D.weekStartOf(x.date || x.weekRef, startDay());
const cmpTasks = (a, b) =>
  (isDone(a) - isDone(b)) || (b.priority - a.priority) || (a.createdAt - b.createdAt);

// ================================================================== الإقلاع
async function boot() {
  try {
    const c = JSON.parse(localStorage.getItem('wp1:settings-cache'));
    if (c) S.settings = mergeSettings(c);
  } catch { /* تجاهل */ }
  applySettings(false);
  watchSystemMode(() => { S.settings.theme = applyTheme(S.settings.theme); cacheSettings(); });
  $('#app').innerHTML = `<div class="center muted">${t('loading')}</div>`;
  bindEvents();
  try {
    S.store = await createStore();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="login"><div class="card login-card"><p>${esc(t('cloud_failed'))}</p><button class="btn primary" data-action="reload">↻</button></div></div>`;
    return;
  }
  S.store.onAuth(onAuth);
  registerSW();
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function onAuth(user) {
  S.unsubs.forEach((u) => u()); S.unsubs = [];
  S.user = user;
  S.tasks = []; S.projects = []; S.deliverables = []; S.financeEntries = [];
  if (!user) { renderLogin(); return; }
  const today = D.todayISO();
  S.sel = today;
  S.week = D.weekStartOf(today, startDay());
  S.unsubs.push(S.store.watch('settings', (docs) => {
    const d = docs.find((x) => x.id === 'prefs');
    if (d && Date.now() - S.lastSettingsTouch > 1500) {
      S.settings = mergeSettings(d);
      applySettings(true);
    }
  }));
  S.unsubs.push(S.store.watch('tasks', (docs) => { S.tasks = docs.map((d) => normalizeTask(d, true)); if (S.section === 'tasks') render(); }));
  S.unsubs.push(S.store.watch('projects', (docs) => { S.projects = docs; if (S.section === 'projects' || S.section === 'finance') render(); }));
  S.unsubs.push(S.store.watch('deliverables', (docs) => { S.deliverables = docs; if (S.section === 'projects') render(); }));
  S.unsubs.push(S.store.watch('financeEntries', (docs) => { S.financeEntries = docs; if (S.section === 'finance' || S.section === 'projects') render(); }));
  render();
  const q = new URLSearchParams(location.search);
  if (q.get('new') === '1') { history.replaceState(null, '', location.pathname); openSheet(null); }
}

function applySettings(rerender) {
  setLang(S.settings.lang);
  S.settings.theme = applyTheme(S.settings.theme);
  document.title = t('app');
  cacheSettings();
  if (rerender && S.user) render();
}

function cacheSettings() {
  try {
    localStorage.setItem('wp1:settings-cache', JSON.stringify(S.settings));
    localStorage.setItem('wp1:bg', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  } catch { /* تجاهل */ }
}

// ================================================================== الإعدادات: حفظ وتحديث
function persistSettings() {
  clearTimeout(S.saveTimer);
  if (!S.user) return; // قبل تسجيل الدخول تُحفَظ الإعدادات محليًا فقط (كاش الإقلاع)
  S.saveTimer = setTimeout(() => {
    S.lastSettingsTouch = Date.now();
    Promise.resolve(S.store.save('settings', S.settings)).catch((e) => toast(t('save_failed', { msg: e.message || e })));
  }, 350);
}

function updateTheme(fn, { render: doRender = false } = {}) {
  fn(S.settings.theme);
  S.settings.theme = applyTheme(S.settings.theme);
  cacheSettings();
  S.lastSettingsTouch = Date.now();
  persistSettings();
  if (doRender) render();
}

function updateSettings(patch, { render: doRender = true } = {}) {
  Object.assign(S.settings, patch);
  S.lastSettingsTouch = Date.now();
  applySettings(false);
  persistSettings();
  if (doRender) render();
}

// ================================================================== العرض الرئيسي
function render() {
  if (!S.user) return;
  const y = window.scrollY;
  $('#app').innerHTML = shell();
  window.scrollTo(0, y);
}

function navList() {
  return [['tasks', 'nav_tasks'], ['projects', 'nav_projects'], ['finance', 'nav_finance']];
}

function shell() {
  const sec = S.section;
  const rtl = dir() === 'rtl';
  const nav = navList();
  const title = sec === 'settings' ? t('settings') : sec === 'tasks' ? t('tasks_title') : t('nav_' + sec);
  const content = sec === 'tasks' ? renderTasks() : sec === 'settings' ? renderSettings() : sec === 'projects' ? renderProjects() : sec === 'finance' ? renderFinance() : renderTasks();
  return `
  <div class="shell">
    <nav class="rail glass" aria-label="main">
      <img class="rail-logo" src="icons/logo.svg" alt="WeeklyPlanner" width="44" height="44">
      ${nav.map(([id, key]) => `
        <button class="nav-item ${sec === id ? 'on' : ''}" data-action="nav" data-section="${id}">
          ${badge(id, 22)}<span>${t(key)}</span>
        </button>`).join('')}
    </nav>
    <main class="main">
      <header class="topbar">
        <div class="tb-start">
          ${sec === 'settings' ? `<button class="btn icon-btn" data-action="back" aria-label="${t('cancel')}">${icon(rtl ? 'chevR' : 'chevL', 20)}</button>` : ''}
          <h1>${esc(title)}</h1>
        </div>
        ${sec !== 'settings' ? `<button class="btn icon-btn" data-action="open-settings" aria-label="${t('settings')}">${badge('settings', 20)}</button>` : ''}
      </header>
      ${content}
    </main>
    <nav class="tabbar glass" aria-label="main">
      ${nav.map(([id, key]) => `
        <button class="tab ${sec === id ? 'on' : ''}" data-action="nav" data-section="${id}">
          ${badge(id, 21)}<span>${t(key)}</span>
        </button>`).join('')}
    </nav>
    ${sec === 'tasks' ? `<button class="fab" data-action="add" aria-label="${t('new_task')}">${icon('plus', 26)}<span>${t('new_task')}</span></button>` : sec === 'projects' ? `<button class="fab" data-action="new-project" aria-label="${t('new_project')}">${icon('plus', 26)}<span>${t('new_project')}</span></button>` : ''}
  </div>`;
}

// ================================================================== شاشة الدخول
function renderLogin(err) {
  const cloud = S.store && S.store.mode === 'cloud';
  $('#layer').innerHTML = '';
  $('#app').innerHTML = `
  <div class="login">
    <div class="card login-card glass">
      <img class="logo" src="icons/logo.svg" alt="" width="96" height="96">
      <h1>${t('app')}</h1>
      <p class="muted">${t('tagline')}</p>
      <button class="btn primary big" id="login-btn" data-action="login">
        ${icon(cloud ? 'user' : 'device', 20)} ${cloud ? t('signin_google') : t('start_local')}
      </button>
      <p class="note">${cloud ? t('cloud_note') : t('local_note')}</p>
      <div class="err" id="login-err">${err ? esc(err) : ''}</div>
      <button class="btn ghost" data-action="login-lang">${lang() === 'ar' ? 'English' : 'العربية'}</button>
    </div>
  </div>`;
}

// ================================================================== قسم المهام
function weekLabel(ws) {
  const we = D.addDays(ws, 6);
  const d1 = D.parse(ws), d2 = D.parse(we);
  const loc = locale();
  const sameMonth = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear();
  const a = D.fmt(ws, loc, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const yr = d2.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {};
  const b = D.fmt(we, loc, { day: 'numeric', month: 'short', ...yr });
  return `${a} – ${b}`;
}

function renderTasks() {
  const loc = locale();
  const rtl = dir() === 'rtl';
  const today = D.todayISO();
  const ws = S.week;
  const curWs = D.weekStartOf(today, startDay());
  const days = D.weekDays(ws);
  if (!days.includes(S.sel)) S.sel = days.includes(today) ? today : days[0];

  const inWeek = S.tasks.filter((x) => weekOfTask(x) === ws);
  const done = inWeek.filter(isDone).length;
  const doing = inWeek.filter((x) => x.status === 'doing').length;
  const overdueOld = ws === curWs ? S.tasks.filter((x) => !isDone(x) && weekOfTask(x) < ws).sort(cmpTasks) : [];
  const lateInWeek = ws === curWs ? inWeek.filter((x) => !isDone(x) && x.date && x.date < today).length : 0;
  const late = lateInWeek + overdueOld.length;
  const pct = inWeek.length ? Math.round((done / inWeek.length) * 100) : 0;
  const C = 2 * Math.PI * 26;

  const row = (x, ctx = {}) => {
    const lateNow = !isDone(x) && x.date && x.date < today;
    const chips = [];
    if (x.priority === 3) chips.push(`<span class="chip p3">${icon('flag', 13)}${t('p_high')}</span>`);
    if (x.priority === 1) chips.push(`<span class="chip p1">${icon('flag', 13)}${t('p_low')}</span>`);
    if (x.status === 'doing') chips.push(`<span class="chip doing">${icon('play', 13)}${t('in_progress')}</span>`);
    if (lateNow) chips.push(`<span class="chip late">${icon('clock', 13)}${t('late')}</span>`);
    if (ctx.showDate && x.date) chips.push(`<span class="chip">${icon('calendar', 13)}${esc(D.fmt(x.date, loc, { day: 'numeric', month: 'short' }))}</span>`);
    const mark = x.status === 'done' ? icon('check', 16) : x.status === 'doing' ? icon('play', 14) : '';
    return `
    <div class="task ${isDone(x) ? 'done' : ''} ${x.status === 'doing' ? 'doing' : ''}" data-id="${esc(x.id)}">
      <button class="chk" data-action="toggle" data-id="${esc(x.id)}" aria-label="toggle" aria-pressed="${isDone(x)}"><span class="ring-c">${mark}</span></button>
      <div class="tbody" data-action="edit" data-id="${esc(x.id)}" tabindex="0" role="button">
        <div class="ttl">${esc(x.title)}</div>
        ${x.notes ? `<div class="tnote">${esc(x.notes)}</div>` : ''}
        ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
      </div>
      ${ctx.carry ? `<button class="btn sm" data-action="carry" data-id="${esc(x.id)}">${t('carry')}</button>` : ''}
    </div>`;
  };

  const section = (d, list, active) => `
    <section class="day ${active ? 'active' : ''} ${d === '' ? 'always' : ''}" data-day="${d}">
      <div class="card glass">
        <div class="dhead">
          <div>
            <div class="dname">${d === '' ? t('no_day') : esc(D.fmt(d, loc, { weekday: 'long' }))}${d === today ? ` <span class="chip now">${t('today')}</span>` : ''}</div>
            ${d === '' ? '' : `<div class="dsub">${esc(D.fmt(d, loc, { day: 'numeric', month: 'long' }))}</div>`}
          </div>
          <button class="btn icon-btn sm" data-action="add" data-date="${d}" aria-label="${t('add_task_day')}">${icon('plus', 18)}</button>
        </div>
        <div class="tlist">${list.length ? list.sort(cmpTasks).map((x) => row(x, { showDate: d === '' })).join('') : `<div class="empty">${t('empty_day')}</div>`}</div>
      </div>
    </section>`;

  const pills = days.map((d) => {
    const n = inWeek.filter((x) => x.date === d && !isDone(x)).length;
    return `<button class="dpill ${d === S.sel ? 'sel' : ''} ${d === today ? 'today' : ''} ${n ? 'has' : ''}" data-action="pick-day" data-date="${d}">
      <span class="dw">${esc(D.fmt(d, loc, { weekday: 'short' }))}</span>
      <span class="dn">${D.parse(d).getDate()}</span><span class="dot"></span></button>`;
  }).join('');

  return `
  <div class="weekbar">
    <button class="btn icon-btn" data-action="week-prev" aria-label="${t('prev_week')}">${icon(rtl ? 'chevR' : 'chevL', 20)}</button>
    <div class="wlabel"><b>${esc(weekLabel(ws))}</b><small>${ws === curWs ? t('this_week') : ''}</small></div>
    <button class="btn icon-btn" data-action="week-next" aria-label="${t('next_week')}">${icon(rtl ? 'chevL' : 'chevR', 20)}</button>
    ${ws !== curWs ? `<button class="btn" data-action="week-today">${t('today')}</button>` : ''}
  </div>

  <div class="card glass summary">
    <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle class="trk" cx="32" cy="32" r="26"/>
      <circle class="val" cx="32" cy="32" r="26" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 32 32)"/>
      <text x="32" y="37" text-anchor="middle">${pct}%</text>
    </svg>
    <div class="sum-text">
      <div class="sum-main">${inWeek.length ? t('done_of', { done, total: inWeek.length }) : t('no_tasks_week')}</div>
      <div class="chips">
        ${doing ? `<span class="chip doing">${icon('play', 13)}${t('in_progress')} <b>${doing}</b></span>` : ''}
        ${late ? `<span class="chip late">${icon('clock', 13)}${t('late')} <b>${late}</b></span>` : ''}
      </div>
    </div>
  </div>

  ${overdueOld.length ? `
  <div class="card glass overdue">
    <div class="dhead">
      <div class="dname">${t('overdue_title')} <span class="chip late">${overdueOld.length}</span></div>
      <button class="btn sm" data-action="carry-all">${t('carry_all')}</button>
    </div>
    <div class="tlist">${overdueOld.map((x) => row(x, { carry: true, showDate: true })).join('')}</div>
  </div>` : ''}

  <div class="days" role="tablist">${pills}</div>
  <div class="board">
    ${days.map((d) => section(d, inWeek.filter((x) => x.date === d), d === S.sel)).join('')}
    ${section('', inWeek.filter((x) => !x.date), false)}
  </div>`;
}

function money(value) { return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(Number(value) || 0); }
function projectTypeLabel(v) { return ({ residential: t('type_residential'), administrative: t('type_administrative'), commercial: t('type_commercial'), fitout: t('type_fitout') })[v] || v || '—'; }
function projectStatusLabel(v) { return ({ planning: t('status_planning'), active: t('status_active'), on_hold: t('status_on_hold'), completed: t('status_completed') })[v] || v || '—'; }
function inputField(label, id, type='text', value='', extra='') { return `<label class="lab" for="${id}">${label}</label><input class="input" id="${id}" type="${type}" value="${esc(value)}" ${extra}>`; }
function renderProjects() {
  const selected = S.activeProjectId && S.projects.find(p => p.id === S.activeProjectId);
  if (selected) {
    const ds = S.deliverables.filter(d => d.projectId === selected.id).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
    const fs = S.financeEntries.filter(x => x.projectId === selected.id);
    const income = fs.filter(x=>x.kind==='income').reduce((n,x)=>n+Number(x.amount||0),0), expense = fs.filter(x=>x.kind==='expense').reduce((n,x)=>n+Number(x.amount||0),0);
    return `<div class="page-tools"><button class="btn sm" data-action="projects-back">← ${t('all_projects')}</button><button class="btn sm" data-action="edit-project" data-id="${esc(selected.id)}">${t('edit')}</button><button class="btn sm danger" data-action="delete-project" data-id="${esc(selected.id)}">${t('delete')}</button></div>
      <section class="card glass"><div class="project-title"><div><h2>${esc(selected.name)}</h2><p class="muted">${projectTypeLabel(selected.type)} · ${projectStatusLabel(selected.status)}</p></div><span class="chip">${esc(selected.location||t('no_location'))}</span></div><div class="stats-grid"><div class="stat"><span>${t('contract_value')}</span><strong>${money(selected.contractValue)} ${t('currency')}</strong></div><div class="stat"><span>${t('collected')}</span><strong>${money(income)} ${t('currency')}</strong></div><div class="stat"><span>${t('expenses')}</span><strong>${money(expense)} ${t('currency')}</strong></div><div class="stat"><span>${t('remaining')}</span><strong>${money(Number(selected.contractValue||0)-income)} ${t('currency')}</strong></div></div><p>${esc(selected.notes||'')}</p></section>
      <section class="card glass"><h2>${t('transactions')} · ${esc(selected.name)}</h2>${fs.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>${t('date')}</th><th>${t('category')}</th><th>${t('transaction_type')}</th><th>${t('amount')}</th><th></th></tr></thead><tbody>${fs.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(x=>`<tr><td>${esc(x.date||'—')}</td><td>${esc(x.category||'—')}<small>${esc(x.description||'')}</small></td><td>${x.kind==='income'?t('income'):t('expenses')}</td><td>${money(x.amount)} ${t('currency')}</td><td><button class="btn sm danger" data-action="delete-finance" data-id="${esc(x.id)}">×</button></td></tr>`).join('')}</tbody></table></div>`:`<p class="muted">${t('no_transactions')}</p>`}</section>
      <section class="card glass"><h2>${t('deliverables')}</h2><form data-action="add-deliverable" class="entry-form"><input type="hidden" id="d-project" value="${esc(selected.id)}"><div class="form-grid">${inputField(t('deliverable_name'),'d-name')}<div><label class="lab" for="d-stage">${t('design_stage')}</label><select class="input" id="d-stage"><option value="concept">${t('stage_concept')}</option><option value="design">${t('stage_design')}</option><option value="technical">${t('stage_technical')}</option><option value="execution">${t('stage_execution')}</option></select></div><div><label class="lab" for="d-kind">${t('deliverable_type')}</label><select class="input" id="d-kind"><option value="plan">${t('type_plan')}</option><option value="elevation">${t('type_elevation')}</option><option value="section">${t('type_section')}</option><option value="rcp">${t('type_rcp')}</option><option value="detail">${t('type_detail')}</option><option value="3d">3D</option><option value="other">${t('other')}</option></select></div>${inputField(t('due_date'),'d-date','date')}<div><label class="lab" for="d-status">${t('approval_status')}</label><select class="input" id="d-status"><option value="pending">${t('approval_pending')}</option><option value="submitted">${t('approval_submitted')}</option><option value="approved">${t('approval_approved')}</option><option value="revision">${t('approval_revision')}</option></select></div></div><label class="lab" for="d-notes">${t('notes')}</label><input class="input" id="d-notes"><button class="btn primary" type="submit">${t('add_deliverable')}</button></form>
      ${ds.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>${t('deliverable_name')}</th><th>${t('design_stage')}</th><th>${t('due_date')}</th><th>${t('approval_status')}</th><th></th></tr></thead><tbody>${ds.map(d=>`<tr><td><strong>${esc(d.name)}</strong><small>${esc(d.kind||'')} ${d.notes?'· '+esc(d.notes):''}</small></td><td>${esc(({concept:t('stage_concept'),design:t('stage_design'),technical:t('stage_technical'),execution:t('stage_execution')})[d.stage]||d.stage||'—')}</td><td>${esc(d.dueDate||'—')}</td><td><select class="input compact" data-change="deliverable-status" data-id="${esc(d.id)}"><option value="pending" ${d.status==='pending'?'selected':''}>${t('approval_pending')}</option><option value="submitted" ${d.status==='submitted'?'selected':''}>${t('approval_submitted')}</option><option value="approved" ${d.status==='approved'?'selected':''}>${t('approval_approved')}</option><option value="revision" ${d.status==='revision'?'selected':''}>${t('approval_revision')}</option></select></td><td><button class="btn sm danger" data-action="delete-deliverable" data-id="${esc(d.id)}">×</button></td></tr>`).join('')}</tbody></table></div>`:`<p class="muted">${t('no_deliverables')}</p>`}</section>`;
  }
  const projects = [...S.projects].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  return `<div class="page-tools"><p class="muted">${t('projects_intro')}</p><span class="chip">${projects.length} ${t('projects_count')}</span></div>${projects.length?`<div class="project-grid">${projects.map(p=>{const ds=S.deliverables.filter(d=>d.projectId===p.id), done=ds.filter(d=>d.status==='approved').length;return `<button class="card glass project-card" data-action="open-project" data-id="${esc(p.id)}"><div class="project-title"><span class="badge">${badge('projects',22)}</span><span class="chip">${projectStatusLabel(p.status)}</span></div><h2>${esc(p.name)}</h2><p class="muted">${projectTypeLabel(p.type)}${p.client?' · '+esc(p.client):''}</p><div class="project-foot"><span>${ds.length} ${t('deliverables')}</span><span>${done}/${ds.length||0} ${t('approved')}</span></div><div class="progress"><span style="width:${ds.length?Math.round(done/ds.length*100):0}%"></span></div><strong>${money(p.contractValue)} ${t('currency')}</strong></button>`}).join('')}</div>`:`<section class="card glass empty-state"><h2>${t('no_projects')}</h2><p class="muted">${t('projects_intro')}</p><button class="btn primary" data-action="new-project">${t('new_project')}</button></section>`}`;
}
function renderFinance() {
  const totalIncome=S.financeEntries.filter(x=>x.kind==='income').reduce((n,x)=>n+Number(x.amount||0),0), totalExpense=S.financeEntries.filter(x=>x.kind==='expense').reduce((n,x)=>n+Number(x.amount||0),0), contracts=S.projects.reduce((n,p)=>n+Number(p.contractValue||0),0);
  const entries=[...S.financeEntries].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return `<div class="stats-grid"><div class="card glass stat"><span>${t('contracts_total')}</span><strong>${money(contracts)} ${t('currency')}</strong></div><div class="card glass stat"><span>${t('collected')}</span><strong>${money(totalIncome)} ${t('currency')}</strong></div><div class="card glass stat"><span>${t('expenses')}</span><strong>${money(totalExpense)} ${t('currency')}</strong></div><div class="card glass stat"><span>${t('net_cash')}</span><strong>${money(totalIncome-totalExpense)} ${t('currency')}</strong></div></div>
  <section class="card glass"><h2>${t('add_finance_entry')}</h2><form data-action="add-finance" class="entry-form"><div class="form-grid"><div><label class="lab" for="f-project">${t('project')}</label><select class="input" id="f-project" required><option value="">${t('choose_project')}</option>${S.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div><div><label class="lab" for="f-kind">${t('transaction_type')}</label><select class="input" id="f-kind"><option value="income">${t('income')}</option><option value="expense">${t('expenses')}</option></select></div>${inputField(t('amount'),'f-amount','number','', 'min="0.01" step="0.01" required')}${inputField(t('date'),'f-fin-date','date',D.todayISO())}<div><label class="lab" for="f-category">${t('category')}</label><select class="input" id="f-category"><option>${t('general')}</option><option>${t('design')}</option><option>${t('materials')}</option><option>${t('labor')}</option><option>${t('transport')}</option><option>${t('other')}</option></select></div></div><label class="lab" for="f-description">${t('description')}</label><input class="input" id="f-description"><button class="btn primary" type="submit">${t('save_entry')}</button></form></section>
  <section class="card glass"><h2>${t('transactions')}</h2>${entries.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>${t('date')}</th><th>${t('project')}</th><th>${t('category')}</th><th>${t('transaction_type')}</th><th>${t('amount')}</th><th></th></tr></thead><tbody>${entries.map(x=>`<tr><td>${esc(x.date||'—')}</td><td>${esc(S.projects.find(p=>p.id===x.projectId)?.name||t('project_deleted'))}</td><td>${esc(x.category||'—')}<small>${esc(x.description||'')}</small></td><td>${x.kind==='income'?t('income'):t('expenses')}</td><td class="${x.kind==='income'?'positive':'negative'}">${x.kind==='income'?'+':'−'}${money(x.amount)} ${t('currency')}</td><td><button class="btn sm danger" data-action="delete-finance" data-id="${esc(x.id)}">×</button></td></tr>`).join('')}</tbody></table></div>`:`<p class="muted">${t('no_transactions')}</p>`}</section>`;
}
function openProjectSheet(id=null) {
  const p=id?S.projects.find(x=>x.id===id):null;
  $('#layer').innerHTML=`<div class="overlay" data-action="overlay"><div class="sheet glass" role="dialog" aria-modal="true"><div class="sheet-head"><h2>${p?t('edit_project'):t('new_project')}</h2><button class="btn icon-btn" data-action="sheet-cancel">×</button></div><form data-action="save-project" data-id="${esc(p?.id||'')}">${inputField(t('project_name'),'p-name','text',p?.name||'','required maxlength="160"')}<div class="form-grid"><div><label class="lab" for="p-type">${t('project_type')}</label><select class="input" id="p-type"><option value="residential" ${p?.type==='residential'?'selected':''}>${t('type_residential')}</option><option value="administrative" ${p?.type==='administrative'?'selected':''}>${t('type_administrative')}</option><option value="commercial" ${p?.type==='commercial'?'selected':''}>${t('type_commercial')}</option><option value="fitout" ${p?.type==='fitout'?'selected':''}>${t('type_fitout')}</option></select></div><div><label class="lab" for="p-status">${t('status')}</label><select class="input" id="p-status"><option value="planning" ${p?.status==='planning'?'selected':''}>${t('status_planning')}</option><option value="active" ${p?.status==='active'?'selected':''}>${t('status_active')}</option><option value="on_hold" ${p?.status==='on_hold'?'selected':''}>${t('status_on_hold')}</option><option value="completed" ${p?.status==='completed'?'selected':''}>${t('status_completed')}</option></select></div>${inputField(t('client'),'p-client','text',p?.client||'')}${inputField(t('location'),'p-location','text',p?.location||'')}${inputField(t('contract_value'),'p-contract','number',p?.contractValue??'','min="0" step="0.01"')}${inputField(t('start_date'),'p-start','date',p?.startDate||'')}${inputField(t('end_date'),'p-end','date',p?.endDate||'')}</div><label class="lab" for="p-notes">${t('notes')}</label><textarea class="textarea" id="p-notes" rows="3">${esc(p?.notes||'')}</textarea><div class="sheet-actions"><button type="button" class="btn" data-action="sheet-cancel">${t('cancel')}</button><button type="submit" class="btn primary">${t('save')}</button></div></form></div></div>`;
  $('#p-name')?.focus();
}

// ================================================================== نافذة المهمة
function openSheet(id, presetDate) {
  const prev = id ? S.tasks.find((x) => x.id === id) : null;
  let date = prev ? prev.date : (presetDate !== undefined ? (presetDate || null) : (D.weekDays(S.week).includes(S.sel) ? S.sel : null));
  S.sheet = { id: prev ? prev.id : null };
  const seg = (field, items, cur) => `<div class="seg" data-seg="${field}">${items.map(([v, label]) =>
    `<button type="button" data-action="seg" data-field="${field}" data-val="${v}" aria-pressed="${String(cur) === String(v)}">${label}</button>`).join('')}</div>`;
  $('#layer').innerHTML = `
  <div class="overlay" data-action="overlay">
    <div class="sheet glass" role="dialog" aria-modal="true" aria-label="${prev ? t('edit_task') : t('new_task')}">
      <div class="sheet-head"><h2>${prev ? t('edit_task') : t('new_task')}</h2>
        <button class="btn icon-btn" data-action="sheet-cancel" aria-label="${t('cancel')}">${icon('close', 18)}</button></div>
      <label class="lab" for="f-title">${t('title')}</label>
      <input id="f-title" class="input" maxlength="300" placeholder="${esc(t('title_ph'))}" value="${esc(prev ? prev.title : '')}" autocomplete="off">
      <label class="lab" for="f-notes">${t('notes')}</label>
      <textarea id="f-notes" class="textarea" rows="3" maxlength="5000" placeholder="${esc(t('notes_ph'))}">${esc(prev ? prev.notes : '')}</textarea>
      <label class="lab" for="f-date">${t('date')}</label>
      <div class="datefield">
        <input id="f-date" type="date" class="input" value="${date || ''}">
        <div class="quick">
          <button type="button" class="btn sm" data-action="quick-date" data-val="today">${t('today')}</button>
          <button type="button" class="btn sm" data-action="quick-date" data-val="tomorrow">${t('tomorrow')}</button>
          <button type="button" class="btn sm" data-action="quick-date" data-val="">${t('no_date')}</button>
        </div>
      </div>
      <label class="lab">${t('priority')}</label>
      ${seg('priority', [[1, t('p_low')], [2, t('p_mid')], [3, t('p_high')]], prev ? prev.priority : 2)}
      <label class="lab">${t('status')}</label>
      ${seg('status', [['todo', t('s_todo')], ['doing', t('s_doing')], ['done', t('s_done')]], prev ? prev.status : 'todo')}
      <div class="sheet-actions">
        ${prev ? `<button class="btn danger" data-action="sheet-delete">${icon('trash', 18)}<span>${t('delete')}</span></button>` : '<span></span>'}
        <div class="grow"></div>
        <button class="btn" data-action="sheet-cancel">${t('cancel')}</button>
        <button class="btn primary" data-action="sheet-save">${t('save')}</button>
      </div>
    </div>
  </div>`;
  setTimeout(() => { const f = $('#f-title'); if (f && !prev) f.focus(); }, 60);
}

function closeSheet() { $('#layer').innerHTML = ''; S.sheet = null; }

function segValue(field) {
  const b = document.querySelector(`.seg[data-seg="${field}"] button[aria-pressed="true"]`);
  return b ? b.dataset.val : null;
}

function saveSheet() {
  const title = $('#f-title').value.trim();
  if (!title) { toast(t('title_required')); $('#f-title').focus(); return; }
  const prev = S.sheet.id ? S.tasks.find((x) => x.id === S.sheet.id) : null;
  const date = $('#f-date').value && D.isValidISO($('#f-date').value) ? $('#f-date').value : null;
  const status = segValue('status') || 'todo';
  const now = Date.now();
  const task = normalizeTask({
    ...(prev || {}),
    id: prev ? prev.id : uid(),
    title,
    notes: $('#f-notes').value.trim(),
    date,
    weekRef: date || (prev && prev.weekRef) || S.week,
    priority: Number(segValue('priority')) || 2,
    status,
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now,
    doneAt: status === 'done' ? ((prev && prev.doneAt) || now) : null,
  }, true);
  persistTask(task);
  closeSheet();
  if (date) { S.week = D.weekStartOf(date, startDay()); S.sel = date; }
  else S.week = D.weekStartOf(task.weekRef, startDay());
  render();
}

function persistTask(task) {
  // تحديث فوري للواجهة (التخزين المحلي/الكاش يطلق الـ snapshot)
  Promise.resolve(S.store.save('tasks', task)).catch((e) => toast(t('save_failed', { msg: e.message || e })));
}

function toggleTask(id) {
  const x = S.tasks.find((y) => y.id === id);
  if (!x) return;
  const nowDone = !isDone(x);
  persistTask({ ...x, status: nowDone ? 'done' : 'todo', doneAt: nowDone ? Date.now() : null, updatedAt: Date.now() });
}

function carryTask(id) {
  const x = S.tasks.find((y) => y.id === id);
  if (!x) return;
  const today = D.todayISO();
  const curWs = D.weekStartOf(today, startDay());
  const patch = x.date ? { date: today, weekRef: today } : { weekRef: curWs };
  persistTask({ ...x, ...patch, updatedAt: Date.now() });
}

function deleteTask() {
  const btn = $('[data-action="sheet-delete"]');
  if (btn && !btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.classList.add('armed');
    btn.querySelector('span').textContent = t('confirm_delete');
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.classList.remove('armed'); btn.querySelector('span').textContent = t('delete'); } }, 3500);
    return;
  }
  const x = S.tasks.find((y) => y.id === S.sheet.id);
  if (!x) return;
  Promise.resolve(S.store.remove('tasks', x.id)).catch((e) => toast(t('save_failed', { msg: e.message || e })));
  closeSheet();
  toast(t('deleted'), { label: t('undo'), fn: () => persistTask(x) });
}

// ================================================================== الإعدادات
function renderSettings() {
  const th = S.settings.theme;
  const sc = shownColors(th);
  const rtl = dir() === 'rtl';
  const open = (id) => S.openGroups.has(id);
  const seg = (action, items, cur) => `<div class="seg">${items.map(([v, label, ic]) =>
    `<button type="button" data-action="${action}" data-val="${v}" aria-pressed="${String(cur) === String(v)}">${ic ? icon(ic, 17) : ''}<span>${label}</span></button>`).join('')}</div>`;
  const range = (key, min, max, val, unit, disabled) => `
    <div class="range-row"><input type="range" data-input="${key}" min="${min}" max="${max}" value="${val}" ${disabled ? 'disabled' : ''}>
    <span class="val" id="v-${key}">${val}${unit}</span></div>`;

  const group = (id, ic, titleKey, body) => `
    <section class="group card glass ${open(id) ? 'open' : ''}">
      <button class="ghead" data-action="toggle-group" data-group="${id}" aria-expanded="${open(id)}">
        ${badge(ic, 20)}<span class="gtitle">${t(titleKey)}</span>${icon('chevD', 20)}
      </button>
      <div class="gbody">${body}</div>
    </section>`;

  const presetIds = ['quiet', 'paper', 'midnight', 'forest', 'sand', 'rose', 'ocean'];
  const modeIcon = { auto: 'auto', light: 'sun', dark: 'moon' };

  if (open('icons')) Object.keys(FONTS).forEach(ensureFont);

  const appearance = `
    <div class="lab">${t('mode')}</div>
    ${seg('set-mode', ['auto', 'light', 'dark'].map((m) => [m, t('m_' + m), modeIcon[m]]), th.mode)}
    <div class="lab">${t('presets')}</div>
    <div class="presets">${presetIds.map((p) => {
      const pr = PRESETS[p];
      const bgc = pr.bg.light || '#f6f4ef';
      return `<button class="preset" data-action="set-preset" data-val="${p}" aria-pressed="${th.preset === p}">
        <span class="sw" style="background:linear-gradient(135deg, ${bgc} 50%, ${pr.accent} 50%)"></span><span>${t('pr_' + p)}</span></button>`;
    }).join('')}</div>`;

  const colors = `
    <div class="row"><span class="lab-i">${t('bg_color')}</span><input type="color" data-input="bg" value="${sc.bg}"></div>
    <div class="row"><span class="lab-i">${t('accent_color')}</span><input type="color" data-input="accent" value="${sc.accent}"></div>
    <div class="row"><span class="lab-i">${t('text_color')}</span>
      <span class="inline">
        <label class="check"><input type="checkbox" data-change="text-auto" ${th.text[sc.mode] ? '' : 'checked'}><span>${t('text_auto')}</span></label>
        <input type="color" data-input="text" value="${sc.text}" ${th.text[sc.mode] ? '' : 'disabled'}>
      </span></div>
    <div class="lab">${t('saturation')}</div>
    ${range('sat', 0, 150, th.sat, '%')}
    <div class="lab">${t('surfaces')}</div>
    ${seg('set-surface', [['tint', t('surf_tint')], ['same', t('surf_same')]], th.surface)}
    <div class="row"><span class="lab-i">${t('glass')}</span>
      <label class="switch"><input type="checkbox" data-change="glass" ${th.glass ? 'checked' : ''}><span></span></label></div>
    <div class="lab">${t('blur')}</div>
    ${range('blur', 0, 32, th.blur, 'px', !th.glass)}
    <button class="btn" data-action="reset-colors">${t('reset_colors')}</button>`;

  const iconsFonts = `
    <div class="lab">${t('icon_style')}</div>
    ${seg('set-icons', [['circle', t('i_circle')], ['squircle', t('i_squircle')], ['plain', t('i_plain')]], th.icons)}
    <div class="icon-preview">${['tasks', 'projects', 'finance', 'settings', 'palette', 'globe'].map((n) => badge(n, 22)).join('')}</div>
    <div class="lab">${t('font')}</div>
    <div class="fonts">${Object.entries(FONTS).map(([id, f]) =>
      `<button class="fontbtn" data-action="set-font" data-val="${id}" aria-pressed="${th.font === id}" style="font-family:${f.stack},system-ui">
        <b>${f.label}</b><small>${t('font_preview')}</small></button>`).join('')}</div>
    <div class="lab">${t('font_size')}</div>
    ${range('scale', 90, 120, th.scale, '%')}`;

  const language = `
    <div class="lab">${t('language')}</div>
    ${seg('set-lang', [['ar', 'العربية'], ['en', 'English']], S.settings.lang)}
    <div class="lab">${t('week_start')}</div>
    ${seg('set-week', [[6, t('d_sat')], [0, t('d_sun')], [1, t('d_mon')]], S.settings.weekStartDay)}
    <div class="lab">${t('accordion')}</div>
    ${seg('set-acc', [['single', t('acc_single')], ['multi', t('acc_multi')]], S.settings.accordion)}`;

  const u = S.user || {};
  const account = `
    <div class="acct">${badge(S.store.mode === 'cloud' ? 'cloud' : 'device', 22)}
      <div><b>${S.store.mode === 'cloud' ? esc(u.name || u.email || '') : t('local_mode')}</b>
      <small>${S.store.mode === 'cloud' ? esc(u.email || '') + ' · ' + t('cloud_mode') : t('local_note')}</small></div></div>
    <div class="btnrow">
      <button class="btn" data-action="export">${icon('download', 18)} ${t('export_data')}</button>
      <button class="btn" data-action="import">${icon('upload', 18)} ${t('import_data')}</button>
      <button class="btn danger" data-action="signout">${icon('logout', 18)} ${t('sign_out')}</button>
    </div>
    <p class="muted small">${t('data_note')}</p>
    <input type="file" id="import-file" accept="application/json,.json" hidden data-change="import-file">`;

  const about = `
    <div class="acct">${'<img src="icons/logo.svg" width="44" height="44" alt="">'}
      <div><b>${t('app')}</b><small>${t('version')} ${VERSION} · ${t('stage')}</small></div></div>
    <p class="muted">${t('about_text')}</p>`;

  return `<div class="settings">
    ${group('appearance', 'palette', 'g_appearance', appearance)}
    ${group('colors', 'layers', 'g_colors', colors)}
    ${group('icons', 'type', 'g_icons_fonts', iconsFonts)}
    ${group('language', 'globe', 'g_language', language)}
    ${group('account', 'user', 'g_account', account)}
    ${group('about', 'info', 'g_about', about)}
  </div>`;
}

// ================================================================== تصدير / استيراد
function exportData() {
  const payload = {
    app: 'weeklyplanner', version: 2, exportedAt: new Date().toISOString(),
    tasks: S.tasks, settings: S.settings, projects: S.projects, deliverables: S.deliverables, financeEntries: S.financeEntries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `weeklyplanner-backup-${D.todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(t('exported'));
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'weeklyplanner' || !Array.isArray(data.tasks)) throw new Error('bad');
    let n = 0;
    for (const raw of data.tasks.slice(0, 5000)) {
      if (!raw || typeof raw !== 'object') continue;
      const task = normalizeTask(raw, false);
      if (!task.title) continue;
      persistTask(task); n++;
    }
    for (const key of ['projects', 'deliverables', 'financeEntries']) { if (Array.isArray(data[key])) for (const raw of data[key].slice(0, 10000)) { if (raw && typeof raw === 'object' && raw.id) { await S.store.save(key, raw); n++; } } }
    if (data.settings && typeof data.settings === 'object') {
      S.settings = mergeSettings(data.settings);
      applySettings(false); persistSettings();
    }
    toast(t('import_ok', { n }));
    render();
  } catch {
    toast(t('import_bad'));
  }
}

// ================================================================== Toast
let toastTimer;
function toast(msg, action) {
  const host = $('#toast');
  host.innerHTML = `<div class="toast"><span>${esc(msg)}</span>${action ? `<button data-action="toast-action">${esc(action.label)}</button>` : ''}</div>`;
  const el = host.firstChild;
  if (action) el.querySelector('button').onclick = () => { action.fn(); host.innerHTML = ''; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.innerHTML = ''; }, action ? 5500 : 2600);
}

// ================================================================== الأحداث
function bindEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'overlay' && e.target !== el) return;
  if (a === 'toast-action') return;
  const v = el.dataset.val;


  switch (a) {
    case 'reload': location.reload(); break;
    case 'login': {
      const btn = $('#login-btn');
      btn.disabled = true; btn.textContent = t('signing_in');
      try { await S.store.signIn(); }
      catch (err) { console.error(err); renderLogin(`${t('signin_failed')}: ${err.code || err.message || err}`); }
      break;
    }
    case 'login-lang': updateSettings({ lang: lang() === 'ar' ? 'en' : 'ar' }, { render: false }); renderLogin(); break;
    case 'nav': S.section = el.dataset.section; S.activeProjectId = null; render(); window.scrollTo(0, 0); break;
    case 'new-project': openProjectSheet(); break;
    case 'edit-project': openProjectSheet(el.dataset.id); break;
    case 'open-project': S.activeProjectId = el.dataset.id; render(); window.scrollTo(0,0); break;
    case 'projects-back': S.activeProjectId = null; render(); break;
    case 'delete-project': { const p=S.projects.find(x=>x.id===el.dataset.id); if(p && confirm(t('confirm_delete_project'))) { for(const d of S.deliverables.filter(x=>x.projectId===p.id)) await S.store.remove('deliverables',d.id); for(const f of S.financeEntries.filter(x=>x.projectId===p.id)) await S.store.remove('financeEntries',f.id); await S.store.remove('projects',p.id); S.activeProjectId=null; toast(t('project_deleted_ok')); render(); } break; }
    case 'delete-deliverable': if(confirm(t('confirm_delete'))) { await S.store.remove('deliverables',el.dataset.id); toast(t('deleted')); } break;
    case 'delete-finance': if(confirm(t('confirm_delete'))) { await S.store.remove('financeEntries',el.dataset.id); toast(t('deleted')); } break;
    case 'open-settings': S.prevSection = S.section; S.section = 'settings'; render(); window.scrollTo(0, 0); break;
    case 'back': S.section = S.prevSection || 'tasks'; render(); break;

    case 'week-prev': S.week = D.addDays(S.week, -7); S.sel = S.week; render(); break;
    case 'week-next': S.week = D.addDays(S.week, 7); S.sel = S.week; render(); break;
    case 'week-today': S.sel = D.todayISO(); S.week = D.weekStartOf(S.sel, startDay()); render(); break;
    case 'pick-day': S.sel = el.dataset.date; render(); break;

    case 'add': openSheet(null, el.dataset.date); break;
    case 'edit': openSheet(el.dataset.id); break;
    case 'toggle': toggleTask(el.dataset.id); break;
    case 'carry': carryTask(el.dataset.id); toast(t('carried')); break;
    case 'carry-all': {
      const curWs = D.weekStartOf(D.todayISO(), startDay());
      S.tasks.filter((x) => !isDone(x) && weekOfTask(x) < curWs).forEach((x) => carryTask(x.id));
      toast(t('carried')); break;
    }

    case 'sheet-cancel': closeSheet(); break;
    case 'sheet-save': saveSheet(); break;
    case 'sheet-delete': deleteTask(); break;
    case 'overlay': closeSheet(); break;
    case 'seg': {
      el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      break;
    }
    case 'quick-date': {
      const f = $('#f-date');
      f.value = v === 'today' ? D.todayISO() : v === 'tomorrow' ? D.addDays(D.todayISO(), 1) : '';
      break;
    }

    // ----- الإعدادات
    case 'toggle-group': {
      const id = el.dataset.group;
      if (S.settings.accordion === 'single') S.openGroups = S.openGroups.has(id) ? new Set() : new Set([id]);
      else S.openGroups.has(id) ? S.openGroups.delete(id) : S.openGroups.add(id);
      render(); break;
    }
    case 'set-mode': updateTheme((x) => { x.mode = v; }, { render: true }); break;
    case 'set-preset': {
      const p = PRESETS[v];
      updateTheme((x) => {
        x.preset = v; x.accent = p.accent; x.sat = p.sat;
        x.bg = { ...p.bg }; x.text = { light: null, dark: null };
      }, { render: true }); break;
    }
    case 'set-surface': updateTheme((x) => { x.surface = v; }, { render: true }); break;
    case 'set-icons': updateTheme((x) => { x.icons = v; }, { render: true }); break;
    case 'set-font': updateTheme((x) => { x.font = v; }, { render: true }); break;
    case 'reset-colors': {
      const p = PRESETS.quiet;
      updateTheme((x) => {
        x.preset = 'quiet'; x.accent = p.accent; x.sat = 100;
        x.bg = { light: null, dark: null }; x.text = { light: null, dark: null }; x.surface = 'tint';
      }, { render: true }); break;
    }
    case 'set-lang': updateSettings({ lang: v }); break;
    case 'set-week': {
      updateSettings({ weekStartDay: Number(v) }, { render: false });
      S.week = D.weekStartOf(S.sel || D.todayISO(), startDay()); render(); break;
    }
    case 'set-acc': {
      updateSettings({ accordion: v }, { render: false });
      if (v === 'single' && S.openGroups.size > 1) S.openGroups = new Set([[...S.openGroups][0]]);
      render(); break;
    }
    case 'export': exportData(); break;
    case 'import': $('#import-file').click(); break;
    case 'signout': S.section = 'tasks'; await S.store.signOut(); break;
    default: break;
  }
}


async function onSubmit(e) {
const el = e.target.closest('form[data-action]'); if (!el) return; const a = el.dataset.action; if (!['save-project','add-deliverable','add-finance'].includes(a)) return; e.preventDefault(); if (!el.reportValidity()) return; try {
    if (a === 'save-project') { const old=S.projects.find(x=>x.id===el.dataset.id); const p={ id:old?.id||uid(), name:$('#p-name').value.trim(), type:$('#p-type').value, status:$('#p-status').value, client:$('#p-client').value.trim(), location:$('#p-location').value.trim(), contractValue:Number($('#p-contract').value)||0, startDate:$('#p-start').value||null, endDate:$('#p-end').value||null, notes:$('#p-notes').value.trim(), createdAt:old?.createdAt||Date.now(), updatedAt:Date.now() }; await S.store.save('projects',p); S.activeProjectId=p.id; closeSheet(); toast(t('saved')); render(); }
    else if (a === 'add-deliverable') { const d={id:uid(), projectId:$('#d-project').value, name:$('#d-name').value.trim(), stage:$('#d-stage').value, kind:$('#d-kind').value, dueDate:$('#d-date').value||null, status:$('#d-status').value, notes:$('#d-notes').value.trim(), createdAt:Date.now(), updatedAt:Date.now()}; if(!d.name){toast(t('title_required'));return;} await S.store.save('deliverables',d); el.reset(); toast(t('saved')); }
    else { const x={id:uid(),projectId:$('#f-project').value,kind:$('#f-kind').value,amount:Number($('#f-amount').value),date:$('#f-fin-date').value||D.todayISO(),category:$('#f-category').value,description:$('#f-description').value.trim(),createdAt:Date.now()}; if(!x.projectId||x.amount<=0){toast(t('form_required'));return;} await S.store.save('financeEntries',x); el.reset(); $('#f-fin-date').value=D.todayISO(); toast(t('saved')); }
  } catch(err) { toast(t('save_failed',{msg:err.message||err})); }
}

function onInput(e) {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  const k = el.dataset.input;
  const v = el.value;
  const mode = effectiveMode(S.settings.theme);
  switch (k) {
    case 'bg': updateTheme((x) => { x.bg[mode] = v; x.preset = 'custom'; }); break;
    case 'accent': updateTheme((x) => { x.accent = v; x.preset = 'custom'; }); break;
    case 'text': updateTheme((x) => { x.text[mode] = v; }); break;
    case 'sat': updateTheme((x) => { x.sat = Number(v); }); $('#v-sat').textContent = v + '%'; break;
    case 'blur': updateTheme((x) => { x.blur = Number(v); }); $('#v-blur').textContent = v + 'px'; break;
    case 'scale': updateTheme((x) => { x.scale = Number(v); }); $('#v-scale').textContent = v + '%'; break;
    default: break;
  }
}

function onChange(e) {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const k = el.dataset.change;
  if (k === 'deliverable-status') { const d=S.deliverables.find(x=>x.id===el.dataset.id); if(d) S.store.save('deliverables',{...d,status:el.value,updatedAt:Date.now()}).catch(err=>toast(t('save_failed',{msg:err.message||err}))); }
  else if (k === 'glass') updateTheme((x) => { x.glass = el.checked; }, { render: true });
  else if (k === 'text-auto') {
    const mode = effectiveMode(S.settings.theme);
    const auto = shownColors({ ...S.settings.theme, text: { light: null, dark: null } }).text;
    updateTheme((x) => { x.text[mode] = el.checked ? null : auto; }, { render: true });
  } else if (k === 'import-file') {
    if (el.files && el.files[0]) importData(el.files[0]);
    el.value = '';
  }
}

function onKey(e) {
  if (e.key === 'Escape' && S.sheet) { closeSheet(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (S.sheet && e.key === 'Enter' && document.activeElement && document.activeElement.id === 'f-title') { e.preventDefault(); saveSheet(); return; }
  if (!typing && !S.sheet && S.user && S.section === 'tasks' && e.key === 'n') { e.preventDefault(); openSheet(null); return; }
  if (e.key === 'Enter' && document.activeElement && document.activeElement.classList.contains('tbody')) openSheet(document.activeElement.dataset.id);
}

boot();
