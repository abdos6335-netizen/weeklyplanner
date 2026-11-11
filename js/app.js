// WeeklyPlanner — المهام الأسبوعية والمشروعات والتسليمات والماليات والإدخال الصوتي.
import { createStore } from './store.js';
import { t, setLang, lang, dir, locale } from './i18n.js';
import { translateText } from './i18n-en.js';
import { buildProjectReport, buildDocument, reportShell, esc as rEsc } from './report.js';
import { parseWhatsAppChat, senderList, extractRequirements, buildManagerReport, managerIntent } from './assistant.js';
import { buildToday, parseCaptureActions, revisionState, ACTION_KIND } from './today.js';
import * as D from './dates.js';
import { icon, badge } from './icons.js';
import {
  applyTheme, mergeTheme, DEFAULT_THEME, PRESETS, FONTS, ensureFont, fontKey,
  effectiveMode, shownColors, watchSystemMode,
} from './theme.js';

const VERSION = '3.1.32';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const RATIO_CONTEXTS = ['dashboard', 'projects', 'finance'];
const RATIO_STYLES = ['ring', 'bar', 'pill', 'gauge', 'blocks', 'badge'];
const DEFAULT_RATIO_LOOK = { style: 'ring', collectionColor: '#a7e8bd', profitColor: '#24965b' };
// ---- ترجمة النصوص الثابتة عند تفعيل الإنجليزية (قاموس js/i18n-en.js) ----
const TR_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
let trBusy = false;
function translateNode(root) {
  if (lang() !== 'en' || !root) return;
  trBusy = true;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const p = n.parentElement;
      if (!p || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(p.tagName) || p.closest('[data-no-tr]')) continue;
      const v = translateText(n.nodeValue);
      if (v !== n.nodeValue) n.nodeValue = v;
    }
    const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [];
    for (const el of els) for (const a of TR_ATTRS) {
      const v = el.getAttribute?.(a);
      if (v && /[\u0600-\u06FF]/.test(v)) { const nv = translateText(v); if (nv !== v) el.setAttribute(a, nv); }
    }
  } finally { trBusy = false; }
}
function installTranslator() {
  const obs = new MutationObserver((muts) => {
    if (trBusy || lang() !== 'en') return;
    for (const m of muts) {
      if (m.type === 'characterData') translateNode(m.target.parentElement);
      else m.addedNodes.forEach((nd) => translateNode(nd.nodeType === 3 ? nd.parentElement : nd));
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  for (const k of ['alert', 'confirm', 'prompt']) {
    const orig = window[k].bind(window);
    window[k] = (msg, ...rest) => orig(lang() === 'en' ? translateText(String(msg ?? '')) : msg, ...rest);
  }
  translateNode(document.body);
}

const DEFAULT_SETTINGS = { id: 'prefs', lang: 'ar', weekStartDay: 6, accordion: 'single', theme: DEFAULT_THEME, typography: { heading: 112, subheading: 100, item: 92 }, motion: { style: 'apple', speed: 'normal' }, financeTargets: { collection: 100, profit: 25 }, ratioAppearance: { scope: 'global', global: { ...DEFAULT_RATIO_LOOK }, tabs: { dashboard: { ...DEFAULT_RATIO_LOOK }, projects: { ...DEFAULT_RATIO_LOOK }, finance: { ...DEFAULT_RATIO_LOOK } } } };

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
  requirements: [],
  projectPanel: null,
  meetingView: 'calendar',
  meetingWeek: null,
  activeMeetingProjectId: null,
  meetingRecognition: null,
  nativeMeetingRecording: false,
  nativeMeetingDraftId: null,
  nativeMeetingFileName: null,
  autoProcessMeetingAfterSave: false,
  financeView: 'projects',
  showArchivedProjects: false,
  ratioEditorContext: 'dashboard',
  expenseMonth: D.todayISO().slice(0,7),
  syncStatus: { state: 'idle', message: 'جارٍ الاتصال…' },
  authMode: 'signin',
  activeProjectId: null,
  expandedTaskId: null,
  expandedFinanceProjectId: null,
  expandedFinanceSummary: false,
  settings: mergeSettings(null),
  section: 'today',
  prevSection: 'today',
  week: null,
  sel: null,
  openGroups: new Set(['appearance']),
  unsubs: [],
  lastSettingsTouch: 0,
  saveTimer: null,
  sheet: null,
  taskDropPending: null,
  animateNextRender: false,
  navExpanded: localStorage.getItem('wp1:nav-expanded') !== '0',
  navOpenSection: 'today',
};

function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  s.theme = mergeTheme(saved && saved.theme);
  const oldDefaultTheme = saved?.theme?.preset === 'quiet' && saved.theme.accent === '#1a73e8' && !saved.theme.bg?.light && !saved.theme.bg?.dark;
  if (oldDefaultTheme) s.theme = mergeTheme({ ...saved.theme, preset: 'monochrome', accent: DEFAULT_THEME.accent, bg: DEFAULT_THEME.bg, sat: 0 });
  s.typography = { ...DEFAULT_SETTINGS.typography, ...(saved?.typography || {}) };
  for (const key of ['heading','subheading','item']) { const n = Number(s.typography[key]); s.typography[key] = Number.isFinite(n) ? Math.min(130, Math.max(80, Math.round(n))) : DEFAULT_SETTINGS.typography[key]; }
  s.motion = { ...DEFAULT_SETTINGS.motion, ...(saved?.motion || {}) };
  s.financeTargets = { ...DEFAULT_SETTINGS.financeTargets, ...(saved?.financeTargets || {}) };
  for (const key of ['collection', 'profit']) {
    const target = Number(s.financeTargets[key]);
    s.financeTargets[key] = Number.isFinite(target) ? Math.min(100, Math.max(1, Math.round(target))) : DEFAULT_SETTINGS.financeTargets[key];
  }
  const savedRatioAppearance = saved?.ratioAppearance || {};
  const normalizeRatioLook = (look = {}, fallback = DEFAULT_RATIO_LOOK) => {
    const style = RATIO_STYLES.includes(look.style) ? look.style : fallback.style;
    const color = (value, defaultValue) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : defaultValue;
    return { style, collectionColor: color(look.collectionColor, fallback.collectionColor), profitColor: color(look.profitColor, fallback.profitColor) };
  };
  const globalRatioLook = normalizeRatioLook(savedRatioAppearance.global);
  s.ratioAppearance = {
    scope: savedRatioAppearance.scope === 'perTab' ? 'perTab' : 'global',
    global: globalRatioLook,
    tabs: Object.fromEntries(RATIO_CONTEXTS.map((context) => [context, normalizeRatioLook(savedRatioAppearance.tabs?.[context], globalRatioLook)])),
  };
  if (!['apple','smooth','subtle','reduced'].includes(s.motion.style)) s.motion.style = 'apple';
  if (!['slow','normal','fast'].includes(s.motion.speed)) s.motion.speed = 'normal';
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
    // لا ننتظر تحميل Firebase إلى ما لا نهاية: بعد 25 ثانية تظهر رسالة وزر إعادة المحاولة.
    S.store = await Promise.race([createStore(), new Promise((_, rej) => setTimeout(() => rej(new Error('store timeout')), 25000))]);
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
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
    }, { once: true });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {});
  }
}

function onAuth(user) {
  S.unsubs.forEach((u) => u()); S.unsubs = [];
  S.user = user;
  S.tasks = []; S.projects = []; S.deliverables = []; S.financeEntries = []; S.personalExpenses = []; S.personalBudgets = []; S.meetings = []; S.requirements = [];
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
  S.unsubs.push(S.store.watch('tasks', (docs) => { S.tasks = docs.map((d) => normalizeTask(d, true)); if (S.section === 'tasks' || S.section === 'dashboard' || S.section === 'today') render(); }));
  S.unsubs.push(S.store.watch('projects', (docs) => { S.projects = docs; if (S.section === 'projects' || S.section === 'finance' || S.section === 'dashboard' || S.section === 'today') render(); }));
  S.unsubs.push(S.store.watch('deliverables', (docs) => { S.deliverables = docs; if (S.section === 'projects' || S.section === 'dashboard' || S.section === 'today') render(); }));
  S.unsubs.push(S.store.watch('financeEntries', (docs) => { S.financeEntries = docs; if (S.section === 'finance' || S.section === 'projects' || S.section === 'dashboard' || S.section === 'today') render(); }));
  S.unsubs.push(S.store.watch('personalExpenses', (docs) => { S.personalExpenses = docs; if (S.section === 'finance' || S.section === 'dashboard' || S.section === 'today') render(); }));
  S.unsubs.push(S.store.watch('personalBudgets', (docs) => { S.personalBudgets = docs; if (S.section === 'finance') render(); }));
  S.unsubs.push(S.store.watch('meetings', (docs) => { S.meetings = docs; if (S.section === 'meetings' || S.section === 'dashboard' || S.section === 'today') render(); }));
  S.unsubs.push(S.store.watch('requirements', (docs) => { S.requirements = docs; if (S.section === 'projects') render(); }));
  if (S.store.onStatus) S.unsubs.push(S.store.onStatus((status) => { S.syncStatus = status; const el = $('#sync-indicator'); if (el) { el.textContent = status.message || status.state; el.dataset.state = status.state; } }));
  render();
  const q = new URLSearchParams(location.search);
  if (q.get('new') === '1') { history.replaceState(null, '', location.pathname); openSheet(null); }
}

function applySettings(rerender) {
  setLang(S.settings.lang);
  document.documentElement.dataset.density = 'compact';
  S.settings.theme = applyTheme(S.settings.theme);
  applyMotionSettings();
  applyTypographySettings();
  document.title = t('app');
  cacheSettings();
  if (rerender && S.user) render();
}

function applyMotionSettings() {
  const root = document.documentElement;
  const motion = S.settings.motion || DEFAULT_SETTINGS.motion;
  root.dataset.motion = motion.style;
  root.dataset.motionSpeed = motion.speed;
  root.style.setProperty('--motion-duration', motion.speed === 'slow' ? '420ms' : motion.speed === 'fast' ? '160ms' : '260ms');
}

function applyTypographySettings() {
  const typography = S.settings.typography || DEFAULT_SETTINGS.typography;
  const root = document.documentElement;
  root.style.setProperty('--type-heading-scale', String(typography.heading / 100));
  root.style.setProperty('--type-subheading-scale', String(typography.subheading / 100));
  root.style.setProperty('--type-item-scale', String(typography.item / 100));
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
  const animate = S.animateNextRender;
  const paint = () => { S.animateNextRender = animate; $('#app').innerHTML = shell(); window.scrollTo(0, y); refreshProjectPanel(); };
  if (animate && document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const transition = document.startViewTransition(paint);
    transition.finished.then(() => window.scrollTo(0, 0));
  }
  else paint();
}

function navList() {
  return [['today', 'nav_today'], ['tasks', 'nav_tasks'], ['projects', 'nav_projects'], ['finance', 'nav_finance'], ['meetings', 'nav_meetings'], ['dashboard', 'nav_dashboard']];
}

function navPreview(id) {
 const today=D.todayISO(), item=(label,meta='',action='nav',section=id,extra='')=>`<button class="nav-preview-item" data-action="${action}" data-section="${section}" ${extra}><span>${esc(label)}</span>${meta?`<small>${esc(meta)}</small>`:''}</button>`;
 if(id==='today')return item('النهارده','المستحق والمتأخر والمهام');
 if(id==='dashboard')return item('ملخص اليوم','لوحة المتابعة');
 if(id==='tasks'){const rows=S.tasks.filter(x=>x.status!=='done'&&x.date===today).sort((a,b)=>b.priority-a.priority).slice(0,4);return rows.length?rows.map(x=>item(x.title,x.status==='doing'?'قيد التنفيذ':'اليوم')).join(''):item('لا توجد مهام لليوم','عرض كل المهام');}
 if(id==='projects'){const rows=[...S.projects].filter(p=>p.status!=='completed').sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))).slice(0,4);return rows.length?rows.map(p=>item(p.name,projectStatusLabel(p.status),'open-project',id,`data-id="${esc(p.id)}"`)).join(''):item('لا توجد مشروعات نشطة','عرض المشروعات');}
 if(id==='finance'){const rows=[...S.financeEntries].filter(x=>x.kind==='income').sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,3);return rows.length?rows.map(x=>item(S.projects.find(p=>p.id===x.projectId)?.name||'تحصيل مسجل',`تحصيل · ${x.date||'—'} · •••• ج.م`)).join(''):item('لا توجد تحصيلات مسجلة','افتح سجل الماليات');}
 if(id==='meetings'){const rows=[...S.meetings].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,4);return rows.length?rows.map(m=>item(m.title||'Meeting',`${m.date||'—'} · ${S.projects.find(p=>p.id===m.projectId)?.name||'اجتماع'}`)).join(''):item(t('metric_no_meetings'),'افتح سجل الاجتماعات');}
 return '';
}

