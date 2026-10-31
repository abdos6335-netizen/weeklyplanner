// WeeklyPlanner — المهام الأسبوعية والمشروعات والتسليمات والماليات والإدخال الصوتي.
import { createStore } from './store.js';
import { t, setLang, lang, dir, locale } from './i18n.js';
import * as D from './dates.js';
import { icon, badge } from './icons.js';
import {
  applyTheme, mergeTheme, DEFAULT_THEME, PRESETS, FONTS, ensureFont,
  effectiveMode, shownColors, watchSystemMode,
} from './theme.js';

const VERSION = '3.0.0';
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
  personalExpenses: [],
  personalBudgets: [],
  meetings: [],
  activeMeetingProjectId: null,
  meetingRecognition: null,
  financeView: 'projects',
  expenseMonth: D.todayISO().slice(0,7),
  syncStatus: { state: 'idle', message: 'جارٍ الاتصال…' },
  authMode: 'signin',
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
  S.tasks = []; S.projects = []; S.deliverables = []; S.financeEntries = []; S.personalExpenses = []; S.personalBudgets = []; S.meetings = [];
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
  S.unsubs.push(S.store.watch('personalExpenses', (docs) => { S.personalExpenses = docs; if (S.section === 'finance') render(); }));
  S.unsubs.push(S.store.watch('personalBudgets', (docs) => { S.personalBudgets = docs; if (S.section === 'finance') render(); }));
  S.unsubs.push(S.store.watch('meetings', (docs) => { S.meetings = docs; if (S.section === 'meetings') render(); }));
  if (S.store.onStatus) S.unsubs.push(S.store.onStatus((status) => { S.syncStatus = status; const el = $('#sync-indicator'); if (el) { el.textContent = status.message || status.state; el.dataset.state = status.state; } }));
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
  return [['tasks', 'nav_tasks'], ['projects', 'nav_projects'], ['finance', 'nav_finance'], ['meetings', 'nav_meetings']];
}