function shell() {
  const sec = S.section;
  const rtl = dir() === 'rtl';
  const nav = navList();
  const title = sec === 'settings' ? t('settings') : sec === 'tasks' ? t('tasks_title') : t('nav_' + sec);
  const content = sec === 'today' ? renderToday() : sec === 'dashboard' ? renderDashboard() : sec === 'tasks' ? renderTasks() : sec === 'settings' ? renderSettings() : sec === 'projects' ? renderProjects() : sec === 'finance' ? renderFinance() : sec === 'meetings' ? renderMeetings() : renderTasks();
  const animatePage = S.animateNextRender;
  S.animateNextRender = false;
  return `
  <div class="shell">
    <nav class="rail glass ${S.navExpanded?'expanded':'collapsed'}" aria-label="main">
      <div class="rail-top"><img class="rail-logo" src="icons/logo.svg" alt="WeeklyPlanner" width="40" height="40"><button class="rail-toggle" data-action="nav-collapse" aria-label="${S.navExpanded?'تصغير القائمة':'توسيع القائمة'}" title="${S.navExpanded?'تصغير القائمة':'توسيع القائمة'}">${icon(S.navExpanded?'chevL':'chevR',20)}</button></div>
      ${nav.map(([id,key])=>`
        <div class="nav-entry ${S.navOpenSection===id&&S.navExpanded?'preview-open':''}">
          <div class="nav-entry-head"><button class="nav-item ${sec===id?'on':''}" data-action="nav" data-section="${id}">${badge(id,21,undefined,sec===id)}<span>${t(key)}</span></button><button class="nav-expand" data-action="nav-expand" data-section="${id}" aria-label="عرض ${t(key)}" title="عرض مختصر">${icon('chevD',16)}</button></div>
          ${S.navExpanded&&S.navOpenSection===id?`<div class="nav-preview">${navPreview(id)}</div>`:''}
        </div>`).join('')}
    </nav>
    <main class="main ${animatePage ? 'page-transition' : ''} ${S.activeProjectId ? 'project-open' : ''}">
      <header class="topbar">
        <div class="tb-start">
          ${sec === 'settings' ? `<button class="btn icon-btn" data-action="back" aria-label="${t('cancel')}">${icon(rtl ? 'chevR' : 'chevL', 20)}</button>` : ''}
          <h1>${esc(title)}</h1>
        </div>
        <span id="sync-indicator" class="sync-indicator" data-state="${esc(S.syncStatus.state)}">${esc(S.syncStatus.message)}</span>
        ${sec !== 'settings' ? `<button class="btn icon-btn more-btn" data-action="open-more" aria-label="${L('المزيد', 'More')}">${icon('more', 20)}</button><button class="btn icon-btn" data-action="open-settings" aria-label="${t('settings')}">${badge('settings', 20)}</button>` : ''}
      </header>
      ${content}
    </main>
    <nav class="tabbar glass" aria-label="main">
      ${nav.filter(([id]) => ['today', 'projects', 'finance'].includes(id)).map(([id, key]) => `
        <button class="tab ${sec === id ? 'on' : ''}" data-action="nav" data-section="${id}">
          ${badge(id, 21, undefined, sec === id)}<span>${t(key)}</span>
        </button>`).join('')}
    </nav>
    ${sec === 'tasks' ? `<button class="fab" data-action="add" aria-label="${t('new_task')}">${icon('plus', 26)}<span>${t('new_task')}</span></button>` : sec === 'projects' ? (S.activeProjectId ? `<button class="fab" data-action="scroll-deliverable-form" aria-label="${t('add_deliverable')}">${icon('plus', 26)}<span>${t('add_deliverable')}</span></button>` : `<button class="fab" data-action="new-project" aria-label="${t('new_project')}">${icon('plus', 26)}<span>${t('new_project')}</span></button>`) : ''}
    <button class="voice-fab" data-action="capture-open" aria-label="${L('تسجيل سريع', 'Quick capture')}">${icon('mic', 24)}<span>${L('تسجيل سريع', 'Quick capture')}</span></button>
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
    const linkedProject = S.projects.find((p) => p.id === x.projectId);
    if (linkedProject) chips.push(`<span class="chip">${badge('projects',13)}${esc(linkedProject.name)}</span>`);
    if (x.priority === 3) chips.push(`<span class="chip p3">${icon('flag', 13)}${t('p_high')}</span>`);
    if (x.priority === 1) chips.push(`<span class="chip p1">${icon('flag', 13)}${t('p_low')}</span>`);
    if (x.status === 'doing') chips.push(`<span class="chip doing">${icon('play', 13)}${t('in_progress')}</span>`);
    if (lateNow) chips.push(`<span class="chip late">${icon('clock', 13)}${t('late')}</span>`);
    if (ctx.showDate && x.date) chips.push(`<span class="chip">${icon('calendar', 13)}${esc(D.fmt(x.date, loc, { day: 'numeric', month: 'short' }))}</span>`);
    const mark = x.status === 'done' ? icon('check', 16) : x.status === 'doing' ? icon('play', 14) : '';
    return `
    <div class="task ${isDone(x) ? 'done' : ''} ${x.status === 'doing' ? 'doing' : ''}" data-id="${esc(x.id)}">
      <button class="chk" data-action="toggle" data-id="${esc(x.id)}" aria-label="toggle" aria-pressed="${isDone(x)}"><span class="ring-c">${mark}</span></button>
    <div class="tbody ${S.expandedTaskId === x.id ? 'is-expanded' : ''}" data-action="toggle-task-details" data-id="${esc(x.id)}" tabindex="0" role="button" aria-expanded="${S.expandedTaskId === x.id}">
        <div class="ttl">${esc(x.title)}</div>
        <div class="task-detail"><div>${x.notes ? `<div class="tnote">${esc(x.notes)}</div>` : ''}${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}<button class="btn sm" data-action="edit" data-id="${esc(x.id)}">${t('edit')}</button></div></div>
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

// ================================================================== شاشة النهارده + الالتقاط
const tdMoney = (n) => Number(n || 0).toLocaleString(locale(), { maximumFractionDigits: 0 });

function renderToday() {
  const today = D.todayISO();
  const d = buildToday({ projects: S.projects, deliverables: S.deliverables, tasks: S.tasks, meetings: S.meetings, today });
  const dateLabel = D.fmt(today, locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const daysText = (n, kind) => n <= 0 ? (kind === 'late' ? L('مستحق اليوم', 'Due today') : L('اتبعت النهارده', 'Sent today')) : (kind === 'late' ? L(`متأخر ${n} يوم`, `${n} day(s) late`) : L(`من ${n} يوم`, `${n} day(s) ago`));
  const lateRows = d.late.map((x) => `<div class="td-row"><span class="td-dot late"></span><button class="td-main" data-action="open-project" data-id="${esc(x.projectId)}"><strong>${esc(x.title || L('دفعة', 'Installment'))} · ${esc(x.projectName)}</strong><small>${esc(daysText(x.days, 'late'))} · ${tdMoney(x.amount)} ${L('ج.م', 'EGP')}</small></button><button class="td-act" data-action="td-remind" data-kind="pay" data-project="${esc(x.projectId)}" data-id="${esc(x.installmentId)}">${L('ذكّره', 'Remind')}</button></div>`).join('');
  const waitRows = d.waiting.map((x) => `<div class="td-row"><span class="td-dot wait"></span><button class="td-main" data-action="open-project" data-id="${esc(x.projectId)}"><strong>${esc(x.name)} <span class="td-v">V${x.rev}</span></strong><small>${esc(x.projectName)} · ${esc(daysText(x.days, 'wait'))}</small></button><button class="td-act" data-action="td-remind" data-kind="wait" data-id="${esc(x.id)}">${L('ذكّره', 'Remind')}</button></div>`).join('');
  const taskRows = d.todayTasks.map((x) => `<div class="td-row"><button class="td-check" data-action="toggle" data-id="${esc(x.id)}" aria-label="${L('تم', 'Done')}"></button><div class="td-main plain"><strong>${esc(x.title)}</strong>${x.notes && x.id.startsWith('cap_') ? `<small>${esc(x.notes.split('\n').filter(Boolean).length)} ${L('إجراءات اتسجلت · راجعها وعلّم', 'actions recorded · review and tick')}</small>` : ''}</div></div>`).join('');
  const meetRows = d.todayMeetings.map((m) => `<div class="td-row"><span class="td-dot"></span><button class="td-main" data-action="nav" data-section="meetings"><strong>${esc(m.title || L('اجتماع', 'Meeting'))}</strong><small>${esc(S.projects.find((p) => p.id === m.projectId)?.name || '')}</small></button></div>`).join('');
  const section = (title, rows) => rows ? `<h2 class="td-label">${title}</h2>${rows}` : '';
  const empty = !lateRows && !waitRows && !taskRows && !meetRows;
  return `<section class="today" aria-label="${L('النهارده', 'Today')}">
    <div class="td-summary">
      <div><small>${L('مستحق لي', 'Due to me')}</small><div class="td-big">${tdMoney(d.dueTotal)} <span>${L('ج.م', 'EGP')}</span></div></div>
      <div class="td-stats"><div><b class="${d.counts.late ? 'late' : ''}">${d.counts.late}</b><small>${L('متأخر', 'late')}</small></div><div><b>${d.counts.tasks}</b><small>${L('مهام', 'tasks')}</small></div></div>
    </div>
    <p class="td-date">${esc(dateLabel)}${d.lateTasks.length ? ` · <button class="td-link" data-action="nav" data-section="tasks">${L(`${d.lateTasks.length} مهام متأخرة`, `${d.lateTasks.length} overdue tasks`)}</button>` : ''} · <button class="td-link plain" data-action="mgr-open">${L('المدير الذكي', 'AI manager')}</button></p>
    ${section(L('عاجل', 'Urgent'), lateRows)}
    ${section(L('مستني ردّ', 'Waiting for reply'), waitRows)}
    ${section(L('مهام اليوم', "Today's tasks"), taskRows + meetRows)}
    ${empty ? `<p class="td-empty">${L('مفيش حاجة مستعجلة النهارده. اضغط الميكروفون لتسجيل أي جديد.', 'Nothing urgent today. Tap the mic to record anything new.')}</p>` : ''}
  </section>`;
}

function remindText(kind, id, projectId) {
  if (kind === 'pay') {
    const p = S.projects.find((x) => x.id === projectId); const i = (p?.installments || []).find((x) => x.id === id); if (!p || !i) return '';
    return L(`أهلًا ${p.client || ''}، بخصوص ${i.title || 'الدفعة'} الخاصة بمشروع «${p.name}» بقيمة ${tdMoney(i.amount)} ج.م والمستحقة بتاريخ ${i.dueDate || ''}. ممكن تأكيد موعد التحويل؟ شكرًا لحضرتك.`, `Hello ${p.client || ''}, regarding ${i.title || 'the installment'} for "${p.name}" (${tdMoney(i.amount)} EGP, due ${i.dueDate || ''}). Could you confirm the transfer date? Thank you.`);
  }
  const dv = S.deliverables.find((x) => x.id === id); const p = S.projects.find((x) => x.id === dv?.projectId); if (!dv || !p) return '';
  return L(`أهلًا ${p.client || ''}، بخصوص «${dv.name}» (V${Number(dv.rev) || 1}) الخاصة بمشروع «${p.name}» اللي اتبعتت لحضرتك. ممكن ملاحظاتك أو الاعتماد؟ شكرًا.`, `Hello ${p.client || ''}, regarding "${dv.name}" (V${Number(dv.rev) || 1}) for "${p.name}" that I sent you. Could you share your feedback or approval? Thank you.`);
}

function openMoreSheet() {
  const row = (section, label) => `<button class="more-row" data-action="more-go" data-section="${section}">${esc(label)}${icon(dir() === 'rtl' ? 'chevL' : 'chevR', 16)}</button>`;
  $('#layer').innerHTML = `<div class="overlay" data-action="overlay"><section class="sheet more-sheet glass" role="dialog" aria-modal="true"><div class="sheet-head"><h2>${L('المزيد', 'More')}</h2><button class="btn icon-btn" data-action="close-voice" aria-label="${t('cancel')}">×</button></div>${row('tasks', t('nav_tasks'))}${row('meetings', t('nav_meetings'))}${row('dashboard', t('nav_dashboard'))}${row('settings', t('settings'))}</section></div>`;
}

function captureProjectOptions(selected) {
  return S.projects.filter((p) => !p.archivedAt).map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

function openCaptureSheet(projectId, keepText = '') {
  const pid = projectId || S.capture?.projectId || S.activeProjectId || S.projects.find((p) => p.status === 'active' && !p.archivedAt)?.id || S.projects[0]?.id || '';
  S.capture = { projectId: pid, text: keepText, actions: [] };
  $('#layer').innerHTML = `<div class="overlay" data-action="overlay"><section class="sheet capture-sheet glass" role="dialog" aria-modal="true" aria-label="${L('تسجيل سريع', 'Quick capture')}">
    <div class="cap-handle"></div>
    <div class="cap-hero"><button class="cap-mic" data-action="voice-start" aria-label="${L('ابدأ التسجيل', 'Start recording')}">${icon('mic', 34)}</button><strong>${L('اضغط وتكلّم', 'Tap and speak')}</strong><small id="voice-status" class="muted" aria-live="polite">${L('قول اللي حصل بالعامية، والتطبيق يوزّعه على المشروع.', 'Say what happened; the app routes it into the project.')}</small></div>
    <label class="lab" for="voice-text">${L('أو اكتب / الصق رسالة', 'Or type / paste a message')}</label>
    <textarea class="input textarea" id="voice-text" rows="3">${esc(keepText)}</textarea>
    <div class="cap-row"><label class="lab" for="cap-project">${L('المشروع', 'Project')}</label><select class="input compact" id="cap-project">${captureProjectOptions(pid)}</select></div>
    <button class="more-row" data-action="cap-wa">${L('من واتساب (ملف المحادثة)', 'From WhatsApp (chat file)')}${icon(dir() === 'rtl' ? 'chevL' : 'chevR', 16)}</button>
    <div class="sheet-actions"><button class="btn" data-action="close-voice">${t('cancel')}</button><button class="btn primary" data-action="capture-analyze">${L('حلّل الرسالة', 'Analyze message')}</button></div>
  </section></div>`;
}

function captureActionHtml(a, project) {
  const kindLabel = L(...ACTION_KIND[a.kind]);
  const dv = a.deliverableId ? S.deliverables.find((x) => x.id === a.deliverableId) : null;
  let main = esc(a.name || ''), meta = '';
  if (a.kind === 'revision') {
    if (dv) { const st = revisionState(project, { rev: (Number(dv.rev) || 1) + 1 }); meta = `${L('التسليمات', 'Deliverables')} · ${L('تصبح', 'becomes')} V${st.rev} · ${L(`تعديل ${st.requested} من ${st.included}`, `revision ${st.requested} of ${st.included}`)}${st.over ? ` · <b class="over">${L('زائد عن المشمول', 'beyond included')}</b>` : ''}`; }
    else meta = L('التسليمات · هيتضاف تسليم جديد بحالة «مطلوب تعديل»', 'Deliverables · a new deliverable will be added as “revision requested”');
  } else if (a.kind === 'approve') meta = L('التسليمات · معتمد من العميل', 'Deliverables · approved by client');
  else if (a.kind === 'new') meta = L('التسليمات · الحالة: لم تبدأ', 'Deliverables · status: not started');
  else if (a.kind === 'payment') {
    const pend = (project?.installments || []).filter((i) => i.status !== 'paid');
    main = `<input class="input compact cap-amt" type="number" min="0" step="1" data-id="${a.id}" value="${a.amount || ''}" placeholder="${L('المبلغ', 'Amount')}" aria-label="${L('المبلغ', 'Amount')}"> ${L('ج.م', 'EGP')}`;
    meta = `<select class="input compact cap-inst" data-id="${a.id}" aria-label="${L('القسط', 'Installment')}"><option value="">${L('بدون قسط (دخل عام)', 'No installment (general income)')}</option>${pend.map((i) => `<option value="${esc(i.id)}" ${i.id === a.installmentId ? 'selected' : ''}>${esc(i.title || L('دفعة', 'Installment'))} · ${tdMoney(i.amount)}</option>`).join('')}</select><small class="warn">${L('الماليات · لازم تأكيدك قبل الحفظ', 'Finance · needs your confirmation')}</small>`;
  }
  return `<li class="cap-act ${a.on ? 'on' : 'off'}"><div class="cap-act-body"><span class="cap-kind k-${a.kind}">${esc(kindLabel)}</span><div class="cap-act-main">${main}</div><small>${meta}</small><q class="cap-src">${esc(a.text)}</q></div>
    <button class="cap-btn" data-action="capture-toggle" data-id="${a.id}" data-on="0" aria-label="${L('رفض', 'Reject')}" aria-pressed="${!a.on}">${icon('close', 20)}</button>
    <button class="cap-btn ok" data-action="capture-toggle" data-id="${a.id}" data-on="1" aria-label="${L('قبول', 'Accept')}" aria-pressed="${a.on}">${icon('check', 22)}</button></li>`;
}

function renderCaptureReview() {
  const c = S.capture; if (!c) return;
  const project = S.projects.find((p) => p.id === c.projectId);
  const n = c.actions.filter((a) => a.on).length;
  $('#layer').innerHTML = `<div class="overlay" data-action="overlay"><section class="sheet capture-sheet glass" role="dialog" aria-modal="true">
    <div class="sheet-head"><button class="btn icon-btn" data-action="capture-back" aria-label="${L('رجوع', 'Back')}">${icon(dir() === 'rtl' ? 'chevR' : 'chevL', 20)}</button><h2>${L('مراجعة الرسالة', 'Review message')}</h2><button class="btn icon-btn" data-action="close-voice" aria-label="${t('cancel')}">×</button></div>
    <p class="muted small">${esc(project?.name || '')}</p>
    <p class="cap-text">«${esc(c.text)}»</p>
    ${c.actions.length ? `<p class="td-label">${L(`${c.actions.length} إجراءات مقترحة`, `${c.actions.length} suggested actions`)}</p><ul class="cap-list">${c.actions.map((a) => captureActionHtml(a, project)).join('')}</ul>
    <div class="sheet-actions"><button class="btn primary wide" data-action="capture-save" ${n ? '' : 'disabled'}>${L(`احفظ ${n} إجراءات`, `Save ${n} action(s)`)}</button></div>
    <p class="muted small cap-foot">${L('هيتضاف سطر «ملخص الالتقاط» في مهام النهارده وانت اللي تعلّم عليه.', 'A “capture summary” line is added to today’s tasks for you to tick.')}</p>`
    : `<p class="muted">${L('ما لقيتش إجراءات واضحة في الرسالة (تعديل، دفعة، لوحة مطلوبة، اعتماد). تقدر تعدّل النص أو تحفظها كمهمة.', 'No clear actions found (revision, payment, requested drawing, approval). Edit the text or save it as a task.')}</p><div class="sheet-actions"><button class="btn" data-action="capture-back">${L('عدّل النص', 'Edit text')}</button><button class="btn primary" data-action="capture-as-task">${L('احفظها كمهمة', 'Save as task')}</button></div>`}
  </section></div>`;
}

function syncCaptureInputs() {
  if (!S.capture) return;
  for (const a of S.capture.actions) {
    const amt = document.querySelector(`.cap-amt[data-id="${a.id}"]`); if (amt) a.amount = Number(amt.value) || 0;
    const inst = document.querySelector(`.cap-inst[data-id="${a.id}"]`); if (inst) a.installmentId = inst.value || null;
  }
}

async function applyCaptureAction(a, project) {
  const now = Date.now(), today = D.todayISO();
  if (a.kind === 'payment') {
    const amount = Number(a.amount) || 0; if (amount <= 0) throw new Error(L('مبلغ الدفعة غير واضح.', 'Payment amount is unclear.'));
    const fresh = S.projects.find((p) => p.id === project.id) || project;
    const inst = (fresh.installments || []).find((i) => i.id === a.installmentId && i.status !== 'paid');
    const linked = inst && Number(inst.amount) === amount;
    const entry = { id: linked ? `installment_${inst.id}` : uid(), projectId: fresh.id, kind: 'income', amount, date: today, category: 'دفعة تعاقد', description: linked ? `تحصيل دفعة: ${inst.title || 'دفعة'}` : `دفعة مستلمة${inst ? ` (جزء من: ${inst.title || 'دفعة'})` : ''} — من الالتقاط`, createdAt: now };
    if (linked) entry.installmentId = inst.id;
    await S.store.save('financeEntries', entry);
    if (linked) {
      const updated = { ...fresh, installments: fresh.installments.map((x) => x.id === inst.id ? { ...x, status: 'paid', paidAt: today } : x), updatedAt: now };
      try { await S.store.save('projects', updated); } catch (err) { await S.store.remove('financeEntries', entry.id).catch(() => {}); throw err; }
      S.projects = S.projects.map((p) => p.id === updated.id ? updated : p);
    }
    return L(`دفعة ${tdMoney(amount)} ج.م`, `Payment ${tdMoney(amount)} EGP`);
  }
  const dv = a.deliverableId ? S.deliverables.find((x) => x.id === a.deliverableId) : null;
  if (a.kind === 'approve' && dv) { await S.store.save('deliverables', { ...dv, status: 'approved', updatedAt: now }); return L(`اعتماد «${dv.name}»`, `Approved “${dv.name}”`); }
  if (a.kind === 'revision') {
    if (dv) {
      const rev = (Number(dv.rev) || 1) + 1;
      await S.store.save('deliverables', { ...dv, status: 'revision', rev, notes: `${dv.notes ? dv.notes + ' · ' : ''}${L('تعديل', 'Revision')}: ${a.text}`.slice(0, 1000), updatedAt: now });
      return L(`تعديل على «${dv.name}» (V${rev})`, `Revision on “${dv.name}” (V${rev})`);
    }
    await S.store.save('deliverables', { id: uid(), projectId: project.id, name: String(a.name || a.text).slice(0, 120), stage: 'technical', kind: 'other', dueDate: null, status: 'revision', rev: 1, notes: a.text.slice(0, 1000), createdAt: now, updatedAt: now, source: 'capture' });
    return L(`تعديل: ${a.name}`, `Revision: ${a.name}`);
  }
  if (a.kind === 'new' || a.kind === 'approve') {
    await S.store.save('deliverables', { id: uid(), projectId: project.id, name: String(a.name || a.text).slice(0, 120), stage: 'technical', kind: 'other', dueDate: null, status: a.kind === 'approve' ? 'approved' : 'pending', rev: 1, notes: a.text.slice(0, 1000), createdAt: now, updatedAt: now, source: 'capture' });
    return L(`لوحة «${a.name}» — لم تبدأ`, `Drawing “${a.name}” — not started`);
  }
  return '';
}

async function saveCaptureSummaryTask(project, lines) {
  if (!lines.length) return;
  const today = D.todayISO(), id = `cap_${today}`;
  const old = S.tasks.find((x) => x.id === id);
  const all = [...(old?.notes ? old.notes.split('\n').filter(Boolean) : []), ...lines.map((l) => `• ${project.name}: ${l}`)];
  const task = normalizeTask({ id, title: L(`ملخص الالتقاط · ${all.length} إجراءات`, `Capture summary · ${all.length} actions`), notes: all.join('\n'), date: today, weekRef: today, priority: 2, status: 'todo', createdAt: old?.createdAt || Date.now(), updatedAt: Date.now() });
  await S.store.save('tasks', task);
}

function vBadgeHtml(project, d) {
  const st = revisionState(project, d);
  return `<span class="v-badge ${st.over ? 'over' : ''}" title="${esc(L(`تعديلات مطلوبة ${st.requested} من ${st.included} مشمولة`, `${st.requested} of ${st.included} included revisions used`))}">V${st.rev}</span>`;
}
function vActionsHtml(project, d) {
  const st = revisionState(project, d);
  return `<span class="v-actions">${st.over ? `<small class="over">${L(`تعديل زائد: ${st.requested} من ${st.included}`, `Extra revision: ${st.requested} of ${st.included}`)}</small> <button class="text-action" data-action="doc-open" data-id="${esc(project.id)}" type="button">${L('عرض سعر', 'Quote')}</button> ` : ''}<button class="text-action" data-action="deliverable-rev" data-id="${esc(d.id)}" type="button">${L('نسخة جديدة', 'New version')}</button></span>`;
}

function renderDashboard() {
  const today = D.todayISO();
  const currentMonth = today.slice(0,7);
  const personalMonthEntries = S.personalExpenses.filter((x) => (x.date || '').slice(0,7) === currentMonth);
  const personalIncome = personalMonthEntries.filter((x) => x.kind === 'income').reduce((n,x) => n + Math.max(0,Number(x.amount)||0),0);
  const personalExpense = personalMonthEntries.filter((x) => x.kind !== 'income').reduce((n,x) => n + Math.max(0,Number(x.amount)||0),0);
  const personalNet = personalIncome - personalExpense;
  const activeProjects = S.projects.filter((p) => p.status === 'active' && !p.archivedAt)
    .sort((a,b) => String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  const openTasks = S.tasks.filter((x) => x.status !== 'done');
  const lateTasks = openTasks.filter((x) => x.date && x.date < today)
    .sort((a,b) => a.date.localeCompare(b.date) || b.priority-a.priority);
  const todayTasks = openTasks.filter((x) => x.date === today)
    .sort((a,b) => b.priority-a.priority);
  const upcomingTasks = openTasks.filter((x) => x.date && x.date > today)
    .sort((a,b) => a.date.localeCompare(b.date) || b.priority-a.priority);
  const dueFollowUps = S.projects.filter((p) => !p.archivedAt && p.followUpDate && p.followUpDate <= D.addDays(today, 14))
    .sort((a,b) => a.followUpDate.localeCompare(b.followUpDate));
  const dashboardWeek = D.weekStartOf(today, startDay());
  const weekTasks = S.tasks.filter((x) => weekOfTask(x) === dashboardWeek);
  const completedWeekTasks = weekTasks.filter((x) => x.status === 'done').length;
  const taskProgress = weekTasks.length ? Math.round(completedWeekTasks / weekTasks.length * 100) : null;
  const activeProjectProgress = activeProjects.map((p) => projectProgressData(p)).filter((p) => p.percent !== null);
  const projectProgress = activeProjectProgress.length ? Math.round(activeProjectProgress.reduce((sum, p) => sum + p.percent, 0) / activeProjectProgress.length) : null;
  const projectIds = new Set(S.projects.map((p) => p.id));
  const dashboardEntries = S.financeEntries.filter((x) => projectIds.has(x.projectId));
  const dashboardIncome = dashboardEntries.filter((x) => x.kind === 'income').reduce((n, x) => n + Math.max(0, Number(x.amount) || 0), 0);
  const dashboardExpense = dashboardEntries.filter((x) => x.kind === 'expense').reduce((n, x) => n + Math.max(0, Number(x.amount) || 0), 0);
  const dashboardContracts = S.projects.reduce((n, p) => n + Math.max(0, Number(p.contractValue) || 0), 0);
  const collectionProgress = dashboardContracts ? Math.round(dashboardIncome / dashboardContracts * 100) : null;
  const profitProgress = dashboardIncome ? Math.round((dashboardIncome - dashboardExpense) / dashboardIncome * 100) : null;
  const meetingsWithMinutes = S.meetings.filter((meeting) => String(meeting.minutes || '').trim()).length;
  const meetingProgress = S.meetings.length ? Math.round(meetingsWithMinutes / S.meetings.length * 100) : null;
  const dashboardTaskRow = (x) => {
    const detail = x.date ? D.fmt(x.date, locale(), { day: 'numeric', month: 'short' }) : t('no_date');
    const projectName = S.projects.find((p) => p.id === x.projectId)?.name;
    return `
      <div class="dashboard-row dashboard-task-row">
        <span class="dashboard-dot ${x.date && x.date < today ? 'late' : x.priority === 3 ? 'high' : ''}"></span>
        <div><b>${esc(x.title)}</b><small>${esc(detail)} · ${x.priority===3?t('p_high'):x.status==='doing'?t('in_progress'):t('s_todo')}${projectName?` · ${esc(projectName)}`:''}</small></div>
        <button class="btn sm dashboard-done" data-action="dashboard-task-done" data-id="${esc(x.id)}" aria-label="${lang()==='ar'?'تم إنجاز المهمة':'Mark task done'}">Done</button>
      </div>`;
  };
  const taskGroup = (title, items, emptyText, kind) => `
    <details class="card glass dashboard-task-group ${kind}">
      <summary class="dashboard-task-summary"><h3>${title}</h3><span class="chip ${kind==='overdue'?'late':''}">${items.length}</span></summary>
      <div class="dashboard-task-group-content">
      ${items.length ? items.slice(0,4).map(dashboardTaskRow).join('') : `<p class="muted small dashboard-empty">${emptyText}</p>`}
      ${items.length > 4 ? `<button class="btn sm dashboard-view-all" data-action="nav" data-section="tasks">${t('all_tasks')}</button>` : ''}
      </div>
    </details>`;
  return `
    <div class="dashboard-intro">
      <div><h2>${t('dashboard_title')}</h2><p class="muted">${esc(D.fmt(today,locale(),{weekday:'long',day:'numeric',month:'long'}))}</p></div>
      <div class="dashboard-intro-actions"><button class="btn" data-action="mgr-open">${icon('sparkles', 17)} ${L('المدير الذكي', 'AI Manager')}</button><button class="btn primary" data-action="nav" data-section="tasks">${icon('plus',17)} ${t('add_task_day')}</button></div>
    </div>

    <div class="dashboard-metrics-grid">
      ${dashboardMetricCard(t('metric_tasks'), taskProgress, weekTasks.length ? t('done_of', { done: completedWeekTasks, total: weekTasks.length }) : t('no_tasks_week'), 'tasks', 'collection', 'dashboard')}
      ${dashboardMetricCard(t('metric_projects'), projectProgress, activeProjectProgress.length ? t('metric_project_detail', { count: activeProjectProgress.length }) : t('dashboard_no_active_projects'), 'projects', 'collection', 'dashboard')}
      ${dashboardMetricCard(t('metric_collection'), collectionProgress, dashboardIncome ? t('metric_collection_detail') : t('metric_no_collections'), 'finance', 'collection', 'dashboard', { value: profitProgress, label: t('metric_profit'), metric: 'profit' })}
      ${dashboardMetricCard(t('metric_meetings'), meetingProgress, S.meetings.length ? t('metric_meetings_detail', { done: meetingsWithMinutes, total: S.meetings.length }) : t('metric_no_meetings'), 'meetings', 'collection', 'dashboard')}
    </div>

    <section class="card glass dashboard-personal-cashflow">
      <div class="dhead"><div><h2>حركتك الشخصية هذا الشهر</h2><p class="muted small">دخل ومصروفاتك الشخصية · ${esc(currentMonth)}</p></div><button class="btn sm" data-action="nav" data-section="finance">إدارة الماليات</button></div>
      <div class="dashboard-cashflow-values"><div><small>الدخل الشخصي</small><strong class="positive">${money(personalIncome)} ج.م</strong></div><div><small>المصروف الشخصي</small><strong class="negative">${money(personalExpense)} ج.م</strong></div><div><small>الصافي</small><strong class="${personalNet<0?'negative':'positive'}">${personalNet<0?'−':''}${money(Math.abs(personalNet))} ج.م</strong></div></div>
    </section>

    <div class="dashboard-my-tasks-heading"><div><h2>${t('dashboard_my_tasks')}</h2><p class="muted small">${t('dashboard_tasks_hint')}</p></div><button class="btn sm" data-action="nav" data-section="tasks">${t('all_tasks')}</button></div>
    <div class="dashboard-task-groups">
      ${taskGroup(t('late_tasks'),lateTasks,t('dashboard_no_late_tasks'),'overdue')}
      ${taskGroup(t('today_tasks'),todayTasks,t('dashboard_no_today_tasks'),'today')}
      ${taskGroup(t('upcoming_tasks'),upcomingTasks,t('dashboard_no_upcoming_tasks'),'upcoming')}
    </div>

    ${dueFollowUps.length ? `<section class="card glass dashboard-followups"><div class="dhead"><div><h2>متابعات العملاء</h2><p class="muted small">المواعيد المتأخرة والقريبة خلال أسبوعين</p></div><span class="chip">${dueFollowUps.length}</span></div><div class="followup-list">${dueFollowUps.slice(0,4).map(p=>`<button class="followup-row" data-action="open-project" data-id="${esc(p.id)}"><span><b>${esc(p.name)}</b><small>${esc(p.client||'عميل')} · ${esc(p.followUpNote||'متابعة')}</small></span><span class="followup-date ${p.followUpDate<today?'late':''}">${esc(p.followUpDate<today?'متأخرة · ':'')}${esc(p.followUpDate)}</span></button>`).join('')}</div></section>` : ''}

    <section class="card glass dashboard-panel dashboard-projects-panel">
      <div class="dhead dashboard-section-heading">
        <div><h2>${t('dashboard_my_projects')}</h2><p class="muted small">${t('dashboard_projects_hint')}</p></div>
        <button class="btn sm" data-action="nav" data-section="projects">${t('all_projects')}</button>
      </div>
      ${activeProjects.length ? `<div class="dashboard-project-grid">${activeProjects.slice(0,3).map(p => `
        <article class="dashboard-project-card">
          <button class="dashboard-project-open" data-action="open-project" data-id="${esc(p.id)}">
            <span><span class="dashboard-project-heading"><b>${esc(p.name)}</b></span><small>${esc(p.client||projectTypeLabel(p.type))}</small></span>
            <span class="chip">${projectStatusLabel(p.status)}</span>
          </button>
          ${renderProjectProgress(p, S.deliverables, 'dashboard')}
        </article>`).join('')}</div>` : `<p class="muted small dashboard-empty">${t('dashboard_no_active_projects')}</p>`}
    </section>`;
}

function money(value) { return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(Number(value) || 0); }
function projectTypeLabel(v) { return ({ residential: t('type_residential'), administrative: t('type_administrative'), commercial: t('type_commercial'), fitout: t('type_fitout') })[v] || v || '—'; }
function projectStatusLabel(v) { return ({ planning: t('status_planning'), active: t('status_active'), on_hold: t('status_on_hold'), completed: t('status_completed') })[v] || v || '—'; }
function projectScopeLabel(scope) { const labels={design:'Design','3d':'3D','technical_drawings':'Technical Drawings',execution:'Execution'}; return (Array.isArray(scope)?scope:[]).map(x=>labels[x]||x).join(' + '); }
function projectProgressData(project, deliverables = S.deliverables) {
  const rows = deliverables.filter((d) => d.projectId === project.id);
  const selectedScopes = Array.isArray(project.workScope) ? project.workScope : [];
  const explicitScopes = selectedScopes.length > 0;
  const designStages = ['concept', 'design'];
  const hasDesign = (explicitScopes && selectedScopes.includes('design')) || rows.some((d) => designStages.includes(d.stage) && d.kind !== '3d');
  const has3d = (explicitScopes && selectedScopes.includes('3d')) || rows.some((d) => d.kind === '3d');
  const phases = [];
  const completed = (d) => ['submitted', 'approved'].includes(d.status);
  if (hasDesign) {
    const items = rows.filter((d) => designStages.includes(d.stage) && d.kind !== '3d');
    const done = items.filter(completed).length;
    phases.push({ key: 'design', label: 'التصميم', done, total: items.length, percent: items.length ? Math.round(done / items.length * 100) : 0 });
  }
  if (has3d) {
    const items = rows.filter((d) => d.kind === '3d');
    const done = items.filter(completed).length;
    phases.push({ key: '3d', label: '3D', done, total: items.length, percent: items.length ? Math.round(done / items.length * 100) : 0 });
  }
  if ((explicitScopes && selectedScopes.includes('technical_drawings')) || rows.some((d) => d.stage === 'technical' && d.kind !== '3d')) {
    const items = rows.filter((d) => d.stage === 'technical' && d.kind !== '3d');
    const done = items.filter(completed).length;
    phases.push({ key: 'technical_drawings', label: 'اللوحات الفنية', done, total: items.length, percent: items.length ? Math.round(done / items.length * 100) : 0 });
  }
  if ((explicitScopes && selectedScopes.includes('execution')) || rows.some((d) => d.stage === 'execution' && d.kind !== '3d')) {
    const items = rows.filter((d) => d.stage === 'execution' && d.kind !== '3d');
    const done = items.filter(completed).length;
    phases.push({ key: 'execution', label: 'التنفيذ', done, total: items.length, percent: items.length ? Math.round(done / items.length * 100) : 0 });
  }
  const done = phases.reduce((sum, phase) => sum + phase.done, 0);
  const total = phases.reduce((sum, phase) => sum + phase.total, 0);
  const percent = total > 0 ? Math.round(done / total * 100) : null;
  return { phases, percent, done, total };
}

function renderProjectProgress(project, deliverables = S.deliverables, context = 'projects') {
  const progress = projectProgressData(project, deliverables);
  if (!progress.phases.length) return '<div class="project-progress-empty muted small">حدد نطاق المشروع أو سجّل بنود الإنجاز لعرض النسب.</div>';
  const phaseIndicators = progress.phases.map((phase) =>
    financeRing(phase.percent, phase.label, 'small', 'collection', 100, context, phase.total ? `${phase.done}/${phase.total} تم تسليمه` : 'لا توجد بنود مسجلة')
  ).join('');
  return `<div class="project-progress-block">
    <div class="project-progress-overall"><div><small>متوسط إنجاز نطاقات المشروع</small><strong>${progress.percent === null ? '—' : progress.percent + '%'}</strong></div><div class="project-progress-track"><span style="width:${progress.percent === null ? 0 : progress.percent}%"></span></div></div>
    <div class="project-progress-phases">${phaseIndicators}</div>
  </div>`;
}

function dashboardMetricCard(title, percent, detail, section, metric = 'collection', context = 'dashboard', secondary = null) {
  const indicator = financeRing(percent, '', 'small', metric, 100, context);
  const extra = secondary ? `<span class="dashboard-metric-secondary">${esc(secondary.label)} ${secondary.value === null || secondary.value === undefined ? '—' : Math.round(secondary.value) + '%'}</span>` : '';
  return `<button class="dashboard-metric-card" data-action="nav" data-section="${section}"><span class="dashboard-metric-copy"><strong class="dashboard-metric-title">${esc(title)}</strong><small>${esc(detail || '')}</small>${extra}</span><span class="dashboard-metric-indicator">${indicator}</span></button>`;
}

function projectCategories(project, ds, reqs) {
  const technical = projectProgressData(project, ds);
  const handed = ds.filter(d => ['submitted', 'approved'].includes(d.status)).length;
  const financial = projectFinanceTotals(project);
  const collectionText = financial.collectionPct === null ? '—' : Math.round(financial.collectionPct) + '%';
  const profitText = financial.profitPct === null ? '—' : Math.round(financial.profitPct) + '%';
  return [
    { key: 'summary', label: 'ملخص المشروع', description: 'بيانات المشروع ومتابعة العميل', percent: null },
    { key: 'requirements', label: 'متطلبات العميل', description: reqs.length ? reqs.length + ' متطلبات مسجلة' : 'لا توجد متطلبات مسجلة', percent: reqs.length ? Math.round(reqs.filter(x => x.status === 'done').length / reqs.length * 100) : null },
    { key: 'technical', label: 'الحالة الفنية', description: technical.phases.length ? technical.phases.length + ' مراحل ضمن نطاق العمل' : 'لم يتم تحديد نطاق فني', percent: technical.percent },
    { key: 'finance', label: 'الحالة المالية', description: financial.contract > 0 ? 'تحصيل ' + collectionText + ' · صافي ' + profitText : 'لا توجد قيمة تعاقد مسجلة', percent: financial.collectionPct },
    { key: 'links', label: 'المرفقات والروابط', description: (project.links || []).length ? project.links.length + ' رابط' : 'روابط ملفات Google Drive والمراجع', percent: null },
    { key: 'deliverables', label: 'التسليمات واللوحات', description: ds.length ? ds.length + ' بند تسليم' : 'أضف بنود التسليم', percent: ds.length ? Math.round(handed / ds.length * 100) : null },
  ];
}

function renderProjectCategoryRow(project, cat) {
  const value = cat.percent === null || cat.percent === undefined ? '' : '<span class="project-category-percent">' + Math.round(cat.percent) + '%</span>';
  return '<button class="project-category-row" type="button" data-action="open-panel" data-id="' + esc(project.id) + '" data-panel="' + cat.key + '"><span class="project-category-copy"><strong>' + esc(cat.label) + '</strong><small>' + esc(cat.description) + '</small></span>' + value + '<span class="project-category-chevron">' + icon('chevL', 16) + '</span></button>';
}

// ---- لوحة تفاصيل القسم: تظهر من أسفل الشاشة وتصغّر الصفحة التي خلفها.
function panelData() {
  const pp = S.projectPanel; if (!pp) return null;
  const project = S.projects.find(p => p.id === pp.projectId); if (!project) return null;
  const ds = S.deliverables.filter(d => d.projectId === project.id);
  const reqs = S.requirements.filter(x => x.projectId === project.id);
  const cat = projectCategories(project, ds, reqs).find(c => c.key === pp.panel); if (!cat) return null;
  return { project, ds, reqs, cat };
}

function panelMarkup(d) {
  const pct = d.cat.percent === null || d.cat.percent === undefined ? '' : '<span class="panel-percent">' + Math.round(d.cat.percent) + '%</span>';
  return '<header class="panel-head"><div class="panel-title"><small>' + esc(d.project.name) + '</small><h2>' + esc(d.cat.label) + '</h2></div>' + pct + '<button class="panel-close" type="button" data-action="close-panel" aria-label="' + t('cancel') + '">' + icon('close', 18) + '</button></header>' +
    '<div class="shell"><main class="panel-body">' + renderProjectPanelContent(d.project, S.projectPanel.panel, d.ds, d.reqs) + '</main></div>';
}

function panelDuration() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-duration'));
  return Number.isFinite(v) ? v : 260;
}

function openProjectPanel(projectId, panel) {
  S.projectPanel = { projectId, panel };
  const d = panelData();
  if (!d) { S.projectPanel = null; return; }
  let host = $('#panel');
  if (!host) { host = document.createElement('div'); host.id = 'panel'; document.body.appendChild(host); }
  host.classList.remove('is-open');
  host.innerHTML = '<div class="panel-backdrop" data-action="close-panel"></div><section class="panel-sheet" role="dialog" aria-modal="true" aria-label="' + esc(d.cat.label) + '"><div class="panel-grip" aria-hidden="true"></div><div class="panel-content">' + panelMarkup(d) + '</div></section>';
  const main = document.querySelector('#app .main');
  if (main) main.style.transformOrigin = '50% ' + Math.round(window.scrollY + window.innerHeight * 0.45) + 'px';
  document.body.classList.add('panel-open');
  void host.offsetWidth;
  host.classList.add('is-open');
}

function closeProjectPanel(immediate = false) {
  const host = $('#panel');
  S.projectPanel = null;
  document.body.classList.remove('panel-open');
  if (!host) return;
  host.classList.remove('is-open');
  const finish = () => { if (!S.projectPanel) host.innerHTML = ''; };
  if (immediate) finish(); else setTimeout(finish, panelDuration() + 80);
}

function refreshProjectPanel(opts = {}) {
  if (!S.projectPanel) return;
  const d = panelData();
  if (!d) { closeProjectPanel(true); return; }
  const c = document.querySelector('#panel .panel-content'); if (!c) return;
  const body = c.querySelector('.panel-body');
  const top = body ? body.scrollTop : 0;
  const ae = document.activeElement;
  const focusId = !opts.reset && ae && c.contains(ae) ? ae.id : '';
  const sel = focusId && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
  const vals = {};
  if (!opts.reset) c.querySelectorAll('input[id],textarea[id],select[id]').forEach(el => { vals[el.id] = el.value; });
  c.innerHTML = panelMarkup(d);
  Object.entries(vals).forEach(([id, v]) => { const el = c.querySelector('#' + CSS.escape(id)); if (el && el.type !== 'hidden') el.value = v; });
  const nb = c.querySelector('.panel-body'); if (nb) nb.scrollTop = top;
  if (focusId) { const f = c.querySelector('#' + CSS.escape(focusId)); if (f) { f.focus({ preventScroll: true }); if (sel) try { f.setSelectionRange(sel[0], sel[1]); } catch { /* تجاهل */ } } }
}

function renderProjectRequirementsPanel(project, requirements) {
  const openCount = requirements.filter(x => x.status !== 'done').length;
  return '<div class="project-panel-intro"><span>متطلبات العميل</span><strong>' + openCount + ' مفتوح</strong></div>' +
    '<form data-action="add-requirement" class="entry-form project-minimal-form"><label class="lab" for="req-text">طلب جديد من العميل</label><textarea class="input textarea" id="req-text" rows="2" required placeholder="اكتب طلب العميل هنا..."></textarea><div class="form-grid"><div><label class="lab" for="req-source">مصدر الطلب</label><select class="input" id="req-source"><option value="whatsapp">WhatsApp</option><option value="manual">مكالمة / طلب مباشر</option></select></div><div><label class="lab" for="req-date">تاريخ الطلب</label><input class="input" id="req-date" type="date" value="' + D.todayISO() + '"></div></div><button class="btn primary" type="submit">إضافة Requirement</button></form>' +
    (requirements.length ? '<div class="project-requirements-list">' + requirements.map(r => '<article class="requirement-row"><div><p>' + esc(r.text) + '</p><small>' + (r.source === 'meeting' ? 'Meeting' : r.source === 'whatsapp' ? 'WhatsApp' : 'طلب مباشر') + ' · ' + esc(r.date || '—') + (r.sourceLabel ? ' · ' + esc(r.sourceLabel) : '') + '</small></div><select class="input compact" data-change="requirement-status" data-id="' + esc(r.id) + '"><option value="open" ' + (r.status === 'open' ? 'selected' : '') + '>مفتوح</option><option value="doing" ' + (r.status === 'doing' ? 'selected' : '') + '>قيد التنفيذ</option><option value="done" ' + (r.status === 'done' ? 'selected' : '') + '>تم</option></select></article>').join('') + '</div>' : '<p class="muted small">لا توجد متطلبات مسجلة لهذا المشروع حتى الآن.</p>') +
    '<p class="muted small"><button class="btn sm" data-action="wa-open" data-id="' + esc(project.id) + '">' + L('استيراد من WhatsApp / WhatsApp Business', 'Import from WhatsApp / WhatsApp Business') + '</button></p>';
}

function deliverableKindsHtml() { return '<optgroup label="Existing & Layout"><option value="existing">Existing</option><option value="masonry">Masonry</option><option value="demolish">Demolish</option><option value="furniture">Furniture</option><option value="dimension">Dimension</option><option value="furniture-layout">Furniture Layout</option><option value="plan">' + t('type_plan') + '</option><option value="section">' + t('type_section') + '</option><option value="elevation">' + t('type_elevation') + '</option><option value="detail">' + t('type_detail') + '</option></optgroup><optgroup label="Ceiling & Electrical"><option value="rcp">RCP</option><option value="electrical-power">Electrical Power</option><option value="electrical-switches">Electrical Switches</option><option value="electrical-low-current">Electrical Low Current</option></optgroup><optgroup label="Finishes"><option value="flooring">Flooring</option><option value="wall-finishing">Wall Finishing</option></optgroup><optgroup label="Mechanical"><option value="mechanical-ac">Mechanical AC</option><option value="mechanical-plumbing">Mechanical Plumbing</option><option value="mechanical-drainage">Mechanical Drainage</option></optgroup><optgroup label="Schedules"><option value="schedule-door">Schedule - Door</option><option value="schedule-window">Schedule - Window</option><option value="schedule-finishes">Schedule - Finishes</option><option value="schedule-lighting">Schedule - Lighting</option><option value="schedule-ffe">Schedule - FF&E</option></optgroup><option value="3d">3D</option><option value="other">' + t('other') + '</option>'; }
function deliverableKindLabel(v) { const m = new RegExp('<option value="' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '">([^<]*)<').exec(deliverableKindsHtml()); return m ? m[1] : (v || '—'); }
function deliverableStageLabel(v) { return ({ concept: t('stage_concept'), design: t('stage_design'), technical: t('stage_technical'), execution: t('stage_execution') })[v] || v || '—'; }
function approvalLabel(v) { return ({ pending: t('approval_pending'), submitted: t('approval_submitted'), approved: t('approval_approved'), revision: t('approval_revision') })[v] || v || '—'; }
function renderProjectDeliverablesPanel(project, deliverables) {
  const rows = deliverables;
  const stages = '<option value="concept">' + t('stage_concept') + '</option><option value="design">' + t('stage_design') + '</option><option value="technical">' + t('stage_technical') + '</option><option value="execution">' + t('stage_execution') + '</option>';
  const kinds = deliverableKindsHtml();
  return '<form data-action="add-deliverable" class="entry-form project-minimal-form"><input type="hidden" id="d-project" value="' + esc(project.id) + '"><div class="form-grid">' + inputField(t('deliverable_name'), 'd-name') + '<div><label class="lab" for="d-stage">' + t('design_stage') + '</label><select class="input" id="d-stage">' + stages + '</select></div><div><label class="lab" for="d-kind">' + t('deliverable_type') + '</label><select class="input" id="d-kind">' + kinds + '</select></div>' + inputField(t('due_date'), 'd-date', 'date') + '<div><label class="lab" for="d-status">' + t('approval_status') + '</label><select class="input" id="d-status"><option value="pending">' + t('approval_pending') + '</option><option value="submitted">' + t('approval_submitted') + '</option><option value="approved">' + t('approval_approved') + '</option><option value="revision">' + t('approval_revision') + '</option></select></div></div><label class="lab" for="d-notes">' + t('notes') + '</label><input class="input" id="d-notes"><button class="btn primary" type="submit">' + t('add_deliverable') + '</button></form>' +
    (rows.length ? '<div class="project-deliverables-list">' + rows.map(d => '<article class="project-deliverable-row"><div><strong>' + esc(d.name) + ' ' + vBadgeHtml(project, d) + '</strong><small>' + esc(d.kind || '') + (d.notes ? ' · ' + esc(d.notes) : '') + '</small>' + vActionsHtml(project, d) + '</div><span>' + esc(({concept:t('stage_concept'),design:t('stage_design'),technical:t('stage_technical'),execution:t('stage_execution')})[d.stage] || d.stage || '—') + '</span><span>' + esc(d.dueDate || '—') + '</span><select class="input compact" data-change="deliverable-status" data-id="' + esc(d.id) + '"><option value="pending" ' + (d.status === 'pending' ? 'selected' : '') + '>' + t('approval_pending') + '</option><option value="submitted" ' + (d.status === 'submitted' ? 'selected' : '') + '>' + t('approval_submitted') + '</option><option value="approved" ' + (d.status === 'approved' ? 'selected' : '') + '>' + t('approval_approved') + '</option><option value="revision" ' + (d.status === 'revision' ? 'selected' : '') + '>' + t('approval_revision') + '</option></select><button class="text-action danger" data-action="delete-deliverable" data-id="' + esc(d.id) + '" type="button">حذف</button></article>').join('') + '</div>' : '<p class="muted small">لا توجد تسليمات مسجلة لهذا المشروع.</p>');
}

function renderProjectPhaseRows(project, deliverables) {
  const progress = projectProgressData(project, deliverables);
  if (!progress.phases.length) return '<p class="muted small">لا توجد مراحل فنية محددة لهذا المشروع. حدّد نطاق العمل من تعديل المشروع.</p>';
  return '<div class="project-phase-list">' + progress.phases.map(phase => {
    const rows = deliverables.filter(d => phase.key === 'design' ? ['concept','design'].includes(d.stage) && d.kind !== '3d' : phase.key === '3d' ? ['concept','design'].includes(d.stage) && d.kind === '3d' : phase.key === 'technical_drawings' ? d.stage === 'technical' : phase.key === 'execution' ? d.stage === 'execution' : false);
    return '<details class="project-phase-row"><summary><span>' + esc(phase.label) + '</span><span class="project-phase-percent">' + (phase.total ? phase.percent + '%' : '—') + '</span></summary><div class="project-phase-detail"><span class="muted small">' + phase.done + ' من ' + phase.total + ' بند تم تسليمه</span>' + (rows.length ? '<ul>' + rows.map(d => '<li>' + esc(d.name) + ' <small>' + esc(({pending:'قيد العمل',submitted:'تم الإرسال',approved:'معتمد',revision:'مطلوب تعديل'})[d.status] || d.status || '—') + '</small></li>').join('') + '</ul>' : '<p class="muted small">لم تُضف بنود لهذه المرحلة بعد.</p>') + '</div></details>';
  }).join('') + '</div>';
}

function renderProjectFinancePanel(project) {
  const totals = projectFinanceTotals(project);
  const rows = S.financeEntries
    .filter(entry => entry.projectId === project.id)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 8);
  const remaining = totals.contract - totals.income;
  const amount = value => money(Math.abs(value)) + ' ' + t('currency');
  const rowMarkup = rows.length
    ? '<div class="project-finance-entries">' + rows.map(entry =>
        '<div class="project-finance-entry"><span>' + esc(entry.date || '—') + '</span><span>' + esc(entry.category || entry.description || (entry.kind === 'income' ? 'تحصيل' : 'مصروف')) + '</span><strong class="' + (entry.kind === 'income' ? 'positive' : 'negative') + '">' + (entry.kind === 'income' ? '+' : '−') + amount(Number(entry.amount) || 0) + '</strong></div>'
      ).join('') + '</div>'
    : '<p class="muted small">لا توجد حركات مالية مسجلة لهذا المشروع.</p>';
  return '<div class="project-finance-panel">' +
    '<div class="project-finance-metrics">' +
      '<div><span>قيمة التعاقد</span><strong>' + amount(totals.contract) + '</strong></div>' +
      '<div><span>إجمالي التحصيل</span><strong>' + amount(totals.income) + '</strong></div>' +
      '<div><span>إجمالي المصروفات</span><strong>' + amount(totals.expense) + '</strong></div>' +
      '<div><span>صافي الربح</span><strong class="' + (totals.net < 0 ? 'negative' : 'positive') + '">' + (totals.net < 0 ? '−' : '') + amount(totals.net) + '</strong></div>' +
      '<div><span>المتبقي للتحصيل</span><strong>' + (remaining < 0 ? '−' : '') + amount(remaining) + '</strong></div>' +
    '</div>' +
    '<div class="project-panel-intro"><span>نسب الماليات</span>' + ratioTitlePair(totals, 'projects') + '</div>' +
    '<div class="project-finance-entry-heading">آخر الحركات المالية</div>' + rowMarkup +
    '<button class="text-action" data-action="nav" data-section="finance" type="button">فتح صفحة الماليات</button>' +
  '</div>';
}

function renderProjectPanelContent(project, panel, deliverables, requirements) {
  if (panel === 'summary') return '<div class="project-summary-facts"><div><span>العميل</span><strong>' + esc(project.client || '—') + '</strong></div><div><span>نوع المشروع</span><strong>' + esc(projectTypeLabel(project.type)) + '</strong></div><div><span>الحالة</span><strong>' + esc(projectStatusLabel(project.status)) + '</strong></div><div><span>الموقع</span><strong>' + esc(project.location || '—') + '</strong></div><div><span>نطاق العمل</span><strong>' + esc(projectScopeLabel(project.workScope || []) || '—') + '</strong></div></div>' + (project.notes ? '<p class="project-summary-notes">' + esc(project.notes) + '</p>' : '<p class="muted small">لا توجد ملاحظات إضافية للمشروع.</p>') + renderProjectFollowUp(project);
  if (panel === 'requirements') return renderProjectRequirementsPanel(project, requirements);
  if (panel === 'technical') return '<div class="project-panel-intro"><span>إنجاز المراحل الفنية</span><strong>' + (projectProgressData(project, deliverables).percent === null ? '—' : projectProgressData(project, deliverables).percent + '%') + '</strong></div>' + renderProjectPhaseRows(project, deliverables);
  if (panel === 'deliverables') return renderProjectDeliverablesPanel(project, deliverables);
  if (panel === 'finance') return renderProjectFinancePanel(project);
  if (panel === 'links') return renderProjectLinksPanel(project);
  return '';
}

// روابط المشروع: ملفات Google Drive أو أي مرجع (مجاني تمامًا، لا يُرفع شيء من التطبيق). تُقبل روابط http/https فقط.
function safeHttpUrl(u) { try { const x = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } }
function renderProjectLinksPanel(project) {
  const links = project.links || [];
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  return `<p class="muted small">${L('الصق رابط ملف أو مجلد من Google Drive (صور، PDF، لوحات…) ليكون مرجعًا واحدًا للمشروع. اضبط مشاركة الملف في Drive على من يلزم.', 'Paste a Google Drive file or folder link (images, PDFs, drawings…) as a single reference for the project.')}</p>
    <ul class="mgr-list">${links.map((l) => `<li class="mgr-row"><div><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(l.title)}</strong></a><small class="muted">${esc(host(l.url))}</small></div><button class="btn sm" data-action="link-del" data-id="${esc(project.id)}" data-link="${esc(l.id)}">${L('حذف', 'Delete')}</button></li>`).join('') || `<li class="muted">${L('لا توجد روابط بعد.', 'No links yet.')}</li>`}</ul>
    <label class="lab" for="link-title">${L('الاسم', 'Title')}</label><input class="input" id="link-title" maxlength="120" placeholder="${L('مثال: لوحات الكوزينة PDF', 'e.g. Kitchen drawings PDF')}">
    <label class="lab" for="link-url">${L('الرابط', 'Link')}</label><input class="input" id="link-url" inputmode="url" dir="ltr" placeholder="https://drive.google.com/…">
    <div class="sheet-actions"><button class="btn primary" data-action="link-add" data-id="${esc(project.id)}">${L('إضافة الرابط', 'Add link')}</button></div>`;
}

function renderProjectCard(project) {
  const expanded = S.activeProjectId === project.id;
  const technical = projectProgressData(project, S.deliverables).percent;
  const ds = S.deliverables.filter(d => d.projectId === project.id);
  const reqs = S.requirements.filter(x => x.projectId === project.id);
  const financial = projectFinanceTotals(project);
  const techText = technical === null ? '—' : technical + '%';
  const collectionText = financial.collectionPct === null ? '—' : Math.round(financial.collectionPct) + '%';
  const profitText = financial.profitPct === null ? '—' : Math.round(financial.profitPct) + '%';
  const progress = projectProgressData(project, ds);
  return '<article class="project-accordion ' + (expanded ? 'is-expanded' : '') + (project.archivedAt ? ' is-archived' : '') + '">' +
    '<div class="project-list-row-wrap"><button class="project-list-row" data-action="toggle-project" data-id="' + esc(project.id) + '" type="button" aria-expanded="' + expanded + '"><span class="project-list-name">' + esc(project.name) + '</span><span class="project-list-ratios"><span>فني ' + techText + '</span><span>تحصيل ' + collectionText + '</span><span>صافي ' + profitText + '</span></span><span class="project-list-chevron">' + icon('chevD', 16) + '</span></button><button class="project-list-report" data-action="print-project" data-id="' + esc(project.id) + '" type="button">تقرير</button></div>' +
    (expanded ? '<div class="project-accordion-content"><div class="project-accordion-meta"><span>' + esc(projectTypeLabel(project.type)) + '</span><span>' + esc(projectStatusLabel(project.status)) + '</span><span>' + ds.length + ' تسليمات</span></div>' +
      projectCategories(project, ds, reqs).map(cat => renderProjectCategoryRow(project, cat)).join('') +
      '<div class="project-accordion-actions"><button class="text-action" data-action="edit-project" data-id="' + esc(project.id) + '" type="button">تعديل المشروع</button><button class="text-action" data-action="archive-project" data-id="' + esc(project.id) + '" type="button">' + (project.archivedAt ? 'إلغاء الأرشفة' : 'أرشفة') + '</button><button class="text-action danger" data-action="delete-project" data-id="' + esc(project.id) + '" type="button">حذف</button></div></div>' : '') + '</article>';
}

function renderProjects() {
  const allProjects = [...S.projects].sort((a,b)=>(b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  const projects = allProjects.filter(p => !!p.archivedAt === S.showArchivedProjects);
  const activeCount = allProjects.filter(p => !p.archivedAt).length;
  const archivedCount = allProjects.length - activeCount;
  return '<div class="project-page"><div class="projects-toolbar"><div class="project-filters"><button class="minimal-text-action ' + (!S.showArchivedProjects ? 'is-active' : '') + '" data-action="show-projects" data-val="active">المشروعات ' + activeCount + '</button><button class="minimal-text-action ' + (S.showArchivedProjects ? 'is-active' : '') + '" data-action="show-projects" data-val="archived">الأرشيف ' + archivedCount + '</button><button class="minimal-text-action" data-action="new-project">+ ' + t('new_project') + '</button></div></div>' +
    (projects.length ? '<div class="project-grid">' + projects.map(renderProjectCard).join('') + '</div>' : '<div class="project-empty-line"><strong>' + (S.showArchivedProjects ? 'الأرشيف فارغ' : t('no_projects')) + '</strong></div>') +
    '</div>';
}

function inputField(label, id, type='text', value='', extra='') { return `<label class="lab" for="${id}">${label}</label><input class="input" id="${id}" type="${type}" value="${esc(value)}" ${extra}>`; }

// Project requirements share one inbox across meeting notes and client messages.
async function syncMeetingRequirements(meeting, rawText) {
  if (!meeting?.projectId) return;
  const lines = [...new Set(String(rawText || '').split(/\n+/).map(x => x.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean))];
  const existing = S.requirements.filter(x => x.source === 'meeting' && x.sourceId === meeting.id);
  const keep = new Set();
  for (let i=0;i<lines.length;i++) {
    const id = meeting.id + '_meeting_' + i; keep.add(id);
    const old = existing.find(x => x.id === id);
    await S.store.save('requirements', { ...(old||{}), id, projectId: meeting.projectId, text: lines[i].slice(0,1200), source:'meeting', sourceId:meeting.id, sourceLabel:meeting.title||'Meeting', date:meeting.date||D.todayISO(), status:old?.status||'open', updatedAt:Date.now(), createdAt:old?.createdAt||Date.now() });
  }
  for (const old of existing) if (!keep.has(old.id)) await S.store.remove('requirements', old.id);
}

// ================================================================== مؤشرات مالية للمشروعات
function projectFinanceTotals(project, entries = S.financeEntries) {
  const rows = entries.filter(x => x.projectId === project.id);
  const income = rows.filter(x => x.kind === 'income').reduce((n, x) => n + Math.max(0, Number(x.amount) || 0), 0);
  const expense = rows.filter(x => x.kind === 'expense').reduce((n, x) => n + Math.max(0, Number(x.amount) || 0), 0);
  const contract = Math.max(0, Number(project.contractValue) || 0);
  const net = income - expense;
  return {
    income, expense, contract, net,
    collectionPct: contract > 0 ? income / contract * 100 : null,
    profitPct: income > 0 ? net / income * 100 : null,
  };
}

function financeRing(value, label, size = 'large', metric = 'collection', target = 100, context = 'finance', detail = null) {
  const safeTarget = Number.isFinite(Number(target)) ? Math.min(100, Math.max(1, Number(target))) : 100;
  const targetLabel = lang() === 'ar' ? `الهدف ${safeTarget}%` : `Target ${safeTarget}%`;
  const look = ratioLookFor(context);
  const color = value < 0 ? '#d45b52' : metric === 'collection' ? look.collectionColor : look.profitColor;
  const isEmpty = value === null || !Number.isFinite(value);
  const amount = isEmpty ? 0 : Math.min(100, Math.abs(value) / safeTarget * 100);
  const rounded = isEmpty ? '—' : `${Math.round(value)}%`;
  const style = look.style;
  const styleVars = `--ratio-color:${color};--ratio-track:var(--surface-2);--ratio-pct:${amount}%;--ratio-angle:${amount * 1.8}deg;--ring-pct:${amount}%;`;
  let visual;
  if (style === 'ring') {
    visual = `<div class="finance-ring ${metric} ${isEmpty ? 'empty' : value < 0 ? 'loss' : ''}" style="${styleVars}"><span>${rounded}</span></div>`;
  } else if (isEmpty) {
    visual = `<div class="ratio-visual ratio-${style} ratio-empty" style="${styleVars}"><b>${rounded}</b></div>`;
  } else if (style === 'bar') {
    visual = `<div class="ratio-visual ratio-bar" style="${styleVars}"><span class="ratio-fill"></span><b>${rounded}</b></div>`;
  } else if (style === 'pill') {
    visual = `<div class="ratio-visual ratio-pill" style="${styleVars}"><span class="ratio-fill"></span><b>${rounded}</b></div>`;
  } else if (style === 'gauge') {
    visual = `<div class="ratio-visual ratio-gauge" style="${styleVars}"><span class="ratio-gauge-arc"></span><b>${rounded}</b></div>`;
  } else if (style === 'blocks') {
    visual = `<div class="ratio-visual ratio-blocks" style="${styleVars}">${Array.from({ length: 8 }, (_, i) => `<i class="${i < Math.ceil(amount / 12.5) ? 'on' : ''}"></i>`).join('')}<b>${rounded}</b></div>`;
  } else {
    visual = `<div class="ratio-visual ratio-badge" style="${styleVars}"><b>${rounded}</b></div>`;
  }
  const emptyNote = lang() === 'ar' ? 'لا توجد بيانات' : 'No data';
  const detailText = detail === null ? (isEmpty ? emptyNote + ' · ' + targetLabel : targetLabel) : detail;
  return `<div class="finance-ring-wrap ${size} ${style === 'ring' ? 'ratio-wrap-ring' : 'ratio-wrap-' + style}" style="--ratio-color:${color};">${visual}<small>${esc(label)}</small><em>${esc(detailText)}</em></div>`;
}

function ratioLookFor(context = 'finance') {
  const config = S.settings.ratioAppearance || DEFAULT_SETTINGS.ratioAppearance;
  return config.scope === 'perTab' ? (config.tabs?.[context] || config.global) : config.global;
}

function updateRatioLook(field, value, context = S.ratioEditorContext, render = true) {
  if (!['style', 'collectionColor', 'profitColor'].includes(field)) return;
  const current = S.settings.ratioAppearance || DEFAULT_SETTINGS.ratioAppearance;
  const next = { ...current, global: { ...current.global }, tabs: { ...current.tabs } };
  if (current.scope === 'perTab') {
    next.tabs[context] = { ...(next.tabs[context] || current.global), [field]: value };
  } else {
    next.global = { ...next.global, [field]: value };
  }
  updateSettings({ ratioAppearance: next }, { render });
}

function renderRatioPreview() {
  const preview = $('#ratio-live-preview');
  if (!preview) return;
  const ar = lang() === 'ar';
  preview.innerHTML = `${financeRing(68, ar ? 'نسبة التحصيل' : 'Collection', 'large', 'collection', 100, S.ratioEditorContext)}${financeRing(25, ar ? 'هامش الربح' : 'Profit margin', 'small', 'profit', 25, S.ratioEditorContext)}`;
}

function ratioTitlePair(metrics, context = 'finance') {
  const look = ratioLookFor(context);
  const fmt = (value) => value === null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`;
  const ar = lang() === 'ar';
  return `<span class="ratio-title-pair" style="--ratio-collection-color:${look.collectionColor};--ratio-profit-color:${look.profitColor};"><span><small>${ar ? 'تحصيل' : 'Collected'}</small><b class="collection">${fmt(metrics.collectionPct)}</b></span><span><small>${ar ? 'صافي' : 'Net margin'}</small><b class="profit">${fmt(metrics.profitPct)}</b></span></span>`;
}

function renderFinanceProjectCard(project) {
  const metrics = projectFinanceTotals(project);
  const ar = lang() === 'ar';
  const scope = project.workScope?.length ? projectScopeLabel(project.workScope) : '';
  const kind = [projectTypeLabel(project.type), scope].filter(Boolean).join(' · ');
  const expanded = S.expandedFinanceProjectId === project.id;
  const ringHtml = (pct, cls, label) => {
    const empty = pct === null || !Number.isFinite(pct);
    const amount = empty ? 0 : Math.min(100, Math.max(0, Math.abs(pct)));
    return `<div class="fin-ring-wrap"><div class="fin-ring ${cls} ${empty ? 'empty' : ''} ${pct < 0 ? 'loss' : ''}" style="--p:${amount}%"><span>${empty ? '—' : Math.round(pct) + '%'}</span></div><small>${label}</small></div>`;
  };
  const cur = t('currency');
  return `<article class="fin-card ${expanded ? 'is-expanded' : ''}">
    <div class="fin-head">
      <button class="fin-title" data-action="toggle-finance-project" data-id="${esc(project.id)}" aria-expanded="${expanded}">
        <strong>${esc(project.name)}</strong>
        <span class="muted small">${esc(kind || projectStatusLabel(project.status))}</span>
      </button>
      <div class="fin-rings">${ringHtml(metrics.collectionPct, 'collect', ar ? 'إجمالي التحصيل' : 'Collected')}${ringHtml(metrics.profitPct, 'profit', ar ? 'صافي الربح' : 'Net profit')}</div>
    </div>
    <div class="fin-details"><div class="fin-values">
      <span>${ar ? 'قيمة التعاقد' : 'Contract'}<strong>${money(metrics.contract)} ${cur}</strong></span>
      <span>${ar ? 'المحصّل' : 'Collected'}<strong>${money(metrics.income)} ${cur}</strong></span>
      <span>${ar ? 'المصروف' : 'Expenses'}<strong>${money(metrics.expense)} ${cur}</strong></span>
      <span>${ar ? 'صافي الربح' : 'Net profit'}<strong class="${metrics.net < 0 ? 'negative' : 'positive'}">${metrics.net < 0 ? '−' : ''}${money(Math.abs(metrics.net))} ${cur}</strong></span>
    </div><button class="btn sm" data-action="open-project" data-id="${esc(project.id)}">${ar ? 'تفاصيل المشروع' : 'Project details'}</button></div>
  </article>`;
}

function renderProjectInstallments(project) {
  const rows=Array.isArray(project.installments)?project.installments:[];
  const planned=rows.reduce((sum,x)=>sum+Math.max(0,Number(x.amount)||0),0);
  return `<details class="card glass project-followup-panel project-extra-panel"><summary class="project-panel-summary"><span><b>دفعات الاتفاق</b><small>${rows.length?`${rows.filter(x=>x.status==='paid').length} من ${rows.length} تم تحصيلها`:'أضف دفعات الاتفاق ومواعيدها'}</small></span><span class="chip">${money(planned)} ج.م</span></summary><div class="project-panel-body"><p class="muted small">تعليم الدفعة كمحصلة يضيفها تلقائيًا لسجل ماليات المشروع.</p>
    <form data-action="add-installment" data-id="${esc(project.id)}" class="entry-form"><div class="form-grid"><div><label class="lab" for="installment-title">اسم الدفعة</label><input class="input" id="installment-title" maxlength="80" placeholder="مثال: مقدم التعاقد" required></div><div><label class="lab" for="installment-amount">المبلغ (جنيه)</label><input class="input" id="installment-amount" type="number" min="0.01" step="0.01" required></div><div><label class="lab" for="installment-date">موعدها</label><input class="input" id="installment-date" type="date"></div></div><button class="btn primary" type="submit">إضافة دفعة</button></form>
    ${rows.length?`<div class="installment-list">${rows.slice().sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).map(x=>`<article class="installment-row ${x.status==='paid'?'is-paid':''}"><span class="installment-main"><b>${esc(x.title||'دفعة')}</b><small>${x.dueDate?`موعدها ${esc(x.dueDate)}`:'من دون موعد'}${x.status!=='paid'&&x.dueDate&&x.dueDate<D.todayISO()?' · متأخرة':''}</small></span><strong>${money(x.amount)} ج.م</strong><span class="chip">${x.status==='paid'?'تم التحصيل':'مستحقة'}</span><span class="installment-actions">${x.status==='paid'?`<button class="btn sm" data-action="toggle-installment-paid" data-id="${esc(project.id)}" data-installment-id="${esc(x.id)}">تراجع</button>`:`<button class="btn sm" data-action="toggle-installment-paid" data-id="${esc(project.id)}" data-installment-id="${esc(x.id)}">تم التحصيل</button>`}<button class="btn sm danger" data-action="delete-installment" data-id="${esc(project.id)}" data-installment-id="${esc(x.id)}" aria-label="حذف الدفعة">×</button></span></article>`).join('')}</div>`:'<p class="muted small">أضف مواعيد الدفعات المتفق عليها لو محتاج تتابعها.</p>'}</div></details>`;
}

function renderProjectFollowUp(project) {
  const date=project.followUpDate||'';
  return `<details class="card glass project-followup-panel project-extra-panel"><summary class="project-panel-summary"><span><b>متابعة العميل</b><small>${date?`${esc(date)}${project.followUpNote?' · '+esc(project.followUpNote):''}`:'أضف موعدًا لتظهر المتابعة في الرئيسية'}</small></span>${date?`<span class="chip ${date<D.todayISO()?'late':''}">${date<D.todayISO()?'متأخرة':'مجدولة'}</span>`:''}</summary><div class="project-panel-body"><p class="muted small">الموعد والملاحظة يظهران في الرئيسية عند اقتراب الموعد.</p><form data-action="save-project-followup" data-id="${esc(project.id)}" class="entry-form"><div class="form-grid"><div><label class="lab" for="follow-up-date">موعد المتابعة</label><input class="input" id="follow-up-date" type="date" value="${esc(date)}" required></div><div><label class="lab" for="follow-up-note">ملاحظة قصيرة</label><input class="input" id="follow-up-note" maxlength="160" value="${esc(project.followUpNote||'')}" placeholder="مستني رد على التصميم"></div></div><div class="btnrow"><button class="btn primary" type="submit">حفظ الموعد</button>${date?`<button class="btn" type="button" data-action="clear-project-followup" data-id="${esc(project.id)}">مسح المتابعة</button>`:''}</div></form></div></details>`;
}

function openReportWindow(html) {
  const w = window.open('', '_blank'); if (!w) { toast(t('print_popup_blocked')); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
function reportData(p) {
  const id = p.id;
  const ds = S.deliverables.filter((x) => x.projectId === id).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const fs = S.financeEntries.filter((x) => x.projectId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const reqs = S.requirements.filter((x) => x.projectId === id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const totals = projectFinanceTotals(p, fs), progress = projectProgressData(p, ds);
  const ar = lang() === 'ar';
  const phaseNames = { design: ar ? 'التصميم' : 'Design', '3d': '3D', technical_drawings: ar ? 'اللوحات الفنية' : 'Technical drawings', execution: ar ? 'التنفيذ' : 'Execution' };
  return {
    project: { name: p.name, client: p.client, typeLabel: projectTypeLabel(p.type), statusLabel: projectStatusLabel(p.status), location: p.location, scopeLabel: projectScopeLabel(p.workScope || []), notes: p.notes, contract: totals.contract },
    progress: { ...progress, phases: progress.phases.map((x) => ({ ...x, label: phaseNames[x.key] || x.label })) },
    totals,
    deliverables: ds.map((x) => ({ name: x.name, stageLabel: deliverableStageLabel(x.stage), kindLabel: deliverableKindLabel(x.kind), due: x.dueDate, status: x.status, statusLabel: approvalLabel(x.status), notes: x.notes })),
    finance: fs, money,
    installments: (p.installments || []).map((i) => ({ name: i.title || i.name, dueDate: i.dueDate, amount: i.amount, status: i.status })),
    meetings: S.meetings.filter((x) => x.projectId === id).sort((x, y) => (y.date || '').localeCompare(x.date || '')).slice(0, 5).map((x) => ({ date: x.date, title: x.title, decisions: x.decisions, actions: x.actions })),
    requirements: reqs.map((x) => ({ text: x.text, source: x.sourceLabel || x.source, date: x.date, statusLabel: ({ open: lang() === 'ar' ? 'مفتوح' : 'Open', doing: lang() === 'ar' ? 'قيد التنفيذ' : 'In progress', done: lang() === 'ar' ? 'تم' : 'Done' })[x.status] || x.status })),
  };
}
function printProjectReport(id, mode) {
  const p = S.projects.find((x) => x.id === id); if (!p) return;
  openReportWindow(buildProjectReport(mode === 'finance' ? 'finance' : 'status', reportData(p), { lang: lang(), brand: S.settings.brand || {} }));
}
function printClientReport(id) {
  const p = S.projects.find((x) => x.id === id); if (!p) return;
  openReportWindow(buildProjectReport('client', reportData(p), { lang: lang(), brand: S.settings.brand || {} }));
}
function printProjectFullReport(id) {
  const p = S.projects.find((x) => x.id === id); if (!p) return;
  openReportWindow(buildProjectReport('full', reportData(p), { lang: lang(), brand: S.settings.brand || {} }));
}
function openPrintChoice(id) {
  const p=S.projects.find(x=>x.id===id); if(!p)return;
  $('#layer').innerHTML=`<div class="overlay" data-action="overlay"><section class="sheet glass" role="dialog" aria-modal="true"><div class="sheet-head"><h2>${t('print_project')} · ${esc(p.name)}</h2><button class="btn icon-btn" data-action="close-voice" aria-label="${t('cancel')}">×</button></div><p class="muted">${t('print_choose')}</p><div class="btnrow"><button class="btn primary" data-action="print-full" data-id="${esc(id)}">تقرير شامل للمشروع</button><button class="btn" data-action="print-status" data-id="${esc(id)}">${t('project_status_report')}</button><button class="btn" data-action="print-finance" data-id="${esc(id)}">${t('finance_report')}</button><button class="btn" data-action="print-client" data-id="${esc(id)}">${L('تقرير للعميل (بدون الربح والمصروفات)', 'Client report (no profit/expenses)')}</button><button class="btn" data-action="doc-open" data-id="${esc(id)}">${L('عرض سعر / فاتورة / إيصال', 'Quote / Invoice / Receipt')}</button></div></section></div>`;
}
// ====================================================================== عرض سعر / فاتورة / إيصال
function openDocSheet(projectId) {
  const p = S.projects.find((x) => x.id === projectId); if (!p) return;
  S.docProject = projectId;
  const pending = (p.installments || []).filter((i) => i.status !== 'paid');
  const prefill = pending.length ? pending.map((i) => `${i.title || i.name} | 1 | ${i.amount}`).join('\n') : '';
  const next = String((S.settings.docCounter || 0) + 1).padStart(3, '0');
  $('#layer').innerHTML = `<div class="overlay" data-action="overlay"><section class="sheet glass" role="dialog" aria-modal="true">
    <div class="sheet-head"><h2>${L('عرض سعر / فاتورة / إيصال', 'Quote / Invoice / Receipt')} · ${esc(p.name)}</h2><button class="btn icon-btn" data-action="close-voice" aria-label="close">×</button></div>
    <label class="lab" for="doc-kind">${L('نوع المستند', 'Document type')}</label>
    <select class="input" id="doc-kind"><option value="quote">${L('عرض سعر', 'Quotation')}</option><option value="invoice">${L('فاتورة', 'Invoice')}</option><option value="receipt">${L('إيصال استلام دفعة', 'Payment receipt')}</option></select>
    <label class="lab" for="doc-number">${L('رقم المستند', 'Document no.')}</label><input class="input" id="doc-number" value="${new Date().getFullYear()}-${next}">
    <label class="lab" for="doc-lines">${L('البنود (كل بند في سطر: الوصف | الكمية | سعر الوحدة)', 'Items (one per line: description | qty | unit price)')}</label>
    <textarea class="input textarea" id="doc-lines" rows="5" placeholder="${L('تصميم داخلي | 1 | 50000', 'Interior design | 1 | 50000')}">${esc(prefill)}</textarea>
    <div class="fin-values"><div><label class="lab" for="doc-disc">${L('خصم %', 'Discount %')}</label><input class="input" id="doc-disc" inputmode="decimal" value="0"></div><div><label class="lab" for="doc-vat">${L('ضريبة %', 'VAT %')}</label><input class="input" id="doc-vat" inputmode="decimal" value="0"></div></div>
    <label class="lab" for="doc-valid">${L('صالح حتى (عرض السعر)', 'Valid until (quotation)')}</label><input class="input" id="doc-valid" type="date">
    <label class="lab" for="doc-for">${L('الإيصال: مبلغ الدفعة وبيانها (المبلغ | البيان)', 'Receipt: amount | description')}</label><input class="input" id="doc-for" placeholder="${L('20000 | الدفعة الأولى', '20000 | First installment')}">
    <label class="lab" for="doc-notes">${L('الشروط والملاحظات', 'Terms & notes')}</label><textarea class="input textarea" id="doc-notes" rows="3"></textarea>
    <div class="sheet-actions"><button class="btn" data-action="close-voice">${t('cancel')}</button><button class="btn primary" data-action="doc-generate">${L('إنشاء المستند', 'Generate')}</button></div>
  </section></div>`;
}
function generateDocument() {
  const p = S.projects.find((x) => x.id === S.docProject); if (!p) return;
  const kind = $('#doc-kind').value;
  const lines = ($('#doc-lines').value || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((a) => a[0]).map(([desc, qty, price]) => ({ desc, qty: Number(qty) || 1, price: Number(String(price || '0').replace(/[^\d.]/g, '')) || 0 }));
  const [amt, forWhat] = ($('#doc-for').value || '').split('|').map((x) => x.trim());
  if (kind !== 'receipt' && !lines.length) { toast(L('أضف بندًا واحدًا على الأقل.', 'Add at least one item.')); return; }
  if (kind === 'receipt' && !(Number(String(amt).replace(/[^\d.]/g, '')) > 0)) { toast(L('اكتب مبلغ الدفعة في خانة الإيصال.', 'Enter the amount in the receipt field.')); return; }
  const doc = { kind, number: $('#doc-number').value.trim(), date: D.todayISO(), validUntil: $('#doc-valid').value, client: p.client || '', project: p.name, lines,
    discountPct: Number($('#doc-disc').value) || 0, vatPct: Number($('#doc-vat').value) || 0, notes: $('#doc-notes').value.trim(), receipt: { amount: Number(String(amt).replace(/[^\d.]/g, '')) || 0, forWhat: forWhat || '' } };
  updateSettings({ docCounter: (S.settings.docCounter || 0) + 1 }, { render: false });
  $('#layer').innerHTML = '';
  openReportWindow(buildDocument(doc, { lang: lang(), brand: S.settings.brand || {}, money }));
}

// ====================================================================== المدير الذكي
const L = (ar, en) => (lang() === 'ar' ? ar : en);
const MGR_REASON = { late: ['متأخر', 'Overdue'], today: ['اليوم', 'Today'], tomorrow: ['غدًا', 'Tomorrow'], week: ['هذا الأسبوع', 'This week'], later: ['لاحقًا', 'Later'] };
const MGR_KIND = { task: ['مهمة', 'Task'], deliverable: ['تسليم', 'Deliverable'], installment: ['دفعة', 'Installment'], followup: ['متابعة', 'Follow-up'] };
const MGR_ALERT = {
  late_tasks: ['مهام متأخرة', 'Overdue tasks'], late_deliverables: ['تسليمات متأخرة', 'Overdue deliverables'],
  installments: ['دفعات مستحقة أو قريبة', 'Installments due soon'], followups: ['متابعات عملاء قريبة', 'Client follow-ups due'], finance: ['تنبيه مالي', 'Financial alert'],
};
const MGR_FLAG = { negative: ['صافي الربح بالسالب', 'Negative net profit'], low_margin: ['هامش الربح أقل من الهدف', 'Margin below target'], collection_behind: ['التحصيل متأخر عن تقدم العمل', 'Collection behind progress'], no_collection: ['لا يوجد تحصيل رغم وجود تعاقد', 'No collection despite a contract'] };

function managerReport() {
  return buildManagerReport({
    tasks: S.tasks, projects: S.projects, deliverables: S.deliverables, financeEntries: S.financeEntries, today: D.todayISO(),
    totalsFor: projectFinanceTotals, progressFor: projectProgressData, targets: S.settings.financeTargets || {},
  });
}
function mgrItemRow(x) {
  const ar = lang() === 'ar';
  const when = x.date ? D.fmt(x.date, locale(), { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  return `<li class="mgr-row ${x.reason === 'late' ? 'is-late' : ''}"><div><strong>${esc(x.title)}</strong><small class="muted">${esc([MGR_KIND[x.kind][ar ? 0 : 1], x.project, when].filter(Boolean).join(' · '))}</small></div><span class="mgr-tag">${MGR_REASON[x.reason][ar ? 0 : 1]}</span></li>`;
}
function mgrView(view, r) {
  const ar = lang() === 'ar';
  if (view === 'alerts') {
    return r.alerts.length ? `<ul class="mgr-list">${r.alerts.map((a) => `<li class="mgr-row ${a.level === 'high' ? 'is-late' : ''}"><div><strong>${MGR_ALERT[a.key][ar ? 0 : 1]}${a.key !== 'finance' ? ' (' + a.n + ')' : ''}</strong><small class="muted">${esc(a.key === 'finance' ? `${a.project} — ${a.flags.map((f) => MGR_FLAG[f][ar ? 0 : 1]).join('، ')}` : a.text)}</small></div></li>`).join('')}</ul>` : `<p class="muted">${L('لا توجد تنبيهات الآن.', 'No alerts right now.')}</p>`;
  }
  if (view === 'today') {
    return r.todayItems.length ? `<ul class="mgr-list">${r.todayItems.map(mgrItemRow).join('')}</ul>` : `<p class="muted">${L('لا توجد عناصر لليوم أو متأخرة.', 'Nothing due today or overdue.')}</p>`;
  }
  if (view === 'week') {
    return `<div class="mgr-week">${Object.entries(r.week).map(([d, list]) => `<div class="mgr-day"><h4>${esc(D.fmt(d, locale(), { weekday: 'long', day: 'numeric', month: 'short' }))}</h4>${list.length ? `<ul class="mgr-list">${list.map(mgrItemRow).join('')}</ul>` : `<p class="muted small">${L('يوم فارغ', 'Free day')}</p>`}</div>`).join('')}</div>`;
  }
  if (view === 'finance') {
    const f = r.finance; const cur = t('currency');
    const rows = f.perProject.map((p) => `<li class="mgr-row ${p.flags.length ? 'is-late' : ''}"><div><strong>${esc(p.name)}</strong><small class="muted">${L('تحصيل', 'Collected')} ${p.collectionPct == null ? '—' : Math.round(p.collectionPct) + '%'} · ${L('ربح', 'Profit')} ${p.profitPct == null ? '—' : Math.round(p.profitPct) + '%'}${p.flags.length ? ' · ' + p.flags.map((x) => MGR_FLAG[x][ar ? 0 : 1]).join('، ') : ''}</small></div><span class="mgr-tag">${money(p.net)} ${cur}</span></li>`).join('');
    return `<div class="fin-values"><span>${L('إجمالي التحصيل', 'Total collected')}<strong>${money(f.income)} ${cur}</strong></span><span>${L('إجمالي المصروف', 'Total expenses')}<strong>${money(f.expense)} ${cur}</strong></span><span>${L('صافي الربح', 'Net profit')}<strong class="${f.net < 0 ? 'negative' : 'positive'}">${money(f.net)} ${cur}</strong></span><span>${L('المتبقي للتحصيل', 'Remaining to collect')}<strong>${money(f.outstanding)} ${cur}</strong></span></div><ul class="mgr-list">${rows || `<li class="muted">${L('لا توجد مشروعات.', 'No projects.')}</li>`}</ul>`;
  }
  return r.priorities.length ? `<ol class="mgr-list mgr-ranked">${r.priorities.map(mgrItemRow).join('')}</ol>` : `<p class="muted">${L('لا توجد عناصر عاجلة. أضف مهامًا أو مواعيد لأرتب لك الأولويات.', 'Nothing urgent. Add tasks or dates and I will rank them.')}</p>`;
}
function openManagerSheet(view = 'priorities', note = '') {
  const r = managerReport(); S.mgrView = view;
  const tabs = [['priorities', 'الأولويات', 'Priorities'], ['today', 'خطة اليوم', 'Today'], ['week', 'خطة الأسبوع', 'Week'], ['alerts', 'التنبيهات', 'Alerts'], ['finance', 'التحليل المالي', 'Finance']];
  const summary = L(`${r.counts.open} عنصر مفتوح · ${r.counts.late} متأخر · ${r.alerts.length} تنبيه`, `${r.counts.open} open · ${r.counts.late} overdue · ${r.alerts.length} alerts`);
  $('#layer').innerHTML = `<div class="overlay" data-action="overlay"><section class="sheet mgr-sheet glass" role="dialog" aria-modal="true">
    <div class="sheet-head"><h2>${L('المدير الذكي', 'AI Manager')}</h2><button class="btn icon-btn" data-action="close-voice" aria-label="close">×</button></div>
    <p class="muted small">${summary}</p>
    <div class="mgr-cmd"><input class="input" id="mgr-text" placeholder="${L('اسأل أو اكتب أمرًا: رتب أولوياتي، خطة الأسبوع، ذكرني بكرة…', 'Ask or command: rank my priorities, weekly plan, remind me tomorrow…')}"><button class="btn" data-action="mgr-mic" aria-label="mic">${icon('mic', 18)}</button><button class="btn primary" data-action="mgr-run">${L('تنفيذ', 'Run')}</button></div>
    <div class="mgr-tabs">${tabs.map(([v, a, e]) => `<button class="mgr-tab" data-action="mgr-view" data-view="${v}" aria-pressed="${v === view}">${L(a, e)}</button>`).join('')}</div>
    ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
    <div id="mgr-body">${mgrView(view, r)}</div>
    <div class="mgr-ai"><button class="btn" data-action="mgr-ai">${L('تحليل وتوصيات بالذكاء الاصطناعي', 'AI analysis & recommendations')}</button><div id="mgr-ai-out" class="muted small" aria-live="polite"></div></div>
  </section></div>`;
}
async function managerAiAdvice() {
  const out = $('#mgr-ai-out'); if (!out) return;
  out.textContent = L('جارٍ التحليل…', 'Analyzing…');
  const r = managerReport();
  try {
    const res = await meetingAiRequest('/manager', {
      language: lang(), today: D.todayISO(), counts: r.counts,
      priorities: r.priorities.slice(0, 8).map((x) => ({ kind: x.kind, title: x.title, project: x.project, date: x.date, reason: x.reason })),
      alerts: r.alerts.map((a) => ({ key: a.key, n: a.n, text: a.text })),
      finance: { income: r.finance.income, expense: r.finance.expense, net: r.finance.net, outstanding: r.finance.outstanding, projects: r.finance.perProject.slice(0, 20).map((p) => ({ name: p.name, collectionPct: p.collectionPct, profitPct: p.profitPct, progress: p.progress, flags: p.flags })) },
    });
    out.innerHTML = esc(String(res.advice || '')).replace(/\n/g, '<br>') || L('لا توجد توصيات.', 'No recommendations.');
  } catch (err) {
    out.textContent = (err.message || '') + ' ' + L('(التحليل المحلي أعلاه يعمل بدون إنترنت.)', '(The local analysis above works offline.)');
  }
}
function managerRun(text) {
  const view = managerIntent(text);
  if (view) { openManagerSheet(view); return; }
  if (!text.trim()) return;
  // أمر تنفيذي (مهمة/دفعة/مشروع/تقرير): نفس محلل الأوامر الصوتية، والعمليات الحساسة تطلب تأكيدًا.
  Promise.resolve(handleVoiceCommand(inferVoiceCommand(text))).catch((err) => toast(err.message || String(err)));
}
function startManagerMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast(t('voice_unsupported')); return; }
  const rec = new SR(); rec.lang = lang() === 'ar' ? 'ar-EG' : 'en-US'; rec.interimResults = false;
  rec.onresult = (e) => { const f = $('#mgr-text'); if (f) { f.value = e.results[0][0].transcript; managerRun(f.value); } };
  rec.onerror = () => toast(t('voice_error')); rec.start();
}

// ====================================================================== استيراد WhatsApp
function openWhatsAppSheet(projectId) {
  const p = S.projects.find((x) => x.id === projectId); if (!p) return;
  S.waProject = projectId; S.waMsgs = null;
  $('#layer').innerHTML = `<div class="overlay" data-action="overlay"><section class="sheet wa-sheet glass" role="dialog" aria-modal="true">
    <div class="sheet-head"><h2>${L('متطلبات من WhatsApp', 'Requirements from WhatsApp')} · ${esc(p.name)}</h2><button class="btn icon-btn" data-action="close-voice" aria-label="close">×</button></div>
    <p class="muted small">${L('ألصق محادثة العميل من WhatsApp أو WhatsApp Business، أو ارفع ملف «تصدير المحادثة» (.txt). لن يُحفظ أي متطلب قبل مراجعتك وموافقتك.', 'Paste the client chat from WhatsApp or WhatsApp Business, or upload the exported chat (.txt). Nothing is saved until you review and approve.')}</p>
    <label class="lab" for="wa-kind">${L('نوع التطبيق', 'App')}</label>
    <select class="input" id="wa-kind"><option value="whatsapp">WhatsApp</option><option value="whatsapp-business">WhatsApp Business</option></select>
    <label class="lab" for="wa-file">${L('ملف المحادثة', 'Chat file')}</label><input class="input" id="wa-file" type="file" accept=".txt,text/plain">
    <label class="lab" for="wa-text">${L('أو ألصق المحادثة هنا', 'Or paste the chat here')}</label>
    <textarea class="input textarea" id="wa-text" rows="6"></textarea>
    <div class="sheet-actions"><button class="btn" data-action="close-voice">${t('cancel')}</button><button class="btn primary" data-action="wa-analyze">${L('استخرج المتطلبات', 'Extract requirements')}</button></div>
    <div id="wa-review"></div>
  </section></div>`;
}
function waRenderSenders(msgs) {
  const senders = senderList(msgs); if (!senders.length) return '';
  return `<p class="lab">${L('رسائل من (اختر العميل)', 'Messages from (pick the client)')}</p><div class="wa-senders">${senders.map((s) => `<label class="wa-sender"><input type="checkbox" class="wa-sender-cb" value="${esc(s)}" checked> ${esc(s)}</label>`).join('')}</div><button class="btn sm" data-action="wa-refilter">${L('تحديث النتائج', 'Refresh results')}</button>`;
}
function waRenderCandidates() {
  const msgs = S.waMsgs || []; const box = $('#wa-review'); if (!box) return;
  const only = new Set([...document.querySelectorAll('.wa-sender-cb:checked')].map((x) => x.value));
  const existing = S.requirements.filter((r) => r.projectId === S.waProject);
  const found = extractRequirements(msgs, { clientSenders: only.size ? only : null, existing });
  S.waFound = found;
  box.innerHTML = `${waRenderSenders(msgs)}
    <p class="lab">${found.length ? L(`وجدت ${found.length} متطلبًا محتملًا — عدّل أو ألغِ التحديد قبل الحفظ`, `${found.length} possible requirements — edit or untick before saving`) : L('لم أجد طلبات واضحة. جرّب اختيار مرسل آخر أو ألصق نصًا أطول.', 'No clear requests found. Try another sender or paste more text.')}</p>
    <ul class="wa-list">${found.map((c, i) => `<li class="wa-item"><label><input type="checkbox" class="wa-pick" data-i="${i}" checked></label><div><textarea class="input textarea wa-edit" data-i="${i}" rows="2">${esc(c.text)}</textarea><small class="muted">${esc([c.sender, c.date].filter(Boolean).join(' · '))}</small></div></li>`).join('')}</ul>
    ${found.length ? `<div class="sheet-actions"><button class="btn primary" data-action="wa-save">${L('حفظ المحدد في المتطلبات', 'Save selected to Requirements')}</button></div>` : ''}`;
}
async function waAnalyze() {
  let raw = $('#wa-text')?.value || '';
  const file = $('#wa-file')?.files?.[0];
  if (file) { if (file.size > 3e6) { toast(L('الملف كبير جدًا (أقصى 3 ميجابايت).', 'File too large (max 3 MB).')); return; } raw = await file.text(); }
  if (raw.trim().length < 8) { toast(L('ألصق المحادثة أو ارفع الملف أولًا.', 'Paste the chat or upload a file first.')); return; }
  S.waMsgs = parseWhatsAppChat(raw.slice(0, 400000));
  waRenderCandidates();
}
async function waSave() {
  const kind = $('#wa-kind')?.value === 'whatsapp-business' ? 'WhatsApp Business' : 'WhatsApp';
  const picks = [...document.querySelectorAll('.wa-pick:checked')].map((cb) => {
    const i = Number(cb.dataset.i); const txt = document.querySelector(`.wa-edit[data-i="${i}"]`)?.value.trim();
    return { txt, c: S.waFound[i] };
  }).filter((x) => x.txt);
  if (!picks.length) { toast(L('لم تحدد أي متطلب.', 'No requirement selected.')); return; }
  for (const { txt, c } of picks) {
    await S.store.save('requirements', { id: uid(), projectId: S.waProject, text: txt.slice(0, 1200), source: 'whatsapp', sourceId: null, sourceLabel: kind + (c.sender ? ' · ' + c.sender : ''), date: c.date || D.todayISO(), status: 'open', createdAt: Date.now(), updatedAt: Date.now() });
  }
  toast(L(`تمت إضافة ${picks.length} متطلب.`, `${picks.length} requirement(s) added.`));
  $('#layer').innerHTML = ''; S.activeProjectId = S.waProject; refreshProjectPanel?.({ reset: true }); render();
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



 // تسجيل صوت الاجتماع كاملًا داخل المتصفح، مع حفظ محلي في IndexedDB.
 S.meetingMediaRecorder = null; S.meetingAudioChunks = []; S.pendingMeetingAudio = null;
 function meetingAudioDb(){
   return new Promise((resolve,reject)=>{
     const req=indexedDB.open('weeklyplanner-meeting-audio',1);
     req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('audio'))db.createObjectStore('audio',{keyPath:'meetingId'});};
     req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
   });
 }
 async function saveMeetingAudio(meetingId, blob){
   const db=await meetingAudioDb();
   await new Promise((resolve,reject)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').put({meetingId,blob,mimeType:blob.type,updatedAt:Date.now()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
   db.close();
 }
 const nativeAudioRequests = new Map();
 let nativeAudioRequestSeq = 0;
 function requestNativeAudio(action,fileName){
   return new Promise((resolve,reject)=>{
     if(!window.WeeklyPlannerNative){reject(new Error('واجهة ملفات Android غير متاحة. حدّث التطبيق إلى آخر إصدار.'));return;}
     const requestId='audio_'+(++nativeAudioRequestSeq)+'_'+Date.now();
     nativeAudioRequests.set(requestId,{resolve,reject});
     window.WeeklyPlannerNative.postMessage(JSON.stringify({action,requestId,fileName}));
     setTimeout(()=>{const p=nativeAudioRequests.get(requestId);if(p){nativeAudioRequests.delete(requestId);p.reject(new Error('انتهت مهلة الوصول إلى ملف التسجيل.'));}},20000);
   });
 }
 async function getMeetingAudioBlob(meeting){
   if(meeting?.audioFileName && window.WeeklyPlannerNative){
     const result=await requestNativeAudio('read',meeting.audioFileName);
     const raw=atob(result.base64),bytes=new Uint8Array(raw.length);
     for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
     return new Blob([bytes],{type:'audio/mp4'});
   }
   const db=await meetingAudioDb();
   try{return await new Promise((resolve,reject)=>{const tx=db.transaction('audio','readonly');const req=tx.objectStore('audio').get(meeting.id);req.onsuccess=()=>resolve(req.result?.blob||null);req.onerror=()=>reject(req.error);});}
   finally{db.close();}
 }
 async function meetingAiRequest(path,body,isForm=false){
   let endpoint=localStorage.getItem('wp1:meeting-ai-endpoint')||'https://weeklyplanner-meeting-ai.abdos6335.workers.dev';while(endpoint.endsWith('/'))endpoint=endpoint.slice(0,-1);
   if(!S.store?.getIdToken)throw new Error('سجّل الدخول إلى حسابك لاستخدام خدمات المحاضر.');
   const token=await S.store.getIdToken();
   const response=await fetch(endpoint+path,{method:'POST',headers:{Authorization:'Bearer '+token,...(isForm?{}:{'Content-Type':'application/json'})},body:isForm?body:JSON.stringify(body)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||'تعذر إكمال معالجة الاجتماع. حاول مرة أخرى.');
   return data;
 }
 async function transcribeMeetingAudio(meetingId){
   const meeting=S.meetings.find(m=>m.id===meetingId);if(!meeting)throw new Error('الاجتماع غير موجود.');
   const blob=await getMeetingAudioBlob(meeting);if(!blob)throw new Error('التسجيل غير موجود على هذا الجهاز. افتح التطبيق على الجهاز الذي تم عليه التسجيل.');
   if(blob.size>24*1024*1024)throw new Error('حجم التسجيل أكبر من 24 ميجابايت. قسّم التسجيل إلى أجزاء أقصر ثم أعد المحاولة.');
   const form=new FormData();form.append('audio',blob,meeting.audioFileName||('meeting-'+meeting.id+(blob.type.includes('mp4')?'.m4a':'.webm')));form.append('language',meeting.language||'ar');
   toast('جارٍ إرسال التسجيل للتفريغ الصوتي…');
   const result=await meetingAiRequest('/transcribe',form,true);
   const transcript=String(result.text||'').trim();if(!transcript)throw new Error('لم يُرجع التفريغ أي نص واضح.');
   const updatedMeeting={...meeting,transcript,transcriptionModel:result.model||'whisper-large-v3-turbo',transcribedAt:Date.now(),updatedAt:Date.now()};
   await S.store.save('meetings',updatedMeeting);S.meetings=[...S.meetings.filter(m=>m.id!==meetingId),updatedMeeting];
   toast('تم تفريغ التسجيل وحفظ النص. راجعه ثم أنشئ محضر الاجتماع.');render();
 }
 async function generateMeetingMinutes(meetingId){
   const meeting=S.meetings.find(m=>m.id===meetingId);if(!meeting)throw new Error('الاجتماع غير موجود.');
   if(!meeting.transcript?.trim())throw new Error('لا يوجد نص للاجتماع. فرّغ التسجيل أولًا أو أضف النص يدويًا.');
   const result=await meetingAiRequest('/minutes',{transcript:meeting.transcript,projects:S.projects.map(p=>({id:p.id,name:p.name,client:p.client||''})),currentProjectId:meeting.projectId||null,existingClient:meeting.client||'',language:'ar'});
   const report=result.minutes||{};
   const validCategories=['design','shop-drawings','site','materials','client-review','general'];
   const projectMatch=S.projects.find(p=>p.name.trim().toLocaleLowerCase()===String(report.projectName||'').trim().toLocaleLowerCase());
   const confidence=Number(report.confidence)||0;
   const updated={...meeting,title:String(report.title||meeting.title||'Meeting').slice(0,180),category:validCategories.includes(report.category)?report.category:meeting.category,minutes:String(report.minutes||meeting.minutes||''),decisions:String(report.decisions||''),actions:String(report.actions||''),purpose:String(report.purpose||meeting.purpose||'').slice(0,240),topics:Array.isArray(report.topics)?report.topics.map(x=>String(x).slice(0,160)).slice(0,20).join('\n'):String(report.topics||meeting.topics||''),requirements:meeting.requirements||(Array.isArray(report.requirements)?report.requirements.map(x=>String(x).slice(0,240)).slice(0,30).join('\n'):''),aiGenerated:true,aiGeneratedAt:Date.now(),aiReviewRequired:confidence<0.75||(!projectMatch&&!meeting.projectId)||!!(meeting.projectId&&report.projectName&&!projectMatch),aiReviewNotes:Array.isArray(report.reviewNotes)?report.reviewNotes.slice(0,8):[],participants:Array.isArray(report.attendees)?report.attendees.map(x=>String(x).slice(0,100)).slice(0,12).join('، '):meeting.participants,updatedAt:Date.now()};
   if(projectMatch&&!meeting.projectId)updated.projectId=projectMatch.id;
   if(report.clientName&&confidence>=0.75&&!meeting.client){updated.client=String(report.clientName).slice(0,120);updated.secondParty=updated.client;}
   await S.store.save('meetings',updated);await syncMeetingRequirements(updated,updated.requirements);S.meetings=[...S.meetings.filter(m=>m.id!==meetingId),updated];
   toast(updated.aiReviewRequired?'تم إعداد المحضر. راجع بيانات المشروع والعميل قبل الاعتماد.':'تم إعداد المحضر وحفظه — راجعه قبل الطباعة.');render();
 }
 async function openMeetingAudio(meetingId, download=false){
   const meeting=S.meetings.find(m=>m.id===meetingId);
   const player=download?null:window.open('','_blank');
   if(!download&&!player){toast('اسمح بالنوافذ المنبثقة لتشغيل التسجيل.');return;}
   try{
     let blob=null;
     if(meeting?.audioFileName && window.WeeklyPlannerNative){
       const result=await requestNativeAudio('read',meeting.audioFileName);
       const raw=atob(result.base64), bytes=new Uint8Array(raw.length);
       for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
       blob=new Blob([bytes],{type:'audio/mp4'});
     } else {
       const db=await meetingAudioDb();
       const row=await new Promise((resolve,reject)=>{const tx=db.transaction('audio','readonly');const req=tx.objectStore('audio').get(meetingId);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
       db.close(); blob=row?.blob||null;
     }
     if(!blob)throw new Error('لا يوجد ملف صوتي محفوظ لهذا الاجتماع على هذا الجهاز.');
     const url=URL.createObjectURL(blob);
     if(download){const a=document.createElement('a');a.href=url;a.download='WeeklyPlanner-meeting-'+meetingId+(meeting?.audioFileName?'.m4a':'.webm');a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);return;}
     player.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>تسجيل الاجتماع</title><body style="font-family:Arial;padding:24px"><h2>تسجيل الاجتماع</h2><audio controls autoplay style="width:100%"></audio></body></html>');
     player.document.querySelector('audio').src=url; player.addEventListener('beforeunload',()=>URL.revokeObjectURL(url));
   }catch(err){if(player&&!player.closed)player.close();throw err;}
 }
 async function deleteMeetingAudio(meetingId){
   const meeting=S.meetings.find(m=>m.id===meetingId);if(!meeting)return;
   if(!confirm('هل تريد حذف التسجيل الصوتي لهذا الاجتماع نهائيًا؟'))return;
   if(meeting.audioFileName&&window.WeeklyPlannerNative)await requestNativeAudio('delete',meeting.audioFileName);
   else {const db=await meetingAudioDb();await new Promise((resolve,reject)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').delete(meetingId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();}
   await S.store.save('meetings',{...meeting,audioFileName:null,updatedAt:Date.now()});
   toast('تم حذف التسجيل الصوتي.');render();
 }
 async function startMeetingAudioCapture(){
   const projectId=$('#meeting-project')?.value || null;
   if(window.WeeklyPlannerRecorder){
     const draftId=uid();
     S.nativeMeetingRecording=true; S.nativeMeetingDraftId=draftId; S.nativeMeetingFileName=null;
     window.WeeklyPlannerRecorder.postMessage(JSON.stringify({action:'start',meetingId:draftId,projectId}));
     return;
   }
   if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('تسجيل الصوت الكامل غير مدعوم في هذا المتصفح.');return;}
   try{
     const stream=await navigator.mediaDevices.getUserMedia({audio:true});
     S.meetingAudioChunks=[];
     const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));
     S.meetingMediaRecorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});
     S.meetingMediaRecorder.ondataavailable=e=>{if(e.data?.size)S.meetingAudioChunks.push(e.data);};
     S.meetingMediaRecorder.onstop=()=>{S.pendingMeetingAudio=new Blob(S.meetingAudioChunks,{type:S.meetingMediaRecorder?.mimeType||'audio/webm'});stream.getTracks().forEach(t=>t.stop());S.meetingMediaRecorder=null;S.meetingAudioChunks=[];const status=$('#meeting-audio-status');if(status)status.textContent='تم إنهاء التسجيل — جارٍ حفظ الاجتماع والتجهيز للتفريغ.';autoSaveMeetingAfterRecording();};
     S.meetingMediaRecorder.start(1000);
     const status=$('#meeting-audio-status');if(status)status.textContent='● جارٍ تسجيل صوت الاجتماع.';
     const start=$('[data-action="meeting-audio-start"]'),stop=$('[data-action="meeting-audio-stop"]');if(start)start.disabled=true;if(stop)stop.disabled=false;
   }catch(e){console.error(e);toast('تعذر بدء التسجيل. تحقق من صلاحية الميكروفون.');}
 }
 function autoSaveMeetingAfterRecording(){
   const form=$('form[data-action="save-meeting"]');if(!form)return;
   const project=$('#meeting-project')?.value||'',newProject=$('#meeting-new-project')?.value.trim()||'';
   if(!project&&!newProject){const status=$('#meeting-audio-status');if(status)status.textContent='تم حفظ التسجيل على الجهاز. اختر المشروع ثم اضغط «حفظ محضر الاجتماع» لإضافته إلى السجل.';toast('التسجيل محفوظ. اختر المشروع ثم احفظ الاجتماع لإرفاق التسجيل.');return;}
   S.autoProcessMeetingAfterSave=true;const status=$('#meeting-audio-status');if(status)status.textContent='تم التسجيل. جارٍ حفظ الاجتماع ثم تفريغ الصوت وإنشاء MOM تلقائيًا…';form.requestSubmit();
 }
 function stopMeetingAudioCapture(){
   if(S.nativeMeetingRecording && window.WeeklyPlannerRecorder){window.WeeklyPlannerRecorder.postMessage(JSON.stringify({action:'stop'}));return;}
   if(S.meetingMediaRecorder&&S.meetingMediaRecorder.state!=='inactive')S.meetingMediaRecorder.stop();
   const start=$('[data-action="meeting-audio-start"]'),stop=$('[data-action="meeting-audio-stop"]');if(start)start.disabled=false;if(stop)stop.disabled=true;
 }
 window.addEventListener('weeklyplanner-native-recorder',(event)=>{
   const d=event.detail||{},status=$('#meeting-audio-status');
   if(d.state==='audio-data'||d.state==='audio-deleted'||d.state==='audio-error'){
     const pending=nativeAudioRequests.get(d.requestId);
     if(pending){nativeAudioRequests.delete(d.requestId);if(d.state==='audio-error')pending.reject(new Error(d.message||'تعذر الوصول إلى التسجيل'));else pending.resolve(d);}
     return;
   }
   if(d.state==='recording'){if(status)status.textContent='● التسجيل الأصلي يعمل في الخلفية؛ يمكنك تصغير التطبيق.';const a=$('[data-action="meeting-audio-start"]'),b=$('[data-action="meeting-audio-stop"]');if(a)a.disabled=true;if(b)b.disabled=false;}
   else if(d.state==='paused'){if(status)status.textContent='التسجيل متوقف مؤقتًا من إشعار Android.';}
   else if(d.state==='stopped'){S.nativeMeetingRecording=false;S.nativeMeetingFileName=d.fileName||null;if(status)status.textContent='انتهى التسجيل — جارٍ حفظ الاجتماع والتجهيز للتفريغ.';const a=$('[data-action="meeting-audio-start"]'),b=$('[data-action="meeting-audio-stop"]');if(a)a.disabled=false;if(b)b.disabled=true;autoSaveMeetingAfterRecording();}
   else if(d.state==='error'){S.nativeMeetingRecording=false;if(status)status.textContent=d.message||'حدث خطأ في التسجيل';toast(d.message||'تعذر التسجيل.');}
 });


function renderMeetings() {
  const projects=[...S.projects].sort((a,b)=>a.name.localeCompare(b.name));
  const allRows=[...S.meetings].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||0)-(a.createdAt||0));
  const today=D.todayISO();
  if(!S.meetingWeek) S.meetingWeek=D.weekStartOf(today,startDay());
  const weekDays=D.weekDays(S.meetingWeek);
  const upcomingRows=allRows.filter(m=>(m.date||'')>=today);
  const pastRows=allRows.filter(m=>(m.date||'')<today);
  const rows=S.meetingView==='upcoming'?upcomingRows:S.meetingView==='past'?pastRows:allRows.filter(m=>weekDays.includes(m.date));
  const categories=[
    ['design','Design / 3D Design'],['shop-drawings','Shop Drawings'],['site','Site Execution'],
    ['materials','Colors & Materials'],['client-review','Client Review / Approval'],['general','General Meeting']
  ];
  const categoryLabel=(value)=>categories.find(x=>x[0]===value)?.[1]||value||'General Meeting';
  const currentUser=S.user?.displayName||S.user?.name||S.user?.email||'اسم المستخدم غير متاح';
  const meetingTabs=`<div class="meeting-tabs" role="tablist" aria-label="عرض الاجتماعات">
    <button class="meeting-tab ${S.meetingView==='calendar'?'active':''}" role="tab" aria-selected="${S.meetingView==='calendar'}" data-action="meeting-view" data-val="calendar">${icon('calendar',17)}<span>التقويم الأسبوعي</span></button>
    <button class="meeting-tab ${S.meetingView==='upcoming'?'active':''}" role="tab" aria-selected="${S.meetingView==='upcoming'}" data-action="meeting-view" data-val="upcoming">${icon('clock',17)}<span>الاجتماعات القادمة <small>${upcomingRows.length}</small></span></button>
    <button class="meeting-tab ${S.meetingView==='past'?'active':''}" role="tab" aria-selected="${S.meetingView==='past'}" data-action="meeting-view" data-val="past">${icon('calendar-check',17)}<span>الاجتماعات السابقة <small>${pastRows.length}</small></span></button>
  </div>`;
  const meetingCalendar=S.meetingView==='calendar'?`<section class="meeting-calendar"><div class="meeting-weekbar"><button class="btn icon-btn" data-action="meeting-week-prev" aria-label="الأسبوع السابق">${icon('chevL',18)}</button><strong>${esc(D.fmt(weekDays[0],locale(),{day:'numeric',month:'short'}))} — ${esc(D.fmt(weekDays[6],locale(),{day:'numeric',month:'short',year:'numeric'}))}</strong><button class="btn icon-btn" data-action="meeting-week-next" aria-label="الأسبوع التالي">${icon('chevR',18)}</button><button class="btn sm" data-action="meeting-week-today">هذا الأسبوع</button></div><div class="meeting-week-grid">${weekDays.map(d=>{const dayRows=allRows.filter(m=>m.date===d);return `<div class="meeting-day ${d===today?'is-today':''}"><div class="meeting-day-heading"><b>${esc(D.fmt(d,locale(),{weekday:'short'}))}</b><strong>${esc(D.fmt(d,locale(),{day:'numeric',month:'short'}))}</strong></div>${dayRows.length?dayRows.map(m=>`<div class="meeting-day-event"><b>${esc(m.title||'Meeting')}</b><small>${esc(m.time||'بدون وقت')}</small></div>`).join(''):'<span class="meeting-day-empty">—</span>'}</div>`;}).join('')}</div></section>`:'';
  return `
    ${meetingTabs}
    ${meetingCalendar}
    <div class="page-tools"><div><p class="muted">كل محاضر الاجتماعات في مكان واحد، مرتبطة بمشروعاتها وقابلة للبحث والطباعة.</p><p class="muted small">يمكنك تفريغ التسجيل وصياغة محضر الاجتماع بعد الحفظ، ثم مراجعته قبل الاعتماد. عند طلب التفريغ يُرسل الصوت إلى خدمة معالجة خارجية؛ ولا يتم إرساله تلقائيًا.</p></div><span class="chip">${rows.length} Meetings</span></div>
    <details class="meeting-new-details" id="meeting-new-details"><summary><span>${icon('plus',18)} <strong>تسجيل اجتماع جديد</strong></span><small>افتح النموذج عند الحاجة فقط</small></summary><section class="meeting-new-content" id="meeting-new-form">
      <form data-action="save-meeting" class="entry-form">
        <div class="form-grid">
          <div><label class="lab" for="meeting-project">المشروع</label><select class="input" id="meeting-project"><option value="">اختر المشروع</option>${projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
          <div><label class="lab" for="meeting-new-project">أو إنشاء مشروع جديد</label><input class="input" id="meeting-new-project" placeholder="اسم المشروع الجديد"></div>
          <div><label class="lab" for="meeting-client">اسم العميل / الطرف الثاني</label><input class="input" id="meeting-client" placeholder="يُراجع إذا لم يكن واضحًا من سياق الاجتماع"></div>
          <div><label class="lab" for="meeting-date">تاريخ الاجتماع</label><input class="input" id="meeting-date" type="date" value="${D.todayISO()}" required></div>
          <div><label class="lab" for="meeting-time">الوقت</label><input class="input" id="meeting-time" type="time"></div>
          <div><label class="lab" for="meeting-mode">نوع الاجتماع</label><select class="input" id="meeting-mode"><option value="offline">Offline</option><option value="online">Online</option></select></div>
          <div><label class="lab" for="meeting-category">تصنيف الاجتماع</label><select class="input" id="meeting-category"><option value="general">General Meeting</option><option value="design">Design / 3D Design</option><option value="shop-drawings">Shop Drawings</option><option value="site">Site Execution</option><option value="materials">Colors & Materials</option><option value="client-review">Client Review / Approval</option></select></div>
        </div>
        <label class="lab" for="meeting-title">عنوان الاجتماع</label><input class="input" id="meeting-title" placeholder="مثال: مراجعة الشوب دروينج والتعديلات">
        <div class="form-grid">
          <div><label class="lab" for="meeting-first-party">الطرف الأول — المستخدم الحالي</label><input class="input" id="meeting-first-party" value="${esc(currentUser)}" readonly></div>
          <div><label class="lab" for="meeting-participants">الحضور الآخرون</label><input class="input" id="meeting-participants" placeholder="اسم العميل أو الحضور الآخرين"></div>
        </div>
        <div class="meeting-record-row">
          <button class="btn primary" type="button" data-action="meeting-audio-start">● بدء تسجيل الاجتماع</button>
          <button class="btn" type="button" data-action="meeting-audio-stop" disabled>إيقاف التسجيل</button>
          <span id="meeting-audio-status" class="muted small">يُحفظ التسجيل محليًا على الجهاز ويرتبط بالاجتماع بعد الحفظ.</span>
        </div>
        <div class="meeting-record-row">
          <select class="input compact" id="meeting-language" aria-label="Speech language"><option value="ar-EG">العربية</option><option value="en-US">English</option></select>
          <button class="btn" type="button" data-action="meeting-record">إملاء صوتي للنص</button>
          <button class="btn" type="button" data-action="meeting-stop">إيقاف الإملاء</button>
        </div>
        <label class="lab" for="meeting-requirements">Client Requirements — طلبات العميل (كل طلب في سطر)</label><textarea class="input textarea" id="meeting-requirements" rows="3" placeholder="مثال: إضافة وحدة تخزين بجوار الثلاجة&#10;تغيير لون وحدات المطبخ"></textarea>
        <label class="lab" for="meeting-transcript">Transcript — نص الاجتماع</label>
        <textarea class="input textarea" id="meeting-transcript" rows="6" placeholder="أضف النص المستخرج أو الملاحظات بعد الاجتماع"></textarea>
        <label class="lab" for="meeting-purpose">Purpose — الغرض من الاجتماع</label>
        <input class="input" id="meeting-purpose" maxlength="240" placeholder="مثال: مراجعة الشوب دروينج والتعديلات">
        <label class="lab" for="meeting-topics">Topics — المواضيع (كل موضوع في سطر)</label>
        <textarea class="input textarea" id="meeting-topics" rows="3"></textarea>
        <label class="lab" for="meeting-minutes">Minutes of Meeting — موضوعات المناقشة</label>
        <textarea class="input textarea" id="meeting-minutes" rows="6" placeholder="01. Shop Drawings Review&#10;النقاط التي تمت مناقشتها...&#10;&#10;02. Colors & Materials&#10;النقاط التي تمت مناقشتها..."></textarea>
        <label class="lab" for="meeting-decisions">Agreements & Decisions — تم الاتفاق على</label>
        <textarea class="input textarea" id="meeting-decisions" rows="4" placeholder="1. ...&#10;2. ...&#10;3. ..."></textarea>
        <label class="lab" for="meeting-actions">Action Items — المهام والمسؤوليات والمواعيد</label>
        <textarea class="input textarea" id="meeting-actions" rows="3" placeholder="المهمة — المسؤول — الموعد (إن ذُكر)"></textarea>
        <button class="btn primary" type="submit">حفظ محضر الاجتماع</button>
      </form>
      </section></details>
    <section class="card glass">
      <div class="dhead"><div><h2>سجل Minutes of Meeting</h2><p class="muted small">جميع الاجتماعات من كل المشروعات في صفحة واحدة.</p></div></div>
      ${rows.length?rows.map(m=>{
        const p=projects.find(x=>x.id===m.projectId);
        const cat=categoryLabel(m.category);
        return `<article class="meeting-card" style="padding:14px 0;border-top:1px solid var(--btn-ring)">
          <div class="dhead" style="align-items:flex-start;gap:10px;flex-wrap:wrap">
            <div style="min-width:180px;flex:1">
              <h3 style="margin:0">${esc(m.title||'Meeting')}</h3>
              <p class="muted small">${esc(p?.name||'مشروع غير محدد')} · ${esc(m.date||'—')} ${esc(m.time||'')}</p>
              <div class="chips"><span class="chip">${esc(cat)}</span><span class="chip">${esc(m.client||m.secondParty||p?.client||'العميل غير محدد')}</span></div>
            </div>
            <div class="meeting-record-row">
              ${m.audioFileName||m.hasAudio?`<button class="btn sm" data-action="meeting-ai-transcribe" data-id="${esc(m.id)}">تفريغ التسجيل</button>`:''}
              ${m.transcript?`<button class="btn sm primary" data-action="meeting-ai-minutes" data-id="${esc(m.id)}">إنشاء محضر الاجتماع</button>`:''}
              <button class="btn sm" data-action="meeting-print" data-id="${esc(m.id)}">طباعة MOM</button>
              <button class="btn sm" data-action="meeting-audio-play" data-id="${esc(m.id)}">تشغيل الصوت</button>
              <button class="btn sm" data-action="meeting-audio-download" data-id="${esc(m.id)}">تنزيل الصوت</button>
              <button class="btn sm danger" data-action="meeting-audio-delete" data-id="${esc(m.id)}">حذف التسجيل</button>
            </div>
          </div>
          ${momSummary(m, p)}
          ${m.aiReviewRequired?'<p class="chip late">يحتاج مراجعة بيانات المشروع أو العميل قبل الاعتماد</p>':''}
          <details><summary>مراجعة وتعديل المحضر والنص</summary>
            ${m.aiReviewNotes?.length?`<p class="muted small">ملاحظات المراجعة: ${esc(m.aiReviewNotes.join(" · "))}</p>`:""}
            <form data-action="update-meeting" data-id="${esc(m.id)}" class="entry-form">
              <label class="lab">عنوان الاجتماع</label><input class="input" name="title" value="${esc(m.title||'')}">
              <label class="lab">اسم العميل / الطرف الثاني</label><input class="input" name="client" value="${esc(m.client||m.secondParty||'')}">
              <label class="lab">Purpose — الغرض من الاجتماع</label><input class="input" name="purpose" value="${esc(m.purpose||'')}">
              <label class="lab">Topics — المواضيع</label><textarea class="input textarea" name="topics" rows="3">${esc(m.topics||'')}</textarea>
              <label class="lab">Attendees — الحضور الآخرون</label><input class="input" name="participants" value="${esc(m.participants||'')}">
              <label class="lab">Client Requirements — طلبات العميل (كل طلب في سطر)</label><textarea class="input textarea" name="requirements" rows="3">${esc(m.requirements||'')}</textarea>
              <label class="lab">Transcript — النص الكامل</label><textarea class="input textarea" name="transcript" rows="5">${esc(m.transcript||'')}</textarea>
              <label class="lab">Minutes of Meeting — موضوعات المناقشة</label><textarea class="input textarea" name="minutes" rows="5">${esc(m.minutes||'')}</textarea>
              <label class="lab">Agreements & Decisions — الاتفاقات والقرارات</label><textarea class="input textarea" name="decisions" rows="4">${esc(m.decisions||'')}</textarea>
              <label class="lab">Action Items — المهام</label><textarea class="input textarea" name="actions" rows="3">${esc(m.actions||'')}</textarea>
              <p class="muted small"><b>First Party:</b> ${esc(m.firstParty||currentUser)} · <b>Second Party:</b> ${esc(m.secondParty||m.client||'—')}</p>
              <button class="btn primary" type="submit">حفظ التعديلات</button>
            </form>
          </details>
        </article>`;
      }).join(''):'<p class="muted">لا توجد محاضر اجتماعات حتى الآن. سجّل أول اجتماع من النموذج أعلاه.</p>'}
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
function printMeetingReport(id) {
  const m = S.meetings.find((x) => x.id === id); if (!m) return;
  const p = S.projects.find((x) => x.id === m.projectId) || null;
  const block = (label, value) => value ? `<h2>${rEsc(label)}</h2><div class="note">${rEsc(value)}</div>` : '';
  const client = m.secondParty || m.client || p?.client || '—';
  const first = m.firstParty || S.user?.displayName || S.user?.name || S.user?.email || '—';
  const cat = ({ design: 'Design / 3D Design', 'shop-drawings': 'Shop Drawings', site: 'Site Execution', materials: 'Colors & Materials', 'client-review': 'Client Review / Approval', general: 'General Meeting' })[m.category] || m.category || 'General Meeting';
  const meta = [['Meeting Title | عنوان الاجتماع', m.title], ['Project | المشروع', p?.name || m.projectName], ['Client | العميل', client],
    ['Date | التاريخ', [m.date, m.time].filter(Boolean).join(' ')], ['Category | التصنيف', cat], ['Type | النوع', m.mode === 'online' ? 'Online' : 'Offline']];
  const attendees = `<h2>Meeting Attendees | الحضور</h2><table><tbody><tr><td><small>First Party | الطرف الأول</small><br><b>${rEsc(first)}</b></td><td><small>Second Party | الطرف الثاني</small><br><b>${rEsc(client)}</b></td></tr></tbody></table>`;
  const body = block('Purpose | الغرض من الاجتماع', m.purpose) + block('Topics | المواضيع', m.topics) + block('Minutes of Meeting | موضوعات المناقشة', m.minutes) +
    block('Agreements & Decisions | القرارات والاتفاقات', m.decisions) + block('Client Requirements | طلبات العميل', m.requirements) + block('Action Items | المهام والمسؤوليات والمواعيد', m.actions) +
    attendees + block('Other Attendees | الحضور الآخرون', m.participants) + block('Transcript | النص الكامل للاجتماع', m.transcript);
  openReportWindow(reportShell({ lang: lang(), title: 'Minutes of Meeting', subtitle: 'محضر اجتماع', brand: S.settings.brand || {}, meta, body }));
}

// ملخص المحضر بالحقول التسعة: Title/Purpose/Date/Client/Topics/Attendees/Decisions/Requirements/Action Items
function momSummary(m, p) {
  const ar = lang() === 'ar';
  const client = m.client || m.secondParty || p?.client || '';
  const block = (label, text) => text ? `<div class="mom-field"><small class="muted">${label}</small><p>${esc(text).replace(/\n/g, '<br>')}</p></div>` : '';
  const body = [
    block(ar ? 'الغرض' : 'Purpose', m.purpose),
    block(ar ? 'العميل' : 'Client', client),
    block(ar ? 'التاريخ' : 'Date', [m.date, m.time].filter(Boolean).join(' ')),
    block(ar ? 'المواضيع' : 'Topics', m.topics),
    block(ar ? 'الحضور' : 'Attendees', [m.firstParty, m.participants].filter(Boolean).join('، ')),
    block(ar ? 'القرارات' : 'Decisions', m.decisions),
    block(ar ? 'المتطلبات' : 'Requirements', m.requirements),
    block(ar ? 'المهام' : 'Action Items', m.actions),
    m.minutes && !m.topics ? block(ar ? 'ملخص النقاش' : 'Discussion', m.minutes) : '',
  ].join('');
  if (!body) return '';
  return `<details class="mom-summary"><summary>${ar ? 'محضر الاجتماع' : 'Minutes of Meeting'}</summary>${body}</details>`;
}

function renderFinance() {
  if (S.financeView === 'personal') return renderPersonalExpenses();
  const projectIds = new Set(S.projects.map(p => p.id));
  const projectEntries = S.financeEntries.filter(x => projectIds.has(x.projectId));
  const totalIncome = projectEntries.filter(x => x.kind === 'income').reduce((n,x) => n + Math.max(0,Number(x.amount)||0),0);
  const totalExpense = projectEntries.filter(x => x.kind === 'expense').reduce((n,x) => n + Math.max(0,Number(x.amount)||0),0);
  const contracts = S.projects.reduce((n,p) => n + Math.max(0,Number(p.contractValue)||0),0);
  const totalNet = totalIncome - totalExpense;
  const collectionPct = contracts > 0 ? totalIncome / contracts * 100 : null;
  const profitPct = totalIncome > 0 ? totalNet / totalIncome * 100 : null;
  const summaryExpanded = S.expandedFinanceSummary;
  const entries=[...S.financeEntries].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const projectCards = S.projects.filter(p=>!p.archivedAt).sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
  return `<div class="finance-switch"><button class="btn ${S.financeView==='projects'?'primary':''}" data-action="finance-view" data-val="projects">ماليات المشروعات</button><button class="btn ${S.financeView==='personal'?'primary':''}" data-action="finance-view" data-val="personal">المصروف الشخصي</button></div>
  <section class="card glass finance-overview ${summaryExpanded?'is-expanded':''}"><button class="finance-project-summary" data-action="toggle-finance-summary" aria-expanded="${summaryExpanded}"><strong>ملخص ماليات كل المشروعات</strong><span>${summaryExpanded?'−':'+'}</span></button><div class="finance-overview-details">
    <div class="stats-grid"><div class="card glass stat"><span>${t('contracts_total')}</span><strong>${money(contracts)} ${t('currency')}</strong></div><div class="card glass stat"><span>${t('collected')}</span><strong>${money(totalIncome)} ${t('currency')}</strong></div><div class="card glass stat"><span>${t('expenses')}</span><strong>${money(totalExpense)} ${t('currency')}</strong></div><div class="card glass stat"><span>صافي الربح</span><strong class="${totalNet<0?'negative':'positive'}">${totalNet<0?'−':''}${money(Math.abs(totalNet))} ${t('currency')}</strong></div></div>
    <div class="finance-overview-ratios"><div><span>نسبة التحصيل الإجمالية</span><strong>${collectionPct === null ? '—' : Math.round(collectionPct) + '%'}</strong></div><div><span>هامش صافي الربح الإجمالي</span><strong>${profitPct === null ? '—' : Math.round(profitPct) + '%'}</strong></div></div>
  </div></section>
  <section class="finance-project-list"><div class="dhead"><div><h2>مؤشرات كل مشروع</h2><p class="muted small">كل مشروع له نسبة تحصيل وهامش ربح مستقلان.</p></div><span class="chip">${projectCards.length} مشروع</span></div>
    ${projectCards.length ? projectCards.map(renderFinanceProjectCard).join('') : '<p class="muted">لا توجد مشروعات مسجلة.</p>'}
  </section>
  <section class="card glass"><h2>${t('add_finance_entry')}</h2><form data-action="add-finance" class="entry-form"><div class="form-grid"><div><label class="lab" for="f-project">${t('project')}</label><select class="input" id="f-project" required><option value="">${t('choose_project')}</option>${S.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div><div><label class="lab" for="f-kind">${t('transaction_type')}</label><select class="input" id="f-kind"><option value="income">${t('income')}</option><option value="expense">${t('expenses')}</option></select></div>${inputField(t('amount'),'f-amount','number','', 'min="0.01" step="0.01" required')}${inputField(t('date'),'f-fin-date','date',D.todayISO())}<div><label class="lab" for="f-category">${t('category')}</label><select class="input" id="f-category"><option>${t('general')}</option><option>${t('design')}</option><option>${t('materials')}</option><option>${t('labor')}</option><option>${t('transport')}</option><option>${t('other')}</option></select></div></div><label class="lab" for="f-description">${t('description')}</label><input class="input" id="f-description"><button class="btn primary" type="submit">${t('save_entry')}</button></form></section>
  <section class="card glass"><h2>${t('transactions')}</h2>${entries.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>${t('date')}</th><th>${t('project')}</th><th>${t('category')}</th><th>${t('transaction_type')}</th><th>${t('amount')}</th><th></th></tr></thead><tbody>${entries.map(x=>`<tr><td>${esc(x.date||'—')}</td><td>${esc(S.projects.find(p=>p.id===x.projectId)?.name||t('project_deleted'))}</td><td>${esc(x.category||'—')}<small>${esc(x.description||'')}</small></td><td>${x.kind==='income'?t('income'):t('expenses')}</td><td class="${x.kind==='income'?'positive':'negative'}">${x.kind==='income'?'+':'−'}${money(x.amount)} ${t('currency')}</td><td><button class="btn sm danger" data-action="delete-finance" data-id="${esc(x.id)}">×</button></td></tr>`).join('')}</tbody></table></div>`:`<p class="muted">${t('no_transactions')}</p>`}</section>`;
}

async function editPersonalExpense(id) {
  const x=S.personalExpenses.find(v=>v.id===id); if(!x)return;
  const amount=prompt('المبلغ الجديد:',String(x.amount)); if(amount===null)return;
  const description=prompt(x.kind==='income'?'وصف الدخل:':'وصف المصروف:',x.description||''); if(description===null)return;
  const value=Number(amount); if(!Number.isFinite(value)||value<=0||!description.trim()){toast('بيانات غير صحيحة.');return;}
  try { await S.store.save('personalExpenses',{...x,amount:value,description:description.trim(),updatedAt:Date.now()}); toast(x.kind==='income'?'تم تحديث الدخل.':'تم تحديث المصروف.'); }
  catch(err){toast(t('save_failed',{msg:err.message||err}));}
}
function renderPersonalExpenses() {
  const month = S.expenseMonth || D.todayISO().slice(0,7);
  const budget = Number(S.personalBudgets.find(x=>x.id===month)?.amount || 0);
  const rows = S.personalExpenses.filter(x=>(x.date||'').slice(0,7)===month).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.createdAt||0)-(a.createdAt||0));
  const incomeRows=rows.filter(x=>x.kind==='income');
  const expenseRows=rows.filter(x=>x.kind!=='income');
  const personalIncome=incomeRows.reduce((n,x)=>n+Number(x.amount||0),0);
  const spent = expenseRows.reduce((n,x)=>n+Number(x.amount||0),0);
  const net=personalIncome-spent;
  const remaining = budget-spent;
  const categoryTotals = expenseRows.reduce((acc,x)=>{const key=(x.category||'أخرى').trim()||'أخرى';acc[key]=(acc[key]||0)+Number(x.amount||0);return acc;},{});
  const categoryRows = Object.entries(categoryTotals).sort((a,b)=>b[1]-a[1]);
  const personalCategories = ['سكن وفواتير','مواصلات','طعام ومشروبات','مشتريات البيت','صحة','تعليم','ترفيه','ملابس','التزامات وديون','أخرى'];
  return `<div class="finance-switch"><button class="btn" data-action="finance-view" data-val="projects">ماليات المشروعات</button><button class="btn primary" data-action="finance-view" data-val="personal">الماليات الشخصية</button></div>
  <section class="card glass">
    <div class="dhead"><h2>ميزانية الشهر</h2><input class="input compact" id="expense-month" type="month" value="${esc(month)}" aria-label="الشهر"></div>
    <form data-action="save-personal-budget" class="entry-form">
      <label class="lab" for="personal-budget">الميزانية الشهرية (جنيه)</label>
      <div class="form-grid"><input class="input" id="personal-budget" type="number" min="0" step="0.01" value="${budget||''}" placeholder="مثال: 5000" required><button class="btn primary" type="submit">حفظ الميزانية</button></div>
    </form>
    <div class="stats-grid personal-stats">
      <div class="card glass stat"><span>الميزانية</span><strong>${money(budget)} ج.م</strong></div>
      <div class="card glass stat"><span>الدخل الشخصي</span><strong class="positive">${money(personalIncome)} ج.م</strong></div>
      <div class="card glass stat"><span>المصروف</span><strong>${money(spent)} ج.م</strong></div>
      <div class="card glass stat"><span>المتبقي</span><strong class="${remaining<0?'negative':'positive'}">${money(remaining)} ج.م</strong></div>
      <div class="card glass stat"><span>الصافي</span><strong class="${net<0?'negative':'positive'}">${net<0?'−':''}${money(Math.abs(net))} ج.م</strong></div>
      <div class="card glass stat"><span>المستهلك من الميزانية</span><strong>${budget>0?Math.round(spent/budget*100):0}%</strong></div>
    </div>
    ${budget>0&&spent>budget?'<p class="expense-warning">تنبيه: المصروف تجاوز الميزانية الشهرية، ويمكنك الاستمرار في التسجيل.</p>':''}
  </section>
  <section class="card glass"><h2>إضافة حركة شخصية</h2>
    <form data-action="add-personal-expense" class="entry-form">
      <div class="form-grid"><div><label class="lab" for="pe-kind">نوع الحركة</label><select class="input" id="pe-kind"><option value="expense">مصروف</option><option value="income">دخل</option></select></div><div><label class="lab" for="pe-amount">المبلغ (جنيه)</label><input class="input" id="pe-amount" type="number" min="0.01" step="0.01" required></div>
      <div><label class="lab" for="pe-date">التاريخ</label><input class="input" id="pe-date" type="date" value="${D.todayISO()}" required></div></div>
      <label class="lab" for="pe-category">التصنيف</label><select class="input" id="pe-category" required>${personalCategories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
      <label class="lab" for="pe-description">الوصف</label><input class="input" id="pe-description" maxlength="180" placeholder="مثال: أتعاب مشروع، مواصلات، مشتريات البيت" required>
      <button class="btn primary" type="submit">إضافة الحركة</button>
    </form>
  </section>
  <section class="card glass"><h2>تحليل المصروفات حسب التصنيف</h2>
    ${categoryRows.length?`<div class="category-breakdown">${categoryRows.map(([name,total])=>`<div class="category-row"><div class="category-row-head"><strong>${esc(name)}</strong><span>${money(total)} ج.م · ${spent>0?Math.round(total/spent*100):0}%</span></div><div class="category-track"><span style="width:${spent>0?Math.min(100,total/spent*100):0}%"></span></div></div>`).join('')}</div>`:'<p class="muted">سجّل مصروفات لتظهر تفاصيل التصنيفات هنا.</p>'}
  </section>
  <section class="card glass"><h2>سجل الحركات الشخصية · ${esc(month)}</h2>
    ${rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>المبلغ</th><th>إجراءات</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.date)}</td><td>${x.kind==='income'?'دخل':'مصروف'}</td><td>${esc(x.description||'—')}<small>${esc(x.category||'—')}</small></td><td class="${x.kind==='income'?'positive':'negative'}">${x.kind==='income'?'+':'−'}${money(x.amount)} ج.م</td><td><button class="btn sm" data-action="edit-personal-expense" data-id="${esc(x.id)}">تعديل</button> <button class="btn sm danger" data-action="delete-personal-expense" data-id="${esc(x.id)}">حذف</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">لا توجد حركات شخصية مسجلة في هذا الشهر.</p>'}
  </section>`;
}

function openProjectSheet(id=null) {
  const p=id?S.projects.find(x=>x.id===id):null;
  $('#layer').innerHTML=`<div class="overlay" data-action="overlay"><div class="sheet glass" role="dialog" aria-modal="true"><div class="sheet-head"><h2>${p?t('edit_project'):t('new_project')}</h2><button class="btn icon-btn" data-action="sheet-cancel">×</button></div><form data-action="save-project" data-id="${esc(p?.id||'')}">${inputField(t('project_name'),'p-name','text',p?.name||'','required maxlength="160"')}<fieldset class="scope-fieldset"><legend class="lab">نطاق الخدمات المطلوبة في المشروع</legend><p class="muted small">اختار خدمة واحدة أو اجمع أكثر من خدمة حسب الاتفاق مع العميل.</p><div class="scope-presets">${[["Design","design"],["3D Only","3d"],["Drawings Only","technical_drawings"],["Execution Only","execution"],["Design + Execution + Drawings","design,technical_drawings,execution"]].map(([l,v])=>`<button type="button" class="scope-preset" data-action="scope-preset" data-scopes="${v}">${l}</button>`).join("")}</div><div class="scope-options">${[['design','Design'],['3d','3D Visualization'],['technical_drawings','Technical Drawings'],['execution','Execution']].map(([v,l])=>`<label class="scope-option"><input type="checkbox" name="p-scope" value="${v}" ${(p?.workScope||[]).includes(v)?'checked':''}><span>${l}</span></label>`).join('')}</div></fieldset><div class="form-grid"><div><label class="lab" for="p-type">${t('project_type')}</label><select class="input" id="p-type"><option value="residential" ${p?.type==='residential'?'selected':''}>${t('type_residential')}</option><option value="administrative" ${p?.type==='administrative'?'selected':''}>${t('type_administrative')}</option><option value="commercial" ${p?.type==='commercial'?'selected':''}>${t('type_commercial')}</option><option value="fitout" ${p?.type==='fitout'?'selected':''}>${t('type_fitout')}</option></select></div><div><label class="lab" for="p-status">${t('status')}</label><select class="input" id="p-status"><option value="planning" ${p?.status==='planning'?'selected':''}>${t('status_planning')}</option><option value="active" ${p?.status==='active'?'selected':''}>${t('status_active')}</option><option value="on_hold" ${p?.status==='on_hold'?'selected':''}>${t('status_on_hold')}</option><option value="completed" ${p?.status==='completed'?'selected':''}>${t('status_completed')}</option></select></div>${inputField(t('client'),'p-client','text',p?.client||'')}${inputField(t('location'),'p-location','text',p?.location||'')}${inputField(t('contract_value'),'p-contract','number',p?.contractValue??'','min="0" step="0.01"')}${inputField(L('تعديلات مشمولة في العقد','Revisions included'),'p-revs','number',p?.revisionsIncluded??'','min="0" step="1" placeholder="2"')}${inputField(t('start_date'),'p-start','date',p?.startDate||'')}${inputField(t('end_date'),'p-end','date',p?.endDate||'')}</div><label class="lab" for="p-notes">${t('notes')}</label><textarea class="textarea" id="p-notes" rows="3">${esc(p?.notes||'')}</textarea><div class="sheet-actions"><button type="button" class="btn" data-action="sheet-cancel">${t('cancel')}</button><button type="submit" class="btn primary">${t('save')}</button></div></form></div></div>`;
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
      <label class="lab" for="f-project">${t('task_project')}</label>
      <select id="f-project" class="input">
        <option value="">${t('no_project')}</option>
        ${prev?.projectId && !S.projects.some((p) => p.id === prev.projectId) ? `<option value="${esc(prev.projectId)}" selected>${t('project_deleted')}</option>` : ''}
        ${S.projects.map((p) => `<option value="${esc(p.id)}" ${prev?.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
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
    projectId: $('#f-project')?.value || null,
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
// يصغّر اللوجو إلى 360px كحد أقصى ويحفظه داخل الإعدادات (data URL) كي يظهر في كل تقرير بدون ملفات خارجية.
function importBrandLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast(L('اختر صورة PNG أو JPG أو WebP.', 'Choose a PNG, JPG or WebP image.')); return; }
  if (file.size > 8e6) { toast(L('الصورة كبيرة جدًا.', 'Image too large.')); return; }
  const url = URL.createObjectURL(file); const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 360 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const png = c.toDataURL('image/png');
    const data = png.length > 180000 ? c.toDataURL('image/jpeg', 0.85) : png;
    updateSettings({ brand: { ...(S.settings.brand || {}), logo: data } });
    toast(L('تم حفظ اللوجو.', 'Logo saved.'));
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast(L('تعذر قراءة الصورة.', 'Could not read the image.')); };
  img.src = url;
}

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

  const presetIds = ['monochrome', 'quiet', 'paper', 'midnight', 'forest', 'sand', 'rose', 'ocean'];
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
    <div class="lab">${lang() === 'ar' ? 'نظام الأيقونات' : 'Icon system'}</div>
    <p class="muted small">${lang() === 'ar' ? 'Phosphor Icons — Regular للأيقونات العادية وFill للحالة النشطة، بدون دوائر أو خلفيات.' : 'Phosphor Icons — Regular by default, Fill for active states, with no icon circles or backgrounds.'}</p>
    <div class="icon-preview">${['tasks', 'projects', 'finance', 'settings', 'palette', 'globe'].map((n) => badge(n, 24)).join('')}${badge('check', 24, undefined, true)}</div>
    <div class="lab">${t('font')}</div>
    <div class="fonts">${Object.entries(FONTS).map(([id, f]) =>
      `<button class="fontbtn" data-action="set-font" data-val="${id}" aria-pressed="${fontKey(th.font) === id}" style="font-family:${f.stack},system-ui">
        <b>${f.label}</b><small>${t('font_preview')}</small></button>`).join('')}</div>
    <div class="lab">${t('font_size')}</div>
    ${range('scale', 90, 120, th.scale, '%')}`;

  const targets = S.settings.financeTargets || DEFAULT_SETTINGS.financeTargets;
  const financeLabels = lang() === 'ar'
    ? { hint: 'تظل النسب الفعلية محسوبة من المبالغ المسجلة. يحدد الهدف امتلاء الحلقة فقط.', collection: 'هدف نسبة التحصيل', profit: 'هدف هامش صافي الربح' }
    : { hint: 'Actual ratios still use recorded amounts. Targets only set how quickly each ring fills.', collection: 'Collection ratio target', profit: 'Net profit margin target' };
  const financeTargetSettings = `
    <p class="muted small">${financeLabels.hint}</p>
    <div class="ratio-target-grid">
      <label>${financeLabels.collection}<span class="ratio-target-input"><input class="input" type="number" min="1" max="100" step="1" value="${targets.collection}" data-change="finance-target" data-key="collection" aria-label="${financeLabels.collection}"><b>%</b></span></label>
      <label>${financeLabels.profit}<span class="ratio-target-input"><input class="input" type="number" min="1" max="100" step="1" value="${targets.profit}" data-change="finance-target" data-key="profit" aria-label="${financeLabels.profit}"><b>%</b></span></label>
    </div>`;


  const ratioConfig = S.settings.ratioAppearance || DEFAULT_SETTINGS.ratioAppearance;
  const editorLook = ratioConfig.scope === 'perTab' ? (ratioConfig.tabs?.[S.ratioEditorContext] || ratioConfig.global) : ratioConfig.global;
  const ratioLabels = lang() === 'ar'
    ? { global: 'عام لكل التبويبات', perTab: 'تخصيص لكل تبويب', context: 'التبويب', dashboard: 'الرئيسية', projects: 'المشروعات', finance: 'المالية', style: 'شكل المؤشر', colors: 'ألوان المؤشرات', collection: 'نسبة التحصيل', profit: 'هامش صافي الربح', preview: 'معاينة مباشرة', reset: 'استعادة الافتراضي', hint: 'اختر شكلًا وألوانًا عامة أو خصصها لكل تبويب. المعاينة تستخدم نسبًا تجريبية.' }
    : { global: 'Global across tabs', perTab: 'Customize per tab', context: 'Tab', dashboard: 'Dashboard', projects: 'Projects', finance: 'Finance', style: 'Indicator shape', colors: 'Indicator colors', collection: 'Collection ratio', profit: 'Net profit margin', preview: 'Live preview', reset: 'Reset to default', hint: 'Choose a shared style and colors, or customize each tab. Preview values are examples.' };
  const ratioStyleLabels = lang() === 'ar'
    ? { ring: 'حلقة', bar: 'شريط', pill: 'كبسولة', gauge: 'عداد', blocks: 'شرائح', badge: 'شارة' }
    : { ring: 'Ring', bar: 'Bar', pill: 'Pill', gauge: 'Gauge', blocks: 'Blocks', badge: 'Badge' };
  const ratioAppearanceSettings = `
    <p class="muted small">${ratioLabels.hint}</p>
    <div class="lab">${lang() === 'ar' ? 'نطاق التخصيص' : 'Customization scope'}</div>
    ${seg('set-ratio-scope', [['global', ratioLabels.global], ['perTab', ratioLabels.perTab]], ratioConfig.scope)}
    ${ratioConfig.scope === 'perTab' ? `<label class="lab" for="ratio-editor-context">${ratioLabels.context}</label><select class="input" id="ratio-editor-context" data-change="ratio-context">${RATIO_CONTEXTS.map((context) => `<option value="${context}" ${S.ratioEditorContext === context ? 'selected' : ''}>${ratioLabels[context]}</option>`).join('')}</select>` : ''}
    <div class="lab">${ratioLabels.style}</div>
    <div class="ratio-style-options">${RATIO_STYLES.map((style) => `<button type="button" class="ratio-style-option" data-action="set-ratio-style" data-val="${style}" aria-pressed="${editorLook.style === style}"><span class="ratio-style-demo demo-${style}"></span><span>${ratioStyleLabels[style]}</span></button>`).join('')}</div>
    <div class="lab">${ratioLabels.colors}</div>
    <div class="ratio-color-grid"><label>${ratioLabels.collection}<input type="color" value="${editorLook.collectionColor}" data-input="ratio-color" data-key="collectionColor"></label><label>${ratioLabels.profit}<input type="color" value="${editorLook.profitColor}" data-input="ratio-color" data-key="profitColor"></label></div>
    <div class="lab">${ratioLabels.preview}</div><div id="ratio-live-preview" class="ratio-live-preview">${financeRing(68, lang() === 'ar' ? 'نسبة التحصيل' : 'Collection', 'large', 'collection', 100, S.ratioEditorContext)}${financeRing(25, lang() === 'ar' ? 'هامش الربح' : 'Profit margin', 'small', 'profit', 25, S.ratioEditorContext)}</div>
    <button type="button" class="btn sm" data-action="reset-ratio-appearance">${ratioLabels.reset}</button>`;


  const typography = S.settings.typography || DEFAULT_SETTINGS.typography;
  const typographySettings = `
    <p class="muted small">${lang()==='ar'?'تحكم في الفرق بين أحجام العناوين والعناصر.':'Adjust the size difference between headings and items.'}</p>
    <div class="lab">${lang()==='ar'?'العناوين الرئيسية':'Main headings'}</div>${range('type-heading',80,130,typography.heading,'%')}
    <div class="lab">${lang()==='ar'?'العناوين الفرعية':'Subheadings'}</div>${range('type-subheading',80,130,typography.subheading,'%')}
    <div class="lab">${lang()==='ar'?'العناصر والمعلومات':'Items & information'}</div>${range('type-item',80,130,typography.item,'%')}`;

  const motion = S.settings.motion || DEFAULT_SETTINGS.motion;
  const motionLabels = lang() === 'ar'
    ? { title: 'أسلوب الحركة', apple: 'Apple Smooth', smooth: 'ناعم', subtle: 'هادئ', reduced: 'تقليل الحركة', speed: 'سرعة الحركة', slow: 'بطيئة', normal: 'متوازنة', fast: 'سريعة', hint: 'تتحكم هذه الاختيارات في انتقالات الصفحات والقوائم والنوافذ والتفاعلات.' }
    : { title: 'Motion style', apple: 'Apple Smooth', smooth: 'Smooth', subtle: 'Subtle', reduced: 'Reduce motion', speed: 'Motion speed', slow: 'Slow', normal: 'Balanced', fast: 'Fast', hint: 'Controls page, list, sheet and interaction transitions.' };
  const motionSettings = `
    <p class="muted small motion-hint">${motionLabels.hint}</p>
    <div class="lab">${motionLabels.title}</div>
    ${seg('set-motion-style', [['apple', motionLabels.apple, 'sparkles'], ['smooth', motionLabels.smooth, 'move'], ['subtle', motionLabels.subtle, 'feather'], ['reduced', motionLabels.reduced, 'minus-circle']], motion.style)}
    <div class="lab">${motionLabels.speed}</div>
    ${seg('set-motion-speed', [['slow', motionLabels.slow], ['normal', motionLabels.normal], ['fast', motionLabels.fast]], motion.speed)}
    <div class="motion-preview"><span class="motion-preview-dot"></span><span>${lang() === 'ar' ? 'معاينة الحركة' : 'Motion preview'}</span></div>`;

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


  const brandS = S.settings.brand || {};
  const bf = (key, labelAr, labelEn, ph = '') => `<label class="lab" for="brand-${key}">${lang() === 'ar' ? labelAr : labelEn}</label><input class="input" id="brand-${key}" data-input="brand-field" data-key="${key}" value="${esc(brandS[key] || '')}" placeholder="${esc(ph)}" maxlength="160">`;
  const brandSettings = `
    <p class="muted small">${L('تظهر هذه البيانات في رأس وتذييل كل تقرير (فني أو مالي أو شامل أو محضر اجتماع)، والروابط قابلة للنقر داخل الـ PDF.', 'These details appear in the header and footer of every report; links are clickable inside the PDF.')}</p>
    <div class="brand-logo-row">${brandS.logo ? `<img class="brand-logo-preview" src="${esc(brandS.logo)}" alt="logo">` : `<span class="muted small">${L('لا يوجد لوجو بعد', 'No logo yet')}</span>`}
      <div class="btnrow"><button class="btn sm" type="button" data-action="brand-logo-pick">${L('رفع اللوجو', 'Upload logo')}</button>${brandS.logo ? `<button class="btn sm" type="button" data-action="brand-logo-clear">${L('إزالة', 'Remove')}</button>` : ''}</div>
      <input type="file" id="brand-logo-file" accept="image/png,image/jpeg,image/webp" hidden data-change="brand-logo"></div>
    ${bf('name', 'اسم الشركة / المكتب', 'Company / studio name')}${bf('tagline', 'وصف قصير تحت الاسم', 'Tagline')}
    ${bf('phone1', 'رقم التواصل 1', 'Phone 1', '+20 …')}${bf('phone2', 'رقم التواصل 2', 'Phone 2', '+20 …')}${bf('whatsapp', 'واتساب', 'WhatsApp', '+20 …')}
    ${bf('email', 'البريد الإلكتروني', 'Email')}${bf('website', 'الموقع', 'Website', 'example.com')}
    ${bf('instagram', 'Instagram', 'Instagram', '@username')}${bf('behance', 'Behance', 'Behance', 'username')}${bf('linkedin', 'LinkedIn', 'LinkedIn', 'username')}${bf('facebook', 'Facebook', 'Facebook', 'page')}
    ${bf('address', 'العنوان', 'Address')}`;

  return `<div class="settings">
    ${group('brand', 'user', lang() === 'ar' ? 'هوية الشركة والتقارير' : 'Company identity & reports', brandSettings)}
    ${group('appearance', 'palette', 'g_appearance', appearance)}
    ${group('finance-targets', 'finance', lang() === 'ar' ? 'تخصيص النسب المالية' : 'Finance ratio targets', financeTargetSettings)}
    ${group('ratio-appearance', 'palette', lang() === 'ar' ? 'شكل وألوان مؤشرات النسب' : 'Ratio indicator style & colors', ratioAppearanceSettings)}
    ${group('typography', 'type', lang() === 'ar' ? 'أحجام الخطوط' : 'Typography sizes', typographySettings)}
    ${group('motion', 'sparkles', lang() === 'ar' ? 'الحركة والانتقالات' : 'Motion & transitions', motionSettings)}
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
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast(t('import_bad'));
    return;
  }

  const collections = ['projects', 'deliverables', 'financeEntries', 'personalExpenses', 'personalBudgets', 'meetings'];
  if (!data || data.app !== 'weeklyplanner' || !Array.isArray(data.tasks) ||
      collections.some((key) => data[key] !== undefined && !Array.isArray(data[key])) ||
      (data.settings !== undefined && (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)))) {
    toast(t('import_bad'));
    return;
  }
  if (data.tasks.length > 5000 || collections.some((key) => (data[key]?.length || 0) > 10000)) {
    toast('ملف النسخة الاحتياطية أكبر من الحد المسموح للاستيراد.');
    return;
  }
  for (const key of collections) {
    const rows = data[key] || [];
    if (rows.some((raw) => !raw || typeof raw !== 'object' || Array.isArray(raw) ||
        typeof raw.id !== 'string' || !raw.id.trim() || raw.id.includes('/'))) {
      toast('ملف النسخة الاحتياطية يحتوي على سجل غير صالح في قسم ' + key + '. لم يتم استيراد أي بيانات.');
      return;
    }
  }
  if (!confirm('سيتم دمج بيانات النسخة الاحتياطية مع البيانات الحالية. السجلات التي لها نفس المعرّف سيتم تحديثها، ولن يتم حذف أي سجل غير موجود في الملف. هل تريد المتابعة؟')) return;

  let imported = 0;
  try {
    // Sequential awaited writes prevent the UI from reporting success while task writes are still pending.
    for (const raw of data.tasks) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const task = normalizeTask(raw, false);
      if (!task.title) continue;
      await S.store.save('tasks', task);
      imported++;
    }
    for (const key of collections) {
      for (const raw of (data[key] || [])) {
        await S.store.save(key, raw);
        imported++;
      }
    }
    if (data.settings && typeof data.settings === 'object') {
      S.settings = mergeSettings(data.settings);
      applySettings(false);
      await S.store.save('settings', S.settings);
    }
    toast(t('import_ok', { n: imported }));
    render();
  } catch (err) {
    toast(`تم استيراد ${imported} سجل قبل توقف العملية. لم يتم حذف البيانات الحالية. سبب التوقف: ${err.message || err}`);
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

// نقل المهام بالسحب بعد الضغط المطوّل (يدعم اللمس والماوس)
let taskDragState = null;
let taskDragTimer = null;
let taskDragGhost = null;
let suppressTaskClickUntil = 0;

function clearTaskDrag() {
  if (taskDragTimer) clearTimeout(taskDragTimer);
  taskDragTimer = null;
  taskDragGhost?.remove();
  taskDragGhost = null;
  taskDragState = null;
}

function beginTaskDrag() {
  if (!taskDragState || taskDragState.started) return;
  taskDragState.started = true;
  const task = S.tasks.find(x => x.id === taskDragState.taskId);
  if (!task) { clearTaskDrag(); return; }
  taskDragGhost = document.createElement('div');
  taskDragGhost.className = 'task-drag-ghost';
  taskDragGhost.textContent = task.title;
  taskDragGhost.style.left = (taskDragState.x + 12) + 'px';
  taskDragGhost.style.top = (taskDragState.y + 12) + 'px';
  document.body.appendChild(taskDragGhost);
  document.body.classList.add('task-dragging');
}

function openTaskDropChoice(taskId, date) {
  const task = S.tasks.find(x => x.id === taskId);
  if (!task || !date || task.date === date) return;
  S.taskDropPending = { taskId, date };
  $('#layer').innerHTML = `
    <div class="overlay" data-action="task-drop-overlay">
      <section class="sheet glass task-drop-sheet" role="dialog" aria-modal="true" aria-label="نقل أو نسخ المهمة">
        <div class="sheet-head"><h2>نقل المهمة</h2><button class="btn icon-btn" data-action="task-drop-cancel" aria-label="إغلاق">${icon('close',18)}</button></div>
        <p class="muted">«${esc(task.title)}»</p>
        <p>اليوم المحدد: <b>${esc(D.fmt(date, locale(), { weekday:'long', day:'numeric', month:'long' }))}</b></p>
        <div class="sheet-actions task-drop-actions">
          <button class="btn" data-action="task-drop-cancel">إلغاء</button>
          <button class="btn" data-action="task-drop-copy">نسخ المهمة</button>
          <button class="btn primary" data-action="task-drop-move">نقل المهمة</button>
        </div>
      </section>
    </div>`;
}

async function applyTaskDrop(mode) {
  const pending = S.taskDropPending;
  const source = pending && S.tasks.find(x => x.id === pending.taskId);
  if (!source || !pending?.date || !['move','copy'].includes(mode)) { closeTaskDropChoice(); return; }
  const now = Date.now();
  const task = mode === 'copy'
    ? normalizeTask({ ...source, id: uid(), date: pending.date, weekRef: pending.date, status: 'todo', doneAt: null, createdAt: now, updatedAt: now })
    : normalizeTask({ ...source, date: pending.date, weekRef: pending.date, updatedAt: now });
  try {
    await S.store.save('tasks', task);
    closeTaskDropChoice();
    S.week = D.weekStartOf(pending.date, startDay());
    S.sel = pending.date;
    toast(mode === 'copy' ? 'تم نسخ المهمة إلى اليوم المحدد.' : 'تم نقل المهمة إلى اليوم المحدد.');
    render();
  } catch (err) {
    toast('تعذر حفظ التغيير: ' + (err.message || err));
  }
}

function closeTaskDropChoice() {
  S.taskDropPending = null;
  $('#layer').innerHTML = '';
}

function bindTaskDragEvents() {
  document.addEventListener('pointerdown', e => {
    const body = e.target.closest('.task .tbody[data-id]');
    if (!body || e.button > 0) return;
    clearTaskDrag();
    taskDragState = { taskId: body.dataset.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, started: false };
    taskDragTimer = setTimeout(beginTaskDrag, 420);
  });
  document.addEventListener('pointermove', e => {
    if (!taskDragState || e.pointerId !== taskDragState.pointerId) return;
    taskDragState.x = e.clientX; taskDragState.y = e.clientY;
    if (!taskDragState.started && Math.hypot(e.clientX-taskDragState.startX, e.clientY-taskDragState.startY) > 12) { clearTaskDrag(); return; }
    if (taskDragState.started) {
      e.preventDefault();
      if (taskDragGhost) { taskDragGhost.style.left = (e.clientX+12)+'px'; taskDragGhost.style.top = (e.clientY+12)+'px'; }
      document.querySelectorAll('.dpill.drop-target, .day.drop-target').forEach(x => x.classList.remove('drop-target'));
      const target = document.elementFromPoint(e.clientX,e.clientY)?.closest('.dpill[data-date], .day[data-day]');
      if (target && (target.dataset.date || target.dataset.day)) target.classList.add('drop-target');
    }
  }, { passive: false });
  document.addEventListener('pointerup', e => {
    if (!taskDragState || e.pointerId !== taskDragState.pointerId) return;
    const state = taskDragState;
    if (taskDragTimer) clearTimeout(taskDragTimer);
    taskDragTimer = null;
    if (state.started) {
      e.preventDefault();
      suppressTaskClickUntil = Date.now()+700;
      const target = document.elementFromPoint(e.clientX,e.clientY)?.closest('.dpill[data-date], .day[data-day]');
      const date = target?.dataset.date || target?.dataset.day || '';
      clearTaskDrag();
      document.body.classList.remove('task-dragging');
      document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
      if (date) openTaskDropChoice(state.taskId,date);
    } else clearTaskDrag();
  }, { passive: false });
  document.addEventListener('pointercancel', () => { clearTaskDrag(); document.body.classList.remove('task-dragging'); document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target')); });
}

// ================================================================== الأحداث
function bindEvents() {
  // Block two-finger browser zoom while preserving one-finger scrolling.
  const stopPinch = event => { if (event.cancelable) event.preventDefault(); };
  document.addEventListener('gesturestart', stopPinch, { passive: false });
  document.addEventListener('gesturechange', stopPinch, { passive: false });
  document.addEventListener('gestureend', stopPinch, { passive: false });
  document.addEventListener('touchmove', event => { if (event.touches && event.touches.length > 1) stopPinch(event); }, { passive: false });
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target?.id === 'mgr-text') { e.preventDefault(); managerRun(e.target.value); } });
  let swipeStart = null;
  document.addEventListener('touchstart', e => {
    const touch = e.changedTouches?.[0];
    if (touch && (touch.clientX < 28 || touch.clientX > window.innerWidth - 28)) swipeStart = { x: touch.clientX, y: touch.clientY };
    else swipeStart = null;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const touch = e.changedTouches?.[0], start = swipeStart; swipeStart = null;
    if (!touch || !start || !S.activeProjectId) return;
    const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
    if (Math.abs(dx) > 76 && Math.abs(dy) < 52) { S.activeProjectId = null; S.animateNextRender = true; render(); window.scrollTo(0, 0); }
  }, { passive: true });
  let panelDrag = null;
  document.addEventListener('touchstart', e => {
    if (!S.projectPanel || !e.target.closest('.panel-grip, .panel-head')) return;
    const sheet = $('#panel .panel-sheet'); if (!sheet) return;
    panelDrag = { y: e.touches[0].clientY, dy: 0, sheet }; sheet.style.transition = 'none';
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!panelDrag) return;
    panelDrag.dy = Math.max(0, e.touches[0].clientY - panelDrag.y);
    panelDrag.sheet.style.transform = 'translateY(' + panelDrag.dy + 'px)';
  }, { passive: true });
  const endPanelDrag = () => {
    if (!panelDrag) return;
    const { sheet, dy } = panelDrag; panelDrag = null;
    sheet.style.transition = '';
    if (dy > 90) { closeProjectPanel(); }
    sheet.style.transform = '';
  };
  document.addEventListener('touchend', endPanelDrag, { passive: true });
  document.addEventListener('touchcancel', endPanelDrag, { passive: true });
  bindTaskDragEvents();
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if ((a === 'overlay' || a === 'task-drop-overlay') && e.target !== el) return;
  if (a === 'edit' && Date.now() < suppressTaskClickUntil) return;
  if (a === 'toast-action') return;
  const v = el.dataset.val;


  switch (a) {
    case 'reload': location.reload(); break;
    case 'login': {
      const btn = $('#login-btn');
      btn.disabled = true; btn.textContent = t('signing_in');
      try {
        const r = await S.store.signIn();
        // إلغاء أو عدم اكتمال الدخول: نعيد الزر لوضعه الطبيعي بدل تركه معلّقًا على «جارٍ الدخول…».
        if (r && r.cancelled) renderLogin(r.message || 'لم يكتمل تسجيل الدخول. حاول مرة أخرى.');
      }
      catch (err) { console.error(err); renderLogin(`${t('signin_failed')}: ${err.code || err.message || err}`); }
      break;
    }
    case 'auth-toggle': S.authMode=S.authMode==='signup'?'signin':'signup'; renderLogin(); break;
    case 'auth-reset': { const email=$('#auth-email')?.value.trim(); if(!email){toast('اكتب بريدك الإلكتروني أولًا.');break;} try{await S.store.resetPassword(email);toast('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك.');}catch(err){toast(err.message||'تعذر إرسال الرابط.');} break; }
    case 'login-lang': updateSettings({ lang: lang() === 'ar' ? 'en' : 'ar' }, { render: false }); renderLogin(); break;
    case 'nav': closeProjectPanel(true); S.section = el.dataset.section; S.navOpenSection = el.dataset.section; S.activeProjectId = null; S.activeMeetingProjectId = null; S.animateNextRender = true; render(); window.scrollTo(0, 0); break;
    case 'nav-expand': S.navOpenSection=S.navOpenSection===el.dataset.section?'':el.dataset.section; if(!S.navExpanded){S.navExpanded=true;localStorage.setItem('wp1:nav-expanded','1');} render(); break;
    case 'nav-collapse': S.navExpanded=!S.navExpanded; localStorage.setItem('wp1:nav-expanded',S.navExpanded?'1':'0'); render(); break;
    case 'brand-logo-pick': $('#brand-logo-file')?.click(); break;
    case 'brand-logo-clear': updateSettings({ brand: { ...(S.settings.brand || {}), logo: '' } }); break;
    case 'link-add': { const pr = S.projects.find((x) => x.id === el.dataset.id); const url = safeHttpUrl(($('#link-url')?.value || '').trim()); const title = ($('#link-title')?.value || '').trim() || (url && new URL(url).hostname);
      if (!pr) break; if (!url) { toast(L('اكتب رابطًا صحيحًا يبدأ بـ https', 'Enter a valid https link')); break; }
      S.store.save('projects', { ...pr, links: [...(pr.links || []), { id: uid(), title: title.slice(0, 120), url }], updatedAt: Date.now() }).then(() => { toast(L('تمت إضافة الرابط.', 'Link added.')); refreshProjectPanel?.(); render(); }); break; }
    case 'link-del': { const pr = S.projects.find((x) => x.id === el.dataset.id); if (!pr) break;
      S.store.save('projects', { ...pr, links: (pr.links || []).filter((l) => l.id !== el.dataset.link), updatedAt: Date.now() }).then(() => { refreshProjectPanel?.(); render(); }); break; }
    case 'scope-preset': { const on = new Set(el.dataset.scopes.split(',')); document.querySelectorAll('input[name="p-scope"]').forEach((c) => { c.checked = on.has(c.value); }); break; }
    case 'mgr-open': openManagerSheet(); break;
    case 'mgr-view': openManagerSheet(el.dataset.view); break;
    case 'mgr-run': managerRun($('#mgr-text')?.value || ''); break;
    case 'mgr-mic': startManagerMic(); break;
    case 'mgr-ai': managerAiAdvice(); break;
    case 'wa-open': openWhatsAppSheet(el.dataset.id || S.activeProjectId); break;
    case 'wa-analyze': waAnalyze(); break;
    case 'wa-refilter': waRenderCandidates(); break;
    case 'wa-save': waSave().catch((err) => toast(err.message || String(err))); break;
    case 'voice-open': openVoiceSheet(); break;
    case 'capture-open': openCaptureSheet(S.activeProjectId || undefined); break;
    case 'open-more': openMoreSheet(); break;
    case 'more-go': { $('#layer').innerHTML = ''; closeProjectPanel(true); if (el.dataset.section === 'settings') { S.prevSection = S.section; S.section = 'settings'; } else { S.section = el.dataset.section; S.navOpenSection = el.dataset.section; } S.activeProjectId = null; S.activeMeetingProjectId = null; S.animateNextRender = true; render(); window.scrollTo(0, 0); break; }
    case 'cap-wa': { const pid = $('#cap-project')?.value; if (!pid) { toast(L('اختر مشروعًا أولًا.', 'Pick a project first.')); break; } openWhatsAppSheet(pid); break; }
    case 'capture-analyze': {
      const text = $('#voice-text')?.value.trim(); const pid = $('#cap-project')?.value;
      if (!text) { toast(t('voice_empty')); break; }
      const project = S.projects.find((x) => x.id === pid); if (!project) { toast(L('اختر مشروعًا أولًا.', 'Pick a project first.')); break; }
      S.capture = { projectId: pid, text, actions: parseCaptureActions(text, { project, deliverables: S.deliverables }).map((a) => ({ ...a, on: a.kind !== 'payment' })) };
      renderCaptureReview(); break;
    }
    case 'capture-back': openCaptureSheet(S.capture?.projectId, S.capture?.text || ''); break;
    case 'capture-toggle': { syncCaptureInputs(); const a = S.capture?.actions.find((x) => x.id === el.dataset.id); if (a) { a.on = el.dataset.on === '1'; renderCaptureReview(); } break; }
    case 'capture-as-task': {
      const c = S.capture; if (!c) break; const today = D.todayISO();
      try { await S.store.save('tasks', normalizeTask({ id: uid(), title: c.text.length > 90 ? c.text.slice(0, 87) + '…' : c.text, notes: c.text, date: today, weekRef: today, priority: 2, status: 'todo', projectId: c.projectId, createdAt: Date.now(), updatedAt: Date.now() })); toast(L('تم حفظ المهمة.', 'Task saved.')); $('#layer').innerHTML = ''; S.capture = null; render(); }
      catch (err) { toast(t('save_failed', { msg: err.message || err })); }
      break;
    }
    case 'capture-save': {
      syncCaptureInputs(); const c = S.capture; const project = S.projects.find((x) => x.id === c?.projectId); if (!c || !project) break;
      const picked = c.actions.filter((a) => a.on); if (!picked.length) break;
      const bad = picked.find((a) => a.kind === 'payment' && !(Number(a.amount) > 0)); if (bad) { toast(L('اكتب مبلغ الدفعة قبل الحفظ.', 'Enter the payment amount first.')); break; }
      el.disabled = true; const done = [], failed = [];
      for (const a of picked) { try { const line = await applyCaptureAction(a, project); if (line) done.push(line); } catch (err) { failed.push(err.message || String(err)); } }
      try { await saveCaptureSummaryTask(project, done); } catch (err) { failed.push(err.message || String(err)); }
      $('#layer').innerHTML = ''; S.capture = null;
      toast(failed.length ? L(`تم حفظ ${done.length} وتعذّر ${failed.length}: ${failed[0]}`, `Saved ${done.length}, ${failed.length} failed: ${failed[0]}`) : L(`تم حفظ ${done.length} إجراءات.`, `${done.length} action(s) saved.`));
      render(); break;
    }
    case 'td-remind': {
      const text = remindText(el.dataset.kind, el.dataset.id, el.dataset.project); if (!text) break;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); break;
    }
    case 'deliverable-rev': { const d = S.deliverables.find((x) => x.id === el.dataset.id); if (!d) break; S.store.save('deliverables', { ...d, rev: (Number(d.rev) || 1) + 1, status: 'pending', submittedAt: null, updatedAt: Date.now() }).then(() => { toast(L('تم فتح نسخة جديدة.', 'New version opened.')); refreshProjectPanel(); }).catch((err) => toast(t('save_failed', { msg: err.message || err }))); break; }
    case 'voice-start': startVoiceRecognition(); break;
    case 'close-voice': $('#layer').innerHTML=''; break;
    case 'finance-view': S.financeView=v; render(); break;
    case 'show-projects': S.showArchivedProjects=v==='archived'; render(); break;
    case 'archive-project': {
      const project=S.projects.find(p=>p.id===el.dataset.id); if(!project)break;
      const archivedAt=project.archivedAt?null:Date.now();
      const updated={...project,archivedAt,updatedAt:Date.now()};
      try{await S.store.save('projects',updated);S.projects=S.projects.map(p=>p.id===updated.id?updated:p);toast(archivedAt?'تمت أرشفة المشروع ويمكنك إعادته من الأرشيف.':'تمت إعادة المشروع من الأرشيف.');render();}
      catch(err){toast(t('save_failed',{msg:err.message||err}));}
      break;
    }
    case 'toggle-installment-paid': {
      const project=S.projects.find(p=>p.id===el.dataset.id);const installment=(project?.installments||[]).find(x=>x.id===el.dataset.installmentId);if(!project||!installment)break;
      const entryId=`installment_${installment.id}`;
      try{
        if(installment.status==='paid'){
          if(!confirm('سيُحذف قيد التحصيل المرتبط بهذه الدفعة من ماليات المشروع. هل تريد التراجع؟'))break;
          const updated={...project,installments:project.installments.map(x=>x.id===installment.id?{...x,status:'pending',paidAt:null}:x),updatedAt:Date.now()};
          await S.store.save('projects',updated);
          try{if(S.financeEntries.some(x=>x.id===entryId))await S.store.remove('financeEntries',entryId);}catch(err){await S.store.save('projects',project);throw err;}
          S.projects=S.projects.map(p=>p.id===updated.id?updated:p);toast('تم إلغاء تسجيل التحصيل.');render();
        } else {
          await S.store.save('financeEntries',{id:entryId,projectId:project.id,kind:'income',amount:Number(installment.amount)||0,date:D.todayISO(),category:'دفعة تعاقد',description:`تحصيل دفعة: ${installment.title||'دفعة'}`,installmentId:installment.id,createdAt:Date.now()});
          const updated={...project,installments:project.installments.map(x=>x.id===installment.id?{...x,status:'paid',paidAt:D.todayISO()}:x),updatedAt:Date.now()};
          try{await S.store.save('projects',updated);}catch(err){await S.store.remove('financeEntries',entryId);throw err;}
          S.projects=S.projects.map(p=>p.id===updated.id?updated:p);toast('تم تسجيل الدفعة في ماليات المشروع.');render();
        }
      }catch(err){if(installment.status!=='paid')await S.store.remove('financeEntries',entryId).catch(()=>{});toast(t('save_failed',{msg:err.message||err}));}
      break;
    }
    case 'delete-installment': {
      const project=S.projects.find(p=>p.id===el.dataset.id);const installment=(project?.installments||[]).find(x=>x.id===el.dataset.installmentId);if(!project||!installment)break;
      if(!confirm(installment.status==='paid'?'حذف الدفعة سيحذف قيد التحصيل المرتبط بها أيضًا. هل تريد المتابعة؟':'حذف هذه الدفعة؟'))break;
      try{const updated={...project,installments:project.installments.filter(x=>x.id!==installment.id),updatedAt:Date.now()};await S.store.save('projects',updated);try{if(installment.status==='paid')await S.store.remove('financeEntries',`installment_${installment.id}`);}catch(err){await S.store.save('projects',project);throw err;}S.projects=S.projects.map(p=>p.id===updated.id?updated:p);toast('تم حذف الدفعة.');render();}catch(err){toast(t('save_failed',{msg:err.message||err}));}
      break;
    }
    case 'clear-project-followup': {
      const project=S.projects.find(p=>p.id===el.dataset.id);if(!project)break;
      const updated={...project,followUpDate:null,followUpNote:'',updatedAt:Date.now()};try{await S.store.save('projects',updated);S.projects=S.projects.map(p=>p.id===updated.id?updated:p);toast('تم مسح متابعة العميل.');render();}catch(err){toast(t('save_failed',{msg:err.message||err}));}break;
    }
    case 'edit-personal-expense': editPersonalExpense(el.dataset.id); break;
    case 'delete-personal-expense': if(confirm('حذف الحركة الشخصية؟')) { await S.store.remove('personalExpenses',el.dataset.id); toast('تم حذف الحركة.'); } break;
    case 'print-project': openPrintChoice(el.dataset.id); break;
    case 'print-full': $('#layer').innerHTML=''; printProjectFullReport(el.dataset.id); break;
    case 'print-client': $('#layer').innerHTML=''; printClientReport(el.dataset.id); break;
    case 'doc-open': openDocSheet(el.dataset.id); break;
    case 'doc-generate': generateDocument(); break;
    case 'print-status': $('#layer').innerHTML=''; printProjectReport(el.dataset.id,'status'); break;
    case 'print-finance': $('#layer').innerHTML=''; printProjectReport(el.dataset.id,'finance'); break;
    case 'meeting-view': S.meetingView=v; render(); break;
    case 'meeting-new': { const panel=$('#meeting-new-details'); if(panel){panel.open=!panel.open;if(panel.open){panel.scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>$('#meeting-project')?.focus({preventScroll:true}),180);}} break; }
    case 'meeting-week-prev': S.meetingWeek=D.addDays(S.meetingWeek,-7); render(); break;
    case 'meeting-week-next': S.meetingWeek=D.addDays(S.meetingWeek,7); render(); break;
    case 'meeting-week-today': S.meetingWeek=D.weekStartOf(D.todayISO(),startDay()); render(); break;
    case 'meeting-ai-transcribe': try{await transcribeMeetingAudio(el.dataset.id);}catch(err){console.error(err);toast(err.message||'تعذر تفريغ التسجيل.');} break;
    case 'meeting-ai-minutes': try{await generateMeetingMinutes(el.dataset.id);}catch(err){console.error(err);toast(err.message||'تعذر إنشاء المحضر.');} break;
    case 'meeting-audio-start': await startMeetingAudioCapture(); break;
    case 'meeting-audio-stop': stopMeetingAudioCapture(); break;
    case 'meeting-audio-play': try{await openMeetingAudio(el.dataset.id,false);}catch(err){console.error(err);toast(err.message||'تعذر تشغيل التسجيل.');} break;
    case 'meeting-audio-download': try{await openMeetingAudio(el.dataset.id,true);}catch(err){console.error(err);toast(err.message||'تعذر تنزيل التسجيل.');} break;
    case 'meeting-audio-delete': try{await deleteMeetingAudio(el.dataset.id);}catch(err){console.error(err);toast(err.message||'تعذر حذف التسجيل.');} break;
    case 'meeting-record': startMeetingRecognition(); break;
    case 'meeting-stop': if(S.meetingRecognition){S.meetingRecognition.stop();S.meetingRecognition=null;} break;
    case 'meeting-project': S.activeMeetingProjectId=el.dataset.id; render(); break;
    case 'meeting-print': printMeetingReport(el.dataset.id); break;
    case 'meeting-back': S.activeMeetingProjectId=null; render(); break;
    case 'voice-save': { const text=$('#voice-text')?.value.trim(); if(!text){toast(t('voice_empty'));break;} const c=inferVoiceCommand(text); try { await handleVoiceCommand(c); } catch(err) { console.error(err); toast(t('save_failed',{msg:err.message||err})); } break; }
    case 'new-project': openProjectSheet(); break;
    case 'edit-project': openProjectSheet(el.dataset.id); break;
    case 'open-project': S.activeProjectId = el.dataset.id; S.section='projects'; S.navOpenSection='projects'; S.animateNextRender=true; render(); window.scrollTo(0,0); break;
    case 'toggle-project': closeProjectPanel(true); S.activeProjectId = S.activeProjectId === el.dataset.id ? null : el.dataset.id; S.animateNextRender = true; render(); break;
    case 'open-panel': S.activeProjectId = el.dataset.id; openProjectPanel(el.dataset.id, el.dataset.panel); break;
    case 'close-panel': closeProjectPanel(); break;
    case 'projects-back': closeProjectPanel(true); S.activeProjectId = null; S.animateNextRender=true; render(); window.scrollTo(0,0); break;
    case 'toggle-task-details': S.expandedTaskId = S.expandedTaskId === el.dataset.id ? null : el.dataset.id; render(); break;
    case 'toggle-finance-project': S.expandedFinanceProjectId = S.expandedFinanceProjectId === el.dataset.id ? null : el.dataset.id; render(); break;
    case 'toggle-finance-summary': S.expandedFinanceSummary = !S.expandedFinanceSummary; render(); break;
    case 'scroll-deliverable-form': { const pid = S.activeProjectId; if (pid) { if (!S.projectPanel || S.projectPanel.panel !== 'deliverables') openProjectPanel(pid, 'deliverables'); setTimeout(() => $('#d-name')?.focus({ preventScroll: true }), panelDuration() + 60); } break; }
    case 'delete-project': { const p=S.projects.find(x=>x.id===el.dataset.id); if(p && confirm(t('confirm_delete_project'))) { for(const d of S.deliverables.filter(x=>x.projectId===p.id)) await S.store.remove('deliverables',d.id); for(const f of S.financeEntries.filter(x=>x.projectId===p.id)) await S.store.remove('financeEntries',f.id); for(const m of S.meetings.filter(x=>x.projectId===p.id)) await S.store.remove('meetings',m.id); for(const r of S.requirements.filter(x=>x.projectId===p.id)) await S.store.remove('requirements',r.id); await S.store.remove('projects',p.id); S.activeProjectId=null; toast(t('project_deleted_ok')); render(); } break; }
    case 'delete-deliverable': if(confirm(t('confirm_delete'))) { await S.store.remove('deliverables',el.dataset.id); toast(t('deleted')); } break;
    case 'delete-finance': if(confirm(t('confirm_delete'))) { const entry=S.financeEntries.find(x=>x.id===el.dataset.id),project=entry?.installmentId?S.projects.find(p=>p.id===entry.projectId):null;try{if(project){const updated={...project,installments:(project.installments||[]).map(x=>x.id===entry.installmentId?{...x,status:'pending',paidAt:null}:x),updatedAt:Date.now()};await S.store.save('projects',updated);try{await S.store.remove('financeEntries',el.dataset.id);}catch(err){await S.store.save('projects',project);throw err;}S.projects=S.projects.map(p=>p.id===updated.id?updated:p);}else await S.store.remove('financeEntries',el.dataset.id);toast(t('deleted'));render();}catch(err){toast(t('save_failed',{msg:err.message||err}));} } break;
    case 'open-settings': S.prevSection = S.section; S.section = 'settings'; render(); window.scrollTo(0, 0); break;
    case 'back': S.section = S.prevSection || 'today'; render(); break;

    case 'week-prev': S.week = D.addDays(S.week, -7); S.sel = S.week; render(); break;
    case 'week-next': S.week = D.addDays(S.week, 7); S.sel = S.week; render(); break;
    case 'week-today': S.sel = D.todayISO(); S.week = D.weekStartOf(S.sel, startDay()); render(); break;
    case 'pick-day': S.sel = el.dataset.date; render(); break;

    case 'add': openSheet(null, el.dataset.date); break;
    case 'edit': openSheet(el.dataset.id); break;
    case 'toggle': toggleTask(el.dataset.id); break;
    case 'dashboard-task-done': {
      const task = S.tasks.find(x => x.id === el.dataset.id);
      if (task && task.status !== 'done') { toggleTask(task.id); toast(lang()==='ar'?'تم إنجاز المهمة بنجاح.':'Task marked as done.'); }
      break;
    }
    case 'carry': carryTask(el.dataset.id); toast(t('carried')); break;
    case 'carry-all': {
      const curWs = D.weekStartOf(D.todayISO(), startDay());
      S.tasks.filter((x) => !isDone(x) && weekOfTask(x) < curWs).forEach((x) => carryTask(x.id));
      toast(t('carried')); break;
    }

    case 'task-drop-move': await applyTaskDrop('move'); break;
    case 'task-drop-copy': await applyTaskDrop('copy'); break;
    case 'task-drop-overlay':
    case 'task-drop-cancel': closeTaskDropChoice(); break;
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
    case 'set-ratio-scope': updateSettings({ ratioAppearance: { ...(S.settings.ratioAppearance || DEFAULT_SETTINGS.ratioAppearance), scope: v === 'perTab' ? 'perTab' : 'global' } }); break;
    case 'set-ratio-style': updateRatioLook('style', RATIO_STYLES.includes(v) ? v : 'ring'); break;
    case 'reset-ratio-appearance': {
      const current = S.settings.ratioAppearance || DEFAULT_SETTINGS.ratioAppearance;
      const next = { ...current, global: { ...current.global }, tabs: { ...current.tabs } };
      if (current.scope === 'perTab') next.tabs[S.ratioEditorContext] = { ...DEFAULT_RATIO_LOOK };
      else next.global = { ...DEFAULT_RATIO_LOOK };
      updateSettings({ ratioAppearance: next }); break;
    }
    case 'set-motion-style': updateSettings({ motion: { ...(S.settings.motion || DEFAULT_SETTINGS.motion), style: v } }); break;
    case 'set-motion-speed': updateSettings({ motion: { ...(S.settings.motion || DEFAULT_SETTINGS.motion), speed: v } }); break;
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
      const p = PRESETS.monochrome;
      updateTheme((x) => {
        x.preset = 'monochrome'; x.accent = p.accent; x.sat = 0;
        x.bg = { ...p.bg }; x.text = { light: null, dark: null }; x.surface = 'tint';
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
    case 'signout': S.section = 'today'; await S.store.signOut(); break;
    default: break;
  }
}