function shell() {
  const sec = S.section;
  const rtl = dir() === 'rtl';
  const nav = navList();
  const title = sec === 'settings' ? t('settings') : sec === 'tasks' ? t('tasks_title') : t('nav_' + sec);
  const content = sec === 'tasks' ? renderTasks() : sec === 'settings' ? renderSettings() : sec === 'projects' ? renderProjects() : sec === 'finance' ? renderFinance() : sec === 'meetings' ? renderMeetings() : renderTasks();
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
        <span id="sync-indicator" class="sync-indicator" data-state="${esc(S.syncStatus.state)}">${esc(S.syncStatus.message)}</span>
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
    <button class="voice-fab" data-action="voice-open" aria-label="${t('voice_entry')}">${icon('mic', 23)}<span>${t('voice_entry')}</span></button>
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
      ${cloud ? `<div class="auth-divider">أو الدخول بالبريد الإلكتروني</div>
      <form data-action="auth-email" class="entry-form">
        <label class="lab" for="auth-email">البريد الإلكتروني</label><input class="input" id="auth-email" type="email" autocomplete="email" required>
        <label class="lab" for="auth-password">كلمة المرور</label><input class="input" id="auth-password" type="password" minlength="6" autocomplete="${S.authMode==='signup'?'new-password':'current-password'}" required>
        <button class="btn primary" type="submit">${S.authMode==='signup'?'إنشاء حساب':'دخول بالبريد'}</button>
      </form>
      <div class="auth-links"><button class="btn ghost" data-action="auth-toggle">${S.authMode==='signup'?'لديك حساب؟ تسجيل الدخول':'إنشاء حساب جديد'}</button><button class="btn ghost" data-action="auth-reset">نسيت كلمة المرور؟</button></div>` : ''}
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
  return `<div class="page-tools"><p class="muted">${t('projects_intro')}</p><span class="chip">${projects.length} ${t('projects_count')}</span></div>${projects.length?`<div class="project-grid">${projects.map(p=>{const ds=S.deliverables.filter(d=>d.projectId===p.id), done=ds.filter(d=>d.status==='approved').length;return `<article class="project-card-wrap"><button class="card glass project-card" data-action="open-project" data-id="${esc(p.id)}"><div class="project-title"><span class="badge">${badge('projects',22)}</span><span class="chip">${projectStatusLabel(p.status)}</span></div><h2>${esc(p.name)}</h2><p class="muted">${projectTypeLabel(p.type)}${p.client?' · '+esc(p.client):''}</p><div class="project-foot"><span>${ds.length} ${t('deliverables')}</span><span>${done}/${ds.length||0} ${t('approved')}</span></div><div class="progress"><span style="width:${ds.length?Math.round(done/ds.length*100):0}%"></span></div><strong>${money(p.contractValue)} ${t('currency')}</strong></button><div class="project-print-actions"><button class="btn sm" data-action="print-project" data-id="${esc(p.id)}">${icon('printer',16)} ${t('print_project')}</button></div></article>`}).join('')}</div>`:`<section class="card glass empty-state"><h2>${t('no_projects')}</h2><p class="muted">${t('projects_intro')}</p><button class="btn primary" data-action="new-project">${t('new_project')}</button></section>`}`;
}
function printProjectReport(id, mode) {
  const p = S.projects.find(x => x.id === id); if (!p) return;
  const ds = S.deliverables.filter(x => x.projectId === id).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const fs = S.financeEntries.filter(x => x.projectId === id).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const income=fs.filter(x=>x.kind==='income').reduce((n,x)=>n+Number(x.amount||0),0), expense=fs.filter(x=>x.kind==='expense').reduce((n,x)=>n+Number(x.amount||0),0);
  const financial = mode === 'finance';
  const rows = financial ? fs.map(x=>`<tr><td>${esc(x.date||'—')}</td><td>${esc(x.category||'—')}</td><td>${x.kind==='income'?'تحصيل':'مصروف'}</td><td>${money(x.amount)} ج.م</td><td>${esc(x.description||'')}</td></tr>`).join('') : ds.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.stage||'—')}</td><td>${esc(x.kind||'—')}</td><td>${esc(x.dueDate||'—')}</td><td>${esc(({pending:'لم يُرسل',submitted:'مرسل للمراجعة',approved:'معتمد',revision:'مطلوب تعديل'})[x.status]||x.status||'—')}</td><td>${esc(x.notes||'')}</td></tr>`).join('');
  const title = financial ? 'التقرير المالي للمشروع' : 'تقرير موقف المشروع';
  const summary = financial ? `<div class="stats"><p>قيمة التعاقد: <b>${money(p.contractValue)} ج.م</b></p><p>إجمالي التحصيلات: <b>${money(income)} ج.م</b></p><p>إجمالي المصروفات: <b>${money(expense)} ج.م</b></p><p>صافي التدفق النقدي: <b>${money(income-expense)} ج.م</b></p><p>المتبقي للتحصيل: <b>${money(Number(p.contractValue||0)-income)} ج.م</b></p></div>` : `<div class="stats"><p>نوع المشروع: <b>${esc(projectTypeLabel(p.type))}</b></p><p>الحالة: <b>${esc(projectStatusLabel(p.status))}</b></p><p>العميل: <b>${esc(p.client||'—')}</b></p><p>الموقع: <b>${esc(p.location||'—')}</b></p><p>التسليمات: <b>${ds.length}</b> · المعتمد: <b>${ds.filter(x=>x.status==='approved').length}</b></p><p>ملاحظات: ${esc(p.notes||'—')}</p></div>`;
  const headers = financial ? '<th>التاريخ</th><th>البند</th><th>الحركة</th><th>المبلغ</th><th>الوصف</th>' : '<th>التسليم</th><th>المرحلة</th><th>النوع</th><th>الموعد</th><th>الاعتماد</th><th>ملاحظات</th>';
  const w=window.open('', '_blank'); if(!w){toast(t('print_popup_blocked'));return;}
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - ${esc(p.name)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#222;line-height:1.6}h1{font-size:24px}h2{font-size:18px}.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 20px;border:1px solid #ddd;padding:12px;margin:18px 0}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #bbb;padding:7px;text-align:right}th{background:#eee}.meta{color:#666}@media print{button{display:none}body{padding:0}.stats{break-inside:avoid}}</style><h1>${title}</h1><h2>${esc(p.name)}</h2><div class="meta">تاريخ التقرير: ${new Date().toLocaleDateString('ar-EG')}</div>${summary}<table><thead><tr>${headers}</tr></thead><tbody>${rows||`<tr><td colspan="6">لا توجد بيانات مسجلة</td></tr>`}</tbody></table><p class="meta">تم إنشاء التقرير من WeeklyPlanner</p><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></html>`);
  w.document.close();
}
function openPrintChoice(id) {
  const p=S.projects.find(x=>x.id===id); if(!p)return;
  $('#layer').innerHTML=`<div class="overlay" data-action="overlay"><section class="sheet glass" role="dialog" aria-modal="true"><div class="sheet-head"><h2>${t('print_project')} · ${esc(p.name)}</h2><button class="btn icon-btn" data-action="close-voice" aria-label="${t('cancel')}">×</button></div><p class="muted">${t('print_choose')}</p><div class="btnrow"><button class="btn primary" data-action="print-status" data-id="${esc(id)}">${t('project_status_report')}</button><button class="btn primary" data-action="print-finance" data-id="${esc(id)}">${t('finance_report')}</button></div></section></div>`;
}
function openVoiceSheet() {
  const options=S.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('#layer').innerHTML=`<div class="overlay" data-action="overlay"><section class="sheet voice-sheet glass" role="dialog" aria-modal="true"><div class="sheet-head"><h2>${t('voice_entry')}</h2><button class="btn icon-btn" data-action="close-voice" aria-label="${t('cancel')}">×</button></div><p class="muted">${t('voice_help')}</p><div class="voice-controls"><button class="btn primary" data-action="voice-start">${icon('mic',20)} ${t('start_recording')}</button><select class="input compact" id="voice-language" aria-label="لغة التسجيل"><option value="ar-EG">العربية</option><option value="en-US">English</option></select><span id="voice-status" class="muted">${t('voice_ready')}</span></div><label class="lab" for="voice-text">${t('transcript')}</label><textarea class="input textarea" id="voice-text" rows="4" placeholder="${t('voice_placeholder')}"></textarea><p id="voice-understanding" class="muted" aria-live="polite">سيحلل التطبيق كلامك ويعرض العملية المقترحة قبل تنفيذ العمليات الحساسة.</p><label class="lab" for="voice-target">${t('save_as')}</label><select class="input" id="voice-target"><option value="auto">اكتشاف نوع الأمر تلقائيًا</option><option value="task">${t('voice_task')}</option><option value="finance">${t('voice_finance')}</option><option value="project">إنشاء مشروع</option><option value="deliverable">تحديث تسليم أو اعتماد</option><option value="report">إعداد تقرير</option></select><div id="voice-finance-fields" hidden><label class="lab" for="voice-project">${t('project')}</label><select class="input" id="voice-project"><option value="">${t('choose_project')}</option>${options}</select><label class="lab" for="voice-kind">${t('transaction_type')}</label><select class="input" id="voice-kind"><option value="income">${t('income')}</option><option value="expense">${t('expenses')}</option></select><label class="lab" for="voice-amount">${t('amount')}</label><input class="input" id="voice-amount" type="number" min="0.01" step="0.01" placeholder="0.00"><label class="lab" for="voice-date">${t('date')}</label><input class="input" id="voice-date" type="date" value="${D.todayISO()}"></div><div class="sheet-actions"><button class="btn" data-action="close-voice">${t('cancel')}</button><button class="btn primary" data-action="voice-save">تحليل الأمر ومتابعة</button></div></section></div>`;
}

function parseSpokenTaskDate(text){
  const today=D.parse(D.todayISO());
  const iso=(String(text).match(/\b20\d{2}-\d{2}-\d{2}\b/)||[])[0];if(iso&&D.isValidISO(iso))return iso;
  if(/بكرة|غدا|غداً|tomorrow/i.test(text))return D.addDays(D.todayISO(),1);
  if(/النهارده|اليوم|today/i.test(text))return D.todayISO();
  const monthNames={يناير:0,فبراير:1,مارس:2,ابريل:3,أبريل:3,مايو:4,يونيو:5,يوليو:6,أغسطس:7,اغسطس:7,سبتمبر:8,أكتوبر:9,اكتوبر:9,نوفمبر:10,ديسمبر:11,january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
  const named=Object.entries(monthNames).find(([m])=>new RegExp(m,'i').test(text));
  const dayMatch=text.match(/(?:يوم\s*|day\s+)(\d{1,2})/i);
  if(named&&dayMatch){let y=today.getFullYear(),m=named[1];if(m<today.getMonth()||(m===today.getMonth()&&Number(dayMatch[1])<today.getDate()))y++;const d=new Date(y,m,Number(dayMatch[1]));if(d.getMonth()===m&&d.getDate()===Number(dayMatch[1]))return D.iso(d);}
  const nextMonth=/الشهر القادم|الشهر الجاي|الشهر المقبل|next month/i.test(text);
  if(dayMatch&&(nextMonth||/يوم\s*\d{1,2}/.test(text))){let y=today.getFullYear(),m=today.getMonth()+(nextMonth?1:0);if(!nextMonth&&Number(dayMatch[1])<today.getDate())m++;const d=new Date(y,m,Number(dayMatch[1]));if(d.getDate()===Number(dayMatch[1]))return D.iso(d);}
  return D.todayISO();
}

function inferVoiceCommand(raw) {
  const text=String(raw||'').trim(), low=text.toLowerCase();
  const numMatch=text.match(/\d[\d,،]*(?:[.]\d+)?/);
  let project=S.projects.find(p=>text.includes(p.name));
  let target=$('#voice-target')?.value||'auto';
  if(target==='auto') {
    if(/تقرير|اطبع|طباعة|موقف المشروع|التقرير المالي|تقرير فني/.test(text)) target='report';
    else if(/مشروع جديد|اعمل مشروع|أنشئ مشروع|انشئ مشروع|بدأت مشروع/.test(text)) target='project';
    else if(/لوحة|تسليم|اعتماد|اعتمد|مراجعة|rev\s*0?\d/i.test(text)) target='deliverable';
    else if(/دفعة|استلمت|قبضت|تحصيل|مصروف|دفعت|صرفت|جنيه|ج\.م/.test(text)) target='finance';
    else target='task';
  }
  const amount=numMatch?Number(numMatch[0].replace(/[،,]/g,'')):0;
  const weekdayMap={'الأحد':0,'الاحد':0,'الإثنين':1,'الاثنين':1,'الثلاثاء':2,'الأربعاء':3,'الاربعاء':3,'الخميس':4,'الجمعة':5,'السبت':6,'sunday':0,'monday':1,'tuesday':2,'wednesday':3,'thursday':4,'friday':5,'saturday':6};
   const weekdayEntry=Object.entries(weekdayMap).find(([name])=>new RegExp(name,'i').test(text));
   let date=/بكرة|غدا|غداً|tomorrow/i.test(text)?D.addDays(D.todayISO(),1):/النهارده|اليوم|today/i.test(text)?D.todayISO():((text.match(/\b20\d{2}-\d{2}-\d{2}\b/)||[])[0]||D.todayISO());
   if(weekdayEntry){const today=D.parse(D.todayISO()).getDay(),delta=(weekdayEntry[1]-today+7)%7||7;date=D.addDays(D.todayISO(),delta);}
   const afterMinutes=text.match(/بعد\s*(\d+)\s*دقيق|in\s*(\d+)\s*minutes?/i);
  const priority=/مهم جدا|مهمة جدًا|أولوية عالية|عاجل|ضروري/.test(text)?3:/مش مهم|أولوية منخفضة/.test(text)?1:2;
  const isExpense=/مصروف|صرفت|دفعت/.test(text), kind=isExpense?'expense':'income';
  return {text,target,project,amount,date,priority,kind,low,afterMinutes:afterMinutes?Number(afterMinutes[1]||afterMinutes[2]):null};
}
function startVoiceRecognition() {
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){toast(t('voice_unsupported'));return;}
  const rec=new SR(); rec.lang=$('#voice-language')?.value || 'ar-EG'; rec.interimResults=true; rec.continuous=false;
  const status=$('#voice-status'), field=$('#voice-text'); let finalText='';
  rec.onstart=()=>{if(status)status.textContent=t('voice_listening');};
  rec.onerror=()=>{if(status)status.textContent=t('voice_error');};
  rec.onresult=(e)=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const txt=e.results[i][0].transcript;if(e.results[i].isFinal)finalText+=txt+' ';else interim+=txt;}if(field)field.value=(finalText+interim).trim(); const c=inferVoiceCommand(field?.value||''); const target=$('#voice-target');if(target&&target.value==='auto'){} const amt=$('#voice-amount');if(c.amount&&amt)amt.value=c.amount;const proj=$('#voice-project');if(c.project&&proj)proj.value=c.project.id;const kind=$('#voice-kind');if(kind)kind.value=c.kind;const box=$('#voice-finance-fields');if(box)box.hidden=c.target!=='finance';const msg=$('#voice-understanding');if(msg)msg.textContent=`النوع المتوقع: ${{task:'مهمة',finance:'حركة مالية (تحتاج تأكيدًا)',project:'إنشاء مشروع (يحتاج تأكيدًا)',deliverable:'تحديث تسليم/اعتماد (يحتاج تأكيدًا)',report:'تقرير'}[c.target]||'مهمة'}. ${c.project?'المشروع: '+c.project.name+'. ':''}${c.amount?'المبلغ المكتشف: '+c.amount+'. ':''}راجع البيانات قبل المتابعة.`;};
  rec.onend=()=>{if(status)status.textContent=t('voice_done');}; rec.start();
}
async function handleVoiceCommand(c) {
  if(c.target==='report') {
    if(!c.project){toast('لم أتعرف على اسم مشروع موجود. افتح المشروع المطلوب أو اكتب اسمه كما هو.');return;}
    const financial=/مالي|مالية|تحصيل|مصروف/.test(c.text); printProjectReport(c.project.id,financial?'finance':'status'); $('#layer').innerHTML=''; return;
  }
  if(c.target==='task') {
    const date=c.date, title=c.text.length>90?c.text.slice(0,87)+'…':c.text;
    const task=normalizeTask({id:uid(),title,notes:c.afterMinutes?`تنبيه/موعد بعد ${c.afterMinutes} دقيقة. ${c.text}`:c.text,date,weekRef:date,priority:c.priority,status:'todo',createdAt:Date.now(),updatedAt:Date.now(),projectId:c.project?.id||null});
    return S.store.save('tasks',task).then(()=>{toast('تم حفظ المهمة.');$('#layer').innerHTML='';render();});
  }
  if(c.target==='finance') {
    const projectId=$('#voice-project')?.value||c.project?.id, amount=Number($('#voice-amount')?.value)||c.amount;
    if(!projectId||!amount||amount<=0){toast('لازم تحدد مشروعًا ومبلغًا صحيحًا قبل تسجيل الحركة المالية.');return;}
    const project=S.projects.find(p=>p.id===projectId); const kind=$('#voice-kind')?.value||c.kind; const date=$('#voice-date')?.value||c.date;
    if(!confirm(`تأكيد تسجيل ${kind==='income'?'تحصيل':'مصروف'} بقيمة ${money(amount)} ج.م في مشروع «${project?.name||''}» بتاريخ ${date}؟`))return;
    return S.store.save('financeEntries',{id:uid(),projectId,kind,amount,date,category:t('general'),description:c.text,createdAt:Date.now(),source:'voice'}).then(()=>{toast(t('saved'));$('#layer').innerHTML='';render();});
  }
  if(c.target==='project') {
    const name=c.text.replace(/.*?(?:مشروع جديد|اعمل مشروع|أنشئ مشروع|انشئ مشروع|بدأت مشروع)\s*/,'').trim().slice(0,160);
    if(!name||name===c.text){toast('اذكر اسم المشروع بوضوح، ثم أعد المحاولة.');return;}
    if(!confirm(`هل تريد إنشاء مشروع جديد باسم «${name}»؟`))return;
    const type=/سكني|فيلا|شقة|منزل/.test(c.text)?'residential':/إداري|مكتب|شركة/.test(c.text)?'administrative':/تجاري|محل|عيادة/.test(c.text)?'commercial':'fitout';
    const p={id:uid(),name,type,status:'planning',client:'',location:'',contractValue:0,startDate:D.todayISO(),endDate:null,notes:`تم الإنشاء من الأمر الصوتي: ${c.text}`,createdAt:Date.now(),updatedAt:Date.now(),source:'voice'};
    const duplicate=S.projects.find(x=>x.id!==p.id&&x.name.trim().toLocaleLowerCase()===p.name.trim().toLocaleLowerCase());
      if(duplicate) {
        const openExisting=confirm(`يوجد مشروع باسم «${duplicate.name}» بالفعل. اضغط موافق لفتح المشروع الموجود، أو إلغاء لمراجعة خيار إنشاء نسخة أخرى.`);
        if(openExisting){S.activeProjectId=duplicate.id;closeSheet();render();return;}
        if(!confirm('هل تريد رغم ذلك إنشاء مشروع آخر بنفس الاسم؟')){toast('تم إلغاء الحفظ لتجنب التكرار.');return;}
      }
      await S.store.save('projects',p); S.activeProjectId=p.id; S.section='projects'; $('#layer').innerHTML=''; toast('تم إنشاء المشروع. راجع بياناته وأكمل العميل وقيمة التعاقد عند الحاجة.'); render(); return;
  }
  if(c.target==='deliverable') {
    if(!c.project){toast('حدد المشروع أولًا أو اذكر اسمه المطابق في الأمر.');return;}
    const name=(c.text.match(/(?:لوحة|تسليم)\s+(.+?)(?:\s+(?:rev|مراجعة|واتعمدت|وتم الاعتماد|اتعمدت|اعتمدت|اتسلمت|تم التسليم).*)?$/i)||[])[1];
    const revision=(c.text.match(/rev\s*0?\d+/i)||[])[0]||((c.text.match(/مراجعة\s*0?\d+/)||[])[0]||'');
    const approved=/اعتمد|اتعمدت|معتمد/.test(c.text), submitted=/سلمت|اتسلمت|تم التسليم/.test(c.text);
    if(!name){toast('لم أستطع تحديد اسم اللوحة بدقة. اكتب اسم اللوحة في النص ثم أعد المحاولة.');return;}
    const status=approved?'approved':submitted?'submitted':'pending';
    if(!confirm(`تأكيد تحديث مشروع «${c.project.name}»؟\nالتسليم: ${name.trim()}\nالمراجعة: ${revision||'غير محددة'}\nالحالة: ${{approved:'معتمد',submitted:'مرسل للمراجعة',pending:'لم يُرسل'}[status]}`))return;
    const d={id:uid(),projectId:c.project.id,name:name.trim(),stage:'technical',kind:'other',dueDate:c.date,status,notes:`${revision?revision+' · ':''}${c.text}`,createdAt:Date.now(),updatedAt:Date.now(),source:'voice'};
    return S.store.save('deliverables',d).then(()=>{toast('تم تسجيل تحديث التسليم.');$('#layer').innerHTML='';render();});
  }
}