async function onSubmit(e) {
const el = e.target.closest('form[data-action]'); if (!el) return; const a = el.dataset.action; if (!['save-project','add-requirement','add-deliverable','add-finance','save-personal-budget','add-personal-expense','edit-personal-expense','auth-email','save-meeting','update-meeting','add-installment','save-project-followup'].includes(a)) return; e.preventDefault(); if (!el.reportValidity()) return; const submitBtn=el.querySelector('[type=submit]'); if(submitBtn?.disabled)return; if(submitBtn){submitBtn.disabled=true;submitBtn.dataset.oldText=submitBtn.textContent;submitBtn.textContent='جارٍ الحفظ…';} try {
    if (a === 'auth-email') { const email=$('#auth-email').value.trim(), password=$('#auth-password').value; if(S.authMode==='signup') await S.store.signUpEmail(email,password); else await S.store.signInEmail(email,password); toast(S.authMode==='signup'?'تم إنشاء الحساب.':'تم تسجيل الدخول.'); }
    else if (a === 'save-project') { const old=S.projects.find(x=>x.id===el.dataset.id); const p={ id:old?.id||uid(), name:$('#p-name').value.trim(), type:$('#p-type').value, status:$('#p-status').value, client:$('#p-client').value.trim(), location:$('#p-location').value.trim(), contractValue:Number($('#p-contract').value)||0, revisionsIncluded:($('#p-revs')?.value===''||!$('#p-revs'))?(old?.revisionsIncluded??null):Math.max(0,Math.floor(Number($('#p-revs').value)||0)), startDate:$('#p-start').value||null, endDate:$('#p-end').value||null, notes:$('#p-notes').value.trim(), workScope:[...el.querySelectorAll('[name="p-scope"]:checked')].map(x=>x.value), archivedAt:old?.archivedAt||null, installments:Array.isArray(old?.installments)?old.installments:[], followUpDate:old?.followUpDate||null, followUpNote:old?.followUpNote||'', createdAt:old?.createdAt||Date.now(), updatedAt:Date.now() }; const duplicate=S.projects.find(x=>x.id!==p.id&&x.name.trim().toLocaleLowerCase()===p.name.trim().toLocaleLowerCase());
      if(duplicate) {
        const openExisting=confirm(`يوجد مشروع باسم «${duplicate.name}» بالفعل. اضغط موافق لفتح المشروع الموجود، أو إلغاء لمراجعة خيار إنشاء نسخة أخرى.`);
        if(openExisting){S.activeProjectId=duplicate.id;closeSheet();render();return;}
        if(!confirm('هل تريد رغم ذلك إنشاء مشروع آخر بنفس الاسم؟')){toast('تم إلغاء الحفظ لتجنب التكرار.');return;}
      }
      await S.store.save('projects',p); S.activeProjectId=p.id; closeSheet(); toast(old?'تم تحديث المشروع بنجاح.':'تم إنشاء المشروع بنجاح.'); render(); }
    else if (a === 'update-meeting') {
      const old=S.meetings.find(m=>m.id===el.dataset.id);if(!old)throw new Error('الاجتماع غير موجود.');
      const field=name=>el.querySelector('[name="'+name+'"]')?.value.trim()||'';
      const client=field('client');
      const updated={...old,title:field('title')||old.title,client,secondParty:client||old.secondParty||'',transcript:field('transcript'),requirements:field('requirements'),minutes:field('minutes'),decisions:field('decisions'),actions:field('actions'),purpose:field('purpose'),topics:field('topics'),participants:field('participants'),aiReviewRequired:false,updatedAt:Date.now()}; await S.store.save('meetings',updated); await syncMeetingRequirements(updated,updated.requirements);
      toast('تم حفظ تعديلات محضر الاجتماع.');render();
    }
    else if (a === 'save-meeting') {
      const existingProjectId=$('#meeting-project').value;
      const newProjectName=$('#meeting-new-project').value.trim();
      let project=S.projects.find(p=>p.id===existingProjectId); if(!project&&!newProjectName){const spoken=[$('#meeting-title').value,$('#meeting-transcript').value,$('#meeting-client').value].join(' ').toLocaleLowerCase();const matches=S.projects.filter(p=>p.name&&spoken.includes(p.name.toLocaleLowerCase()));if(matches.length===1)project=matches[0];else if(matches.length>1)throw new Error('ظهر أكثر من مشروع في نص الاجتماع. اختر المشروع الصحيح يدويًا.');}
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
      const transcript=$('#meeting-transcript').value.trim(); const firstParty=$('#meeting-first-party')?.value.trim()||S.user?.displayName||S.user?.name||S.user?.email||''; const secondParty=$('#meeting-client').value.trim()||project.client||''; const title=$('#meeting-title').value.trim(); let category=$('#meeting-category')?.value||'general'; if(category==='general'){const hay=(title+' '+transcript).toLocaleLowerCase();if(/shop.?draw|شوب|لوح(ة|ات)|تنفيذي/.test(hay))category='shop-drawings';else if(/3d|design|تصميم|رندر|موديل/.test(hay))category='design';else if(/site|موقع|تنفيذ|استلام/.test(hay))category='site';else if(/color|colour|خامة|خامات|لون|ألوان|الوان/.test(hay))category='materials';else if(/اعتماد|موافقة|عميل|ملاحظات العميل/.test(hay))category='client-review';} const meeting={id:S.nativeMeetingDraftId||uid(),projectId:project.id,sequence,title:title||`Meeting ${String(sequence).padStart(2,'0')}`,category,client:secondParty,firstParty,secondParty,date,time:$('#meeting-time').value||'',mode:$('#meeting-mode').value,participants:$('#meeting-participants').value.trim(),purpose:$('#meeting-purpose')?.value.trim()||'',topics:$('#meeting-topics')?.value.trim()||'',transcript,requirements:$('#meeting-requirements').value.trim(),minutes:$('#meeting-minutes').value.trim(),decisions:$('#meeting-decisions').value.trim(),actions:$('#meeting-actions').value.trim(),language:($('#meeting-language')?.value||'ar-EG').startsWith('en')?'en':'ar',audioFileName:S.nativeMeetingFileName||null,hasAudio:!!(S.nativeMeetingFileName||S.pendingMeetingAudio),createdAt:Date.now(),updatedAt:Date.now()};
      await S.store.save('meetings',meeting);
      await syncMeetingRequirements(meeting,meeting.requirements);
      let savedMeeting=meeting;
      if(S.pendingMeetingAudio){await saveMeetingAudio(meeting.id,S.pendingMeetingAudio);S.pendingMeetingAudio=null;savedMeeting={...meeting,hasAudio:true,updatedAt:Date.now()};await S.store.save('meetings',savedMeeting);}
      S.meetings=[...S.meetings.filter(m=>m.id!==savedMeeting.id),savedMeeting];
      const autoProcess=S.autoProcessMeetingAfterSave;S.autoProcessMeetingAfterSave=false;
      S.nativeMeetingDraftId=null; S.nativeMeetingFileName=null;
      toast(`تم حفظ Meeting ${String(sequence).padStart(2,'0')} في مشروع ${project.name}.`);
      el.reset(); $('#meeting-date').value=D.todayISO(); render();
      if(autoProcess){try{await transcribeMeetingAudio(savedMeeting.id);await generateMeetingMinutes(savedMeeting.id);}catch(processError){toast('تم حفظ الاجتماع والتسجيل، لكن تعذر إكمال التفريغ أو إعداد المحضر: '+(processError.message||processError));}}
    }
    else if (a === 'save-personal-budget') { const amount=Number($('#personal-budget').value); if(amount<0||!Number.isFinite(amount)) throw new Error('أدخل ميزانية صحيحة'); const month=S.expenseMonth; await S.store.save('personalBudgets',{id:month,amount,updatedAt:Date.now()}); toast('تم حفظ الميزانية.'); }
    else if (a === 'add-installment') { const project=S.projects.find(x=>x.id===el.dataset.id);if(!project)throw new Error('المشروع غير موجود.');const amount=Number($('#installment-amount').value),title=$('#installment-title').value.trim();if(!title||!Number.isFinite(amount)||amount<=0)throw new Error('أدخل اسم الدفعة ومبلغًا صحيحًا.');const installment={id:uid(),title,amount,dueDate:$('#installment-date').value||null,status:'pending',createdAt:Date.now()};const updated={...project,installments:[...(Array.isArray(project.installments)?project.installments:[]),installment],updatedAt:Date.now()};await S.store.save('projects',updated);S.projects=S.projects.map(x=>x.id===updated.id?updated:x);el.reset();render();toast('تمت إضافة الدفعة.'); }
    else if (a === 'save-project-followup') { const project=S.projects.find(x=>x.id===el.dataset.id);if(!project)throw new Error('المشروع غير موجود.');const updated={...project,followUpDate:$('#follow-up-date').value||null,followUpNote:$('#follow-up-note').value.trim(),updatedAt:Date.now()};await S.store.save('projects',updated);S.projects=S.projects.map(x=>x.id===updated.id?updated:x);render();toast('تم حفظ متابعة العميل.'); }
    else if (a === 'add-personal-expense') { const kind=$('#pe-kind').value==='income'?'income':'expense'; const x={id:uid(),kind,amount:Number($('#pe-amount').value),date:$('#pe-date').value,category:$('#pe-category').value||'أخرى',description:$('#pe-description').value.trim(),createdAt:Date.now(),updatedAt:Date.now()}; if(!x.description||x.amount<=0) throw new Error('أدخل وصفًا ومبلغًا صحيحًا'); await S.store.save('personalExpenses',x); toast(kind==='income'?'تم تسجيل الدخل.':'تم تسجيل المصروف.'); el.reset(); $('#pe-date').value=D.todayISO(); }
    else if (a === 'edit-personal-expense') { /* edited through prompt in click handler */ }
    else if (a === 'add-requirement') { const textValue=$('#req-text').value.trim(), projectId=S.activeProjectId, source=$('#req-source').value; if(!textValue||!projectId)throw new Error('اكتب الطلب وتأكد من فتح المشروع.'); await S.store.save('requirements',{id:uid(),projectId,text:textValue.slice(0,1200),source,sourceId:null,sourceLabel:source==='whatsapp'?'WhatsApp':'طلب مباشر',date:$('#req-date').value||D.todayISO(),status:'open',createdAt:Date.now(),updatedAt:Date.now()}); el.reset(); $('#req-date').value=D.todayISO(); refreshProjectPanel({ reset: true }); toast('تمت إضافة Requirement للمشروع.'); }
    else if (a === 'add-deliverable') { const d={id:uid(), projectId:$('#d-project').value, name:$('#d-name').value.trim(), stage:$('#d-stage').value, kind:$('#d-kind').value, dueDate:$('#d-date').value||null, status:$('#d-status').value, rev:1, submittedAt:$('#d-status').value==='submitted'?Date.now():null, notes:$('#d-notes').value.trim(), createdAt:Date.now(), updatedAt:Date.now()}; if(!d.name){toast(t('title_required'));return;} await S.store.save('deliverables',d); el.reset(); refreshProjectPanel({ reset: true }); toast('تم تسجيل بيانات التسليم بنجاح.'); }
    else { const x={id:uid(),projectId:$('#f-project').value,kind:$('#f-kind').value,amount:Number($('#f-amount').value),date:$('#f-fin-date').value||D.todayISO(),category:$('#f-category').value,description:$('#f-description').value.trim(),createdAt:Date.now()}; if(!x.projectId||x.amount<=0){toast(t('form_required'));return;} await S.store.save('financeEntries',x); el.reset(); $('#f-fin-date').value=D.todayISO(); toast('تم تسجيل الحركة المالية بنجاح.'); }
  } catch(err) { S.autoProcessMeetingAfterSave=false;toast(t('save_failed',{msg:err.message||err})); }
  finally { if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=submitBtn.dataset.oldText||'حفظ';} }
}

function onInput(e) {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  const k = el.dataset.input;
  const v = el.value;
  if (k === 'brand-field') { updateSettings({ brand: { ...(S.settings.brand || {}), [el.dataset.key]: v.trim() } }, { render: false }); return; }
  const mode = effectiveMode(S.settings.theme);
  switch (k) {
    case 'ratio-color': {
      const key = el.dataset.key;
      if (!['collectionColor', 'profitColor'].includes(key) || !/^#[0-9a-f]{6}$/i.test(v)) break;
      updateRatioLook(key, v, S.ratioEditorContext, false);
      renderRatioPreview();
      break;
    }
    case 'bg': updateTheme((x) => { x.bg[mode] = v; x.preset = 'custom'; }); break;
    case 'accent': updateTheme((x) => { x.accent = v; x.preset = 'custom'; }); break;
    case 'text': updateTheme((x) => { x.text[mode] = v; }); break;
    case 'sat': updateTheme((x) => { x.sat = Number(v); }); $('#v-sat').textContent = v + '%'; break;
    case 'blur': updateTheme((x) => { x.blur = Number(v); }); $('#v-blur').textContent = v + 'px'; break;
    case 'scale': updateTheme((x) => { x.scale = Number(v); }); $('#v-scale').textContent = v + '%'; break;
    case 'type-heading': case 'type-subheading': case 'type-item': { const key=k.replace('type-',''); const typography={...(S.settings.typography||DEFAULT_SETTINGS.typography),[key]:Math.min(130,Math.max(80,Number(v)||100))}; updateSettings({typography},{render:false}); applyTypographySettings(); const out=$('#v-'+k); if(out)out.textContent=v+'%'; break; }
    default: break;
  }
}

function onChange(e) {
  const el = e.target;
  if (el.id === 'pe-kind') {
    const category=$('#pe-category');
    if(category){const options=el.value==='income'?['دخل من عميل','راتب أو دخل عمل','دخل آخر']:['سكن وفواتير','مواصلات','طعام ومشروبات','مشتريات البيت','صحة','تعليم','ترفيه','ملابس','التزامات وديون','أخرى'];category.innerHTML=options.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');}
    return;
  }
  if (el.id === 'voice-target') { const box=$('#voice-finance-fields'); if(box) box.hidden=el.value!=='finance'; return; }
  if(el.id==='expense-month' && /^\d{4}-\d{2}$/.test(el.value)){S.expenseMonth=el.value;render();return;}
  const changed = el.closest('[data-change]');
  if (!changed) return;
  const k = changed.dataset.change;
  if (k === 'ratio-context') {
    if (RATIO_CONTEXTS.includes(el.value)) { S.ratioEditorContext = el.value; render(); }
  } else if (k === 'finance-target') {
    const key = el.dataset.key;
    if (!['collection', 'profit'].includes(key)) return;
    const raw = Number(el.value);
    if (!Number.isFinite(raw)) return;
    const financeTargets = { ...(S.settings.financeTargets || DEFAULT_SETTINGS.financeTargets), [key]: Math.min(100, Math.max(1, Math.round(raw))) };
    updateSettings({ financeTargets });
  } else if (k === 'requirement-status') { const r=S.requirements.find(x=>x.id===el.dataset.id); if(r) S.store.save('requirements',{...r,status:el.value,updatedAt:Date.now()}).catch(err=>toast(t('save_failed',{msg:err.message||err}))); }
  else if (k === 'deliverable-status') { const d=S.deliverables.find(x=>x.id===el.dataset.id); if(d) S.store.save('deliverables',{...d,status:el.value,submittedAt:el.value==='submitted'?Date.now():(d.submittedAt||null),updatedAt:Date.now()}).catch(err=>toast(t('save_failed',{msg:err.message||err}))); }
  else if (k === 'glass') updateTheme((x) => { x.glass = el.checked; }, { render: true });
  else if (k === 'text-auto') {
    const mode = effectiveMode(S.settings.theme);
    const auto = shownColors({ ...S.settings.theme, text: { light: null, dark: null } }).text;
    updateTheme((x) => { x.text[mode] = el.checked ? null : auto; }, { render: true });
  } else if (k === 'brand-logo') {
    if (el.files && el.files[0]) importBrandLogo(el.files[0]);
    el.value = '';
  } else if (k === 'import-file') {
    if (el.files && el.files[0]) importData(el.files[0]);
    el.value = '';
  }
}

function onKey(e) {
  if (e.key === 'Escape' && S.projectPanel) { closeProjectPanel(); return; }
  if (e.key === 'Escape' && $('#layer')?.innerHTML) { $('#layer').innerHTML=''; if (S.sheet) S.sheet=null; return; }
  if (e.key === 'Escape' && S.sheet) { closeSheet(); return; }
  if (e.key === 'Escape' && S.activeProjectId) { S.activeProjectId = null; S.animateNextRender = true; render(); window.scrollTo(0, 0); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (S.sheet && e.key === 'Enter' && document.activeElement && document.activeElement.id === 'f-title') { e.preventDefault(); saveSheet(); return; }
  if (!typing && !S.sheet && S.user && S.section === 'tasks' && e.key === 'n') { e.preventDefault(); openSheet(null); return; }
  if (e.key === 'Enter' && document.activeElement && document.activeElement.classList.contains('tbody')) { S.expandedTaskId = S.expandedTaskId === document.activeElement.dataset.id ? null : document.activeElement.dataset.id; render(); }
  if (e.key === 'Enter' && document.activeElement?.matches('[data-action="open-project"]')) { S.activeProjectId = document.activeElement.dataset.id; S.section = 'projects'; S.animateNextRender = true; render(); window.scrollTo(0, 0); }
}

installTranslator();
boot();