function renderMeetings() {
  if(S.activeMeetingProjectId) {
    const p=S.projects.find(x=>x.id===S.activeMeetingProjectId);
    if(!p){S.activeMeetingProjectId=null;return renderMeetings();}
    const rows=S.meetings.filter(m=>m.projectId===p.id).sort((a,b)=>(a.sequence||0)-(b.sequence||0));
    return `<div class="page-tools"><button class="btn sm" data-action="meeting-back">← كل المشاريع</button><span class="chip">${rows.length} Meetings</span></div>
      <section class="card glass"><h2>${esc(p.name)}</h2><p class="muted">${esc(p.client||'')}</p></section>
      ${rows.map(m=>`<section class="card glass meeting-card"><div class="dhead"><div><h2>Meeting ${String(m.sequence||0).padStart(2,'0')} · ${esc(m.title||'')}</h2><p class="muted">${esc(m.date)} ${esc(m.time||'')} · ${m.mode==='online'?'Online':'Offline'}</p></div><button class="btn sm" data-action="meeting-print" data-id="${esc(m.id)}">طباعة MOM</button></div><p>${esc(m.minutes||m.transcript||'لا يوجد ملخص بعد')}</p></section>`).join('')||'<p class="muted">لا توجد اجتماعات مسجلة لهذا المشروع.</p>'}`;
  }
  const projects=[...S.projects].sort((a,b)=>a.name.localeCompare(b.name));
  return `<div class="page-tools"><p class="muted">سجل اجتماعات العملاء ومحاضر الاجتماعات، مرتب حسب المشروع.</p></div>
    <section class="card glass"><h2>تسجيل اجتماع جديد</h2>
      <form data-action="save-meeting" class="entry-form">
        <div class="form-grid"><div><label class="lab" for="meeting-project">المشروع القائم</label><select class="input" id="meeting-project"><option value="">اختر مشروعًا أو أنشئ مشروعًا جديدًا بالأسفل</option>${projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
        <div><label class="lab" for="meeting-new-project">أو اسم مشروع جديد</label><input class="input" id="meeting-new-project" placeholder="اسم المشروع الجديد"></div>
        <div><label class="lab" for="meeting-client">اسم العميل</label><input class="input" id="meeting-client"></div>
        <div><label class="lab" for="meeting-date">التاريخ</label><input class="input" id="meeting-date" type="date" value="${D.todayISO()}" required></div>
        <div><label class="lab" for="meeting-time">الوقت</label><input class="input" id="meeting-time" type="time"></div>
        <div><label class="lab" for="meeting-mode">نوع الاجتماع</label><select class="input" id="meeting-mode"><option value="online">Online</option><option value="offline">Offline</option></select></div></div>
        <label class="lab" for="meeting-title">عنوان الاجتماع</label><input class="input" id="meeting-title" placeholder="موضوع الاجتماع">
        <label class="lab" for="meeting-participants">الحضور</label><input class="input" id="meeting-participants">
        <div class="meeting-record-row"><select class="input compact" id="meeting-language" aria-label="Speech language"><option value="ar-EG">العربية</option><option value="en-US">English</option></select><button class="btn" type="button" data-action="meeting-record">🎙 بدء الإملاء الصوتي</button><button class="btn" type="button" data-action="meeting-stop">إيقاف الإملاء</button><span class="muted small">يحتاج إبقاء صفحة التطبيق مفتوحة أثناء الإملاء.</span></div>
        <label class="lab" for="meeting-transcript">نص التسجيل / الملاحظات</label><textarea class="input textarea" id="meeting-transcript" rows="5" placeholder="يمكنك الإملاء أو كتابة النقاط هنا"></textarea>
        <label class="lab" for="meeting-minutes">Minutes of Meeting</label><textarea class="input textarea" id="meeting-minutes" rows="5" placeholder="الملخص والاتفاقات وطلبات العميل"></textarea>
        <label class="lab" for="meeting-decisions">القرارات</label><textarea class="input textarea" id="meeting-decisions" rows="3"></textarea>
        <label class="lab" for="meeting-actions">المهام والمسؤوليات والمواعيد</label><textarea class="input textarea" id="meeting-actions" rows="3"></textarea>
        <button class="btn primary" type="submit">حفظ الاجتماع</button>
      </form>
    </section>
    <section class="card glass"><h2>المشاريع والاجتماعات</h2>
      ${projects.map(p=>{const n=S.meetings.filter(m=>m.projectId===p.id).length;return `<button class="meeting-project" data-action="meeting-project" data-id="${esc(p.id)}"><span><b>${esc(p.name)}</b><small>${esc(p.client||'')}</small></span><span class="chip">${n} Meetings →</span></button>`}).join('')||'<p class="muted">لا توجد مشاريع بعد. يمكنك إنشاء أول مشروع من نموذج الاجتماع.</p>'}
    </section>`;
}
function startMeetingRecognition(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){toast(t('voice_unsupported'));return;}
  const rec=new SR();rec.lang=$('#meeting-language')?.value||(lang()==='ar'?'ar-EG':'en-US');rec.continuous=true;rec.interimResults=true;S.meetingRecognition=rec;
  const field=$('#meeting-transcript');let finalText=field.value?field.value+' ':'';
  rec.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const v=e.results[i][0].transcript;if(e.results[i].isFinal)finalText+=v+' ';else interim+=v;}field.value=(finalText+interim).trim();};
  rec.onerror=()=>toast('تعذر الوصول للميكروفون. تحقق من صلاحية المتصفح.');
  rec.onend=()=>{S.meetingRecognition=null;toast('انتهى الإملاء الصوتي. راجع النص قبل الحفظ.');};
  try{rec.start();toast('بدأ الإملاء الصوتي. اترك صفحة التطبيق مفتوحة.');}catch(e){toast('تعذر بدء التسجيل الصوتي.');}
}
function printMeetingReport(id){
  const m=S.meetings.find(x=>x.id===id),p=m&&S.projects.find(x=>x.id===m.projectId);if(!m||!p)return;
  const w=window.open('','_blank');if(!w){toast(t('print_popup_blocked'));return;}
  const block=(label,value)=>value?`<h3>${label}</h3><p>${esc(value).replace(/\\n/g,'<br>')}</p>`:'';
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>Minutes of Meeting</title><style>body{font-family:Arial;padding:28px;line-height:1.7;color:#222}h1{font-size:24px}h2{font-size:18px}.meta{color:#666;border-bottom:1px solid #ddd;padding-bottom:12px}@media print{button{display:none}}</style><h1>Minutes of Meeting</h1><h2>${esc(p.name)} · Meeting ${String(m.sequence||0).padStart(2,'0')}</h2><div class="meta">العميل: ${esc(m.client||p.client||'—')} · التاريخ: ${esc(m.date)} · الوقت: ${esc(m.time||'—')} · ${m.mode==='online'?'Online':'Offline'}</div>${block('الحضور',m.participants)}${block('ملخص الاجتماع',m.minutes)}${block('نص التسجيل',m.transcript)}${block('القرارات',m.decisions)}${block('المهام والمسؤوليات',m.actions)}<p class="meta">Generated by WeeklyPlanner</p><script>window.onload=()=>setTimeout(()=>window.print(),250)<\\/script></html>`);w.document.close();
}

function renderFinance() {
  if (S.financeView === 'personal') return renderPersonalExpenses();
  const totalIncome=S.financeEntries.filter(x=>x.kind==='income').reduce((n,x)=>n+Number(x.amount||0),0), totalExpense=S.financeEntries.filter(x=>x.kind==='expense').reduce((n,x)=>n+Number(x.amount||0),0), contracts=S.projects.reduce((n,p)=>n+Number(p.contractValue||0),0);
  const entries=[...S.financeEntries].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return `<div class="finance-switch"><button class="btn ${S.financeView==='projects'?'primary':''}" data-action="finance-view" data-val="projects">ماليات المشروعات</button><button class="btn ${S.financeView==='personal'?'primary':''}" data-action="finance-view" data-val="personal">المصروف الشخصي</button></div><div class="stats-grid"><div class="card glass stat"><span>${t('contracts_total')}</span><strong>${money(contracts)} ${t('currency')}</strong></div><div class="card glass stat"><span>${t('collected')}</span><strong>${money(totalIncome)} ${t('currency')}</strong></div><div class="card glass stat"><span>${t('expenses')}</span><strong>${money(totalExpense)} ${t('currency')}</strong></div><div class="card glass stat"><span>${t('net_cash')}</span><strong>${money(totalIncome-totalExpense)} ${t('currency')}</strong></div></div>
  <section class="card glass"><h2>${t('add_finance_entry')}</h2><form data-action="add-finance" class="entry-form"><div class="form-grid"><div><label class="lab" for="f-project">${t('project')}</label><select class="input" id="f-project" required><option value="">${t('choose_project')}</option>${S.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div><div><label class="lab" for="f-kind">${t('transaction_type')}</label><select class="input" id="f-kind"><option value="income">${t('income')}</option><option value="expense">${t('expenses')}</option></select></div>${inputField(t('amount'),'f-amount','number','', 'min="0.01" step="0.01" required')}${inputField(t('date'),'f-fin-date','date',D.todayISO())}<div><label class="lab" for="f-category">${t('category')}</label><select class="input" id="f-category"><option>${t('general')}</option><option>${t('design')}</option><option>${t('materials')}</option><option>${t('labor')}</option><option>${t('transport')}</option><option>${t('other')}</option></select></div></div><label class="lab" for="f-description">${t('description')}</label><input class="input" id="f-description"><button class="btn primary" type="submit">${t('save_entry')}</button></form></section>
  <section class="card glass"><h2>${t('transactions')}</h2>${entries.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>${t('date')}</th><th>${t('project')}</th><th>${t('category')}</th><th>${t('transaction_type')}</th><th>${t('amount')}</th><th></th></tr></thead><tbody>${entries.map(x=>`<tr><td>${esc(x.date||'—')}</td><td>${esc(S.projects.find(p=>p.id===x.projectId)?.name||t('project_deleted'))}</td><td>${esc(x.category||'—')}<small>${esc(x.description||'')}</small></td><td>${x.kind==='income'?t('income'):t('expenses')}</td><td class="${x.kind==='income'?'positive':'negative'}">${x.kind==='income'?'+':'−'}${money(x.amount)} ${t('currency')}</td><td><button class="btn sm danger" data-action="delete-finance" data-id="${esc(x.id)}">×</button></td></tr>`).join('')}</tbody></table></div>`:`<p class="muted">${t('no_transactions')}</p>`}</section>`;
}

async function editPersonalExpense(id) {
  const x=S.personalExpenses.find(v=>v.id===id); if(!x)return;
  const amount=prompt('المبلغ الجديد:',String(x.amount)); if(amount===null)return;
  const description=prompt('وصف المصروف:',x.description||''); if(description===null)return;
  const value=Number(amount); if(!Number.isFinite(value)||value<=0||!description.trim()){toast('بيانات غير صحيحة.');return;}
  try { await S.store.save('personalExpenses',{...x,amount:value,description:description.trim(),updatedAt:Date.now()}); toast('تم تحديث المصروف.'); }
  catch(err){toast(t('save_failed',{msg:err.message||err}));}
}
function renderPersonalExpenses() {
  const month = S.expenseMonth || D.todayISO().slice(0,7);
  const budget = Number(S.personalBudgets.find(x=>x.id===month)?.amount || 0);
  const rows = S.personalExpenses.filter(x=>(x.date||'').slice(0,7)===month).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.createdAt||0)-(a.createdAt||0));
  const spent = rows.reduce((n,x)=>n+Number(x.amount||0),0);
  const remaining = budget-spent;
  const categoryTotals = rows.reduce((acc,x)=>{const key=(x.category||'أخرى').trim()||'أخرى';acc[key]=(acc[key]||0)+Number(x.amount||0);return acc;},{});
  const categoryRows = Object.entries(categoryTotals).sort((a,b)=>b[1]-a[1]);
  const personalCategories = ['سكن وفواتير','مواصلات','طعام ومشروبات','مشتريات البيت','صحة','تعليم','ترفيه','ملابس','التزامات وديون','أخرى'];
  return `<div class="finance-switch"><button class="btn" data-action="finance-view" data-val="projects">ماليات المشروعات</button><button class="btn primary" data-action="finance-view" data-val="personal">المصروف الشخصي</button></div>
  <section class="card glass">
    <div class="dhead"><h2>ميزانية الشهر</h2><input class="input compact" id="expense-month" type="month" value="${esc(month)}" aria-label="الشهر"></div>
    <form data-action="save-personal-budget" class="entry-form">
      <label class="lab" for="personal-budget">الميزانية الشهرية (جنيه)</label>
      <div class="form-grid"><input class="input" id="personal-budget" type="number" min="0" step="0.01" value="${budget||''}" placeholder="مثال: 5000" required><button class="btn primary" type="submit">حفظ الميزانية</button></div>
    </form>
    <div class="stats-grid personal-stats">
      <div class="card glass stat"><span>الميزانية</span><strong>${money(budget)} ج.م</strong></div>
      <div class="card glass stat"><span>المصروف</span><strong>${money(spent)} ج.م</strong></div>
      <div class="card glass stat"><span>المتبقي</span><strong class="${remaining<0?'negative':'positive'}">${money(remaining)} ج.م</strong></div>
      <div class="card glass stat"><span>المستهلك</span><strong>${budget>0?Math.round(spent/budget*100):0}%</strong></div>
    </div>
    ${budget>0&&spent>budget?'<p class="expense-warning">تنبيه: المصروف تجاوز الميزانية الشهرية، ويمكنك الاستمرار في التسجيل.</p>':''}
  </section>
  <section class="card glass"><h2>تسجيل مصروف</h2>
    <form data-action="add-personal-expense" class="entry-form">
      <div class="form-grid"><div><label class="lab" for="pe-amount">المبلغ (جنيه)</label><input class="input" id="pe-amount" type="number" min="0.01" step="0.01" required></div>
      <div><label class="lab" for="pe-date">التاريخ</label><input class="input" id="pe-date" type="date" value="${D.todayISO()}" required></div></div>
      <div><label class="lab" for="pe-category">تصنيف المصروف</label><select class="input" id="pe-category" required>${personalCategories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div>
      <label class="lab" for="pe-description">وصف المصروف</label><input class="input" id="pe-description" maxlength="180" placeholder="مثال: مواصلات، مشتريات البيت" required>
      <button class="btn primary" type="submit">إضافة المصروف</button>
    </form>
  </section>
  <section class="card glass"><h2>تحليل المصروفات حسب التصنيف</h2>
    ${categoryRows.length?`<div class="category-breakdown">${categoryRows.map(([name,total])=>`<div class="category-row"><div class="category-row-head"><strong>${esc(name)}</strong><span>${money(total)} ج.م · ${spent>0?Math.round(total/spent*100):0}%</span></div><div class="category-track"><span style="width:${spent>0?Math.min(100,total/spent*100):0}%"></span></div></div>`).join('')}</div>`:'<p class="muted">سجّل مصروفات لتظهر تفاصيل التصنيفات هنا.</p>'}
  </section>
  <section class="card glass"><h2>سجل المصروفات · ${esc(month)}</h2>
    ${rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th><th>إجراءات</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.description||'—')}</td><td class="negative">${money(x.amount)} ج.م</td><td><button class="btn sm" data-action="edit-personal-expense" data-id="${esc(x.id)}">تعديل</button> <button class="btn sm danger" data-action="delete-personal-expense" data-id="${esc(x.id)}">حذف</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">لا توجد مصروفات مسجلة في هذا الشهر.</p>'}
  </section>`;
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
    tasks: S.tasks, settings: S.settings, projects: S.projects, deliverables: S.deliverables, financeEntries: S.financeEntries, personalExpenses: S.personalExpenses, personalBudgets: S.personalBudgets, meetings: S.meetings,
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
    for (const key of ['projects', 'deliverables', 'financeEntries', 'personalExpenses', 'personalBudgets', 'meetings']) { if (Array.isArray(data[key])) for (const raw of data[key].slice(0, 10000)) { if (raw && typeof raw === 'object' && raw.id) { await S.store.save(key, raw); n++; } } }
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
    case 'auth-toggle': S.authMode=S.authMode==='signup'?'signin':'signup'; renderLogin(); break;
    case 'auth-reset': { const email=$('#auth-email')?.value.trim(); if(!email){toast('اكتب بريدك الإلكتروني أولًا.');break;} try{await S.store.resetPassword(email);toast('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك.');}catch(err){toast(err.message||'تعذر إرسال الرابط.');} break; }
    case 'login-lang': updateSettings({ lang: lang() === 'ar' ? 'en' : 'ar' }, { render: false }); renderLogin(); break;
    case 'nav': S.section = el.dataset.section; S.activeProjectId = null; S.activeMeetingProjectId = null; render(); window.scrollTo(0, 0); break;
    case 'voice-open': openVoiceSheet(); break;
    case 'voice-start': startVoiceRecognition(); break;
    case 'close-voice': $('#layer').innerHTML=''; break;
    case 'finance-view': S.financeView=v; render(); break;
    case 'edit-personal-expense': editPersonalExpense(el.dataset.id); break;
    case 'delete-personal-expense': if(confirm('حذف المصروف؟')) { await S.store.remove('personalExpenses',el.dataset.id); toast('تم حذف المصروف.'); } break;
    case 'print-project': openPrintChoice(el.dataset.id); break;
    case 'print-status': $('#layer').innerHTML=''; printProjectReport(el.dataset.id,'status'); break;
    case 'print-finance': $('#layer').innerHTML=''; printProjectReport(el.dataset.id,'finance'); break;
    case 'meeting-record': startMeetingRecognition(); break;
    case 'meeting-stop': if(S.meetingRecognition){S.meetingRecognition.stop();S.meetingRecognition=null;} break;
    case 'meeting-project': S.activeMeetingProjectId=el.dataset.id; render(); break;
    case 'meeting-print': printMeetingReport(el.dataset.id); break;
    case 'meeting-back': S.activeMeetingProjectId=null; render(); break;
    case 'voice-save': { const text=$('#voice-text')?.value.trim(); if(!text){toast(t('voice_empty'));break;} const c=inferVoiceCommand(text); try { await handleVoiceCommand(c); } catch(err) { console.error(err); toast(t('save_failed',{msg:err.message||err})); } break; }
    case 'new-project': openProjectSheet(); break;
    case 'edit-project': openProjectSheet(el.dataset.id); break;
    case 'open-project': S.activeProjectId = el.dataset.id; render(); window.scrollTo(0,0); break;
    case 'projects-back': S.activeProjectId = null; render(); break;
    case 'delete-project': { const p=S.projects.find(x=>x.id===el.dataset.id); if(p && confirm(t('confirm_delete_project'))) { for(const d of S.deliverables.filter(x=>x.projectId===p.id)) await S.store.remove('deliverables',d.id); for(const f of S.financeEntries.filter(x=>x.projectId===p.id)) await S.store.remove('financeEntries',f.id); for(const m of S.meetings.filter(x=>x.projectId===p.id)) await S.store.remove('meetings',m.id); await S.store.remove('projects',p.id); S.activeProjectId=null; toast(t('project_deleted_ok')); render(); } break; }
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
const el = e.target.closest('form[data-action]'); if (!el) return; const a = el.dataset.action; if (!['save-project','add-deliverable','add-finance','save-personal-budget','add-personal-expense','edit-personal-expense','auth-email','save-meeting'].includes(a)) return; e.preventDefault(); if (!el.reportValidity()) return; const submitBtn=el.querySelector('[type=submit]'); if(submitBtn?.disabled)return; if(submitBtn){submitBtn.disabled=true;submitBtn.dataset.oldText=submitBtn.textContent;submitBtn.textContent='جارٍ الحفظ…';} try {
    if (a === 'auth-email') { const email=$('#auth-email').value.trim(), password=$('#auth-password').value; if(S.authMode==='signup') await S.store.signUpEmail(email,password); else await S.store.signInEmail(email,password); toast(S.authMode==='signup'?'تم إنشاء الحساب.':'تم تسجيل الدخول.'); }
    else if (a === 'save-project') { const old=S.projects.find(x=>x.id===el.dataset.id); const p={ id:old?.id||uid(), name:$('#p-name').value.trim(), type:$('#p-type').value, status:$('#p-status').value, client:$('#p-client').value.trim(), location:$('#p-location').value.trim(), contractValue:Number($('#p-contract').value)||0, startDate:$('#p-start').value||null, endDate:$('#p-end').value||null, notes:$('#p-notes').value.trim(), createdAt:old?.createdAt||Date.now(), updatedAt:Date.now() }; const duplicate=S.projects.find(x=>x.id!==p.id&&x.name.trim().toLocaleLowerCase()===p.name.trim().toLocaleLowerCase());
      if(duplicate) {
        const openExisting=confirm(`يوجد مشروع باسم «${duplicate.name}» بالفعل. اضغط موافق لفتح المشروع الموجود، أو إلغاء لمراجعة خيار إنشاء نسخة أخرى.`);
        if(openExisting){S.activeProjectId=duplicate.id;closeSheet();render();return;}
        if(!confirm('هل تريد رغم ذلك إنشاء مشروع آخر بنفس الاسم؟')){toast('تم إلغاء الحفظ لتجنب التكرار.');return;}
      }
      await S.store.save('projects',p); S.activeProjectId=p.id; closeSheet(); toast(old?'تم تحديث المشروع بنجاح.':'تم إنشاء المشروع بنجاح.'); render(); }
    else if (a === 'save-meeting') {
      const existingProjectId=$('#meeting-project').value;
      const newProjectName=$('#meeting-new-project').value.trim();
      let project=S.projects.find(p=>p.id===existingProjectId);
      if(newProjectName) {
        const duplicate=S.projects.find(p=>p.name.trim().toLocaleLowerCase()===newProjectName.toLocaleLowerCase());
        if(duplicate && !confirm(`يوجد مشروع باسم «${duplicate.name}». هل تريد ربط الاجتماع بالمشروع الموجود؟ اضغط إلغاء لإنشاء مشروع جديد.`)) throw new Error('ألغيت العملية لتجنب ربط الاجتماع بمشروع غير مقصود.');
        if(duplicate) project=duplicate;
        else {
          project={id:uid(),name:newProjectName,type:'residential',status:'planning',client:$('#meeting-client').value.trim(),location:'',contractValue:0,notes:'تم إنشاؤه من سجل الاجتماعات',createdAt:Date.now(),updatedAt:Date.now()};
          await S.store.save('projects',project);
        }
      }
      if(!project) throw new Error('اختر مشروعًا أو اكتب اسم مشروع جديد.');
      const date=$('#meeting-date').value||D.todayISO();
      const previous=S.meetings.filter(m=>m.projectId===project.id);
      const sequence=previous.reduce((n,m)=>Math.max(n,Number(m.sequence)||0),-1)+1;
      const meeting={id:uid(),projectId:project.id,sequence,title:$('#meeting-title').value.trim()||`Meeting ${String(sequence).padStart(2,'0')}`,client:$('#meeting-client').value.trim()||project.client||'',date,time:$('#meeting-time').value||'',mode:$('#meeting-mode').value,participants:$('#meeting-participants').value.trim(),transcript:$('#meeting-transcript').value.trim(),minutes:$('#meeting-minutes').value.trim(),decisions:$('#meeting-decisions').value.trim(),actions:$('#meeting-actions').value.trim(),createdAt:Date.now(),updatedAt:Date.now()};
      await S.store.save('meetings',meeting);
      toast(`تم حفظ Meeting ${String(sequence).padStart(2,'0')} في مشروع ${project.name}.`);
      el.reset(); $('#meeting-date').value=D.todayISO(); render();
    }
    else if (a === 'save-personal-budget') { const amount=Number($('#personal-budget').value); if(amount<0||!Number.isFinite(amount)) throw new Error('أدخل ميزانية صحيحة'); const month=S.expenseMonth; await S.store.save('personalBudgets',{id:month,amount,updatedAt:Date.now()}); toast('تم حفظ الميزانية.'); }
    else if (a === 'add-personal-expense') { const x={id:uid(),amount:Number($('#pe-amount').value),date:$('#pe-date').value,category:$('#pe-category').value||'أخرى',description:$('#pe-description').value.trim(),createdAt:Date.now(),updatedAt:Date.now()}; if(!x.description||x.amount<=0) throw new Error('أدخل وصفًا ومبلغًا صحيحًا'); await S.store.save('personalExpenses',x); toast('تم تسجيل المصروف.'); el.reset(); $('#pe-date').value=D.todayISO(); }
    else if (a === 'edit-personal-expense') { /* edited through prompt in click handler */ }
    else if (a === 'add-deliverable') { const d={id:uid(), projectId:$('#d-project').value, name:$('#d-name').value.trim(), stage:$('#d-stage').value, kind:$('#d-kind').value, dueDate:$('#d-date').value||null, status:$('#d-status').value, notes:$('#d-notes').value.trim(), createdAt:Date.now(), updatedAt:Date.now()}; if(!d.name){toast(t('title_required'));return;} await S.store.save('deliverables',d); el.reset(); toast('تم تسجيل بيانات التسليم بنجاح.'); }
    else { const x={id:uid(),projectId:$('#f-project').value,kind:$('#f-kind').value,amount:Number($('#f-amount').value),date:$('#f-fin-date').value||D.todayISO(),category:$('#f-category').value,description:$('#f-description').value.trim(),createdAt:Date.now()}; if(!x.projectId||x.amount<=0){toast(t('form_required'));return;} await S.store.save('financeEntries',x); el.reset(); $('#f-fin-date').value=D.todayISO(); toast('تم تسجيل الحركة المالية بنجاح.'); }
  } catch(err) { toast(t('save_failed',{msg:err.message||err})); }
  finally { if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=submitBtn.dataset.oldText||'حفظ';} }
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
  const el = e.target;
  if (el.id === 'voice-target') { const box=$('#voice-finance-fields'); if(box) box.hidden=el.value!=='finance'; return; }
  if(el.id==='expense-month' && /^\d{4}-\d{2}$/.test(el.value)){S.expenseMonth=el.value;render();return;}
  const changed = el.closest('[data-change]');
  if (!changed) return;
  const k = changed.dataset.change;
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
  if (e.key === 'Escape' && $('#layer')?.innerHTML) { $('#layer').innerHTML=''; if (S.sheet) S.sheet=null; return; }
  if (e.key === 'Escape' && S.sheet) { closeSheet(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (S.sheet && e.key === 'Enter' && document.activeElement && document.activeElement.id === 'f-title') { e.preventDefault(); saveSheet(); return; }
  if (!typing && !S.sheet && S.user && S.section === 'tasks' && e.key === 'n') { e.preventDefault(); openSheet(null); return; }
  if (e.key === 'Enter' && document.activeElement && document.activeElement.classList.contains('tbody')) openSheet(document.activeElement.dataset.id);
}

boot();
