// مشاركة المشاريع — جهة المدير.
// المدير يضيف ضيوفًا (بريد Google) لمشروع واحد ويحدد لكل ضيف ما يراه من الأقسام.
// هذا الملف لا يلمس بيانات المدير الأصلية: يقرأها فقط، ويكتب نسخة مشتركة مفلترة في shares/{shareId}
// (انظر js/share-core.js لقائمة الحقول المسموحة، وfirestore.rules لقواعد القراءة).
// النسخة المشتركة تتحدث تلقائيًا من برنامجك كلما تغيّرت بيانات المشروع أو صلاحيات الضيوف.

import { FB_BASE } from './store.js';
import { lang } from './i18n.js';
import { SECTIONS, PRESETS, EDITABLE_SECTIONS, normalizeEmail, shareIdFor, cleanGuests, buildSections, planPublish, normalizeRequest, viewOf, planApply } from './share-core.js';

const L = (ar, en) => (lang() === 'ar' ? ar : en);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DATA = ['projects', 'deliverables', 'financeEntries', 'meetings', 'requirements', 'shareConfigs'];
const SYNC_DELAY = 900;

const SECTION_LABEL = {
  technical: ['الحالة الفنية والمتطلبات', 'Technical status & requirements'],
  deliverables: ['التسليمات واللوحات', 'Deliverables & drawings'],
  finance: ['التحصيلات والدفعات', 'Collections & installments'],
  expenses: ['مصروفات المشروع', 'Project expenses'],
  meetings: ['اجتماعات المشروع', 'Project meetings'],
  report: ['ملخص التقدم', 'Progress summary'],
};
const PRESET_LABEL = {
  client: ['عميل — فني وتسليمات وتحصيلات', 'Client — technical, deliverables, collections'],
  contractor: ['مقاول / فني — فني وتسليمات', 'Contractor — technical, deliverables'],
  partner: ['شريك — كل الأقسام', 'Partner — everything'],
  custom: ['مخصص — كل شيء مخفي، وأنت تختار', 'Custom — all hidden, you choose'],
};
const sectionLabel = (s) => L(SECTION_LABEL[s][0], SECTION_LABEL[s][1]);

let ctx = null; // { store, toast, rerender, isActive, progressOf, openItem }
let st = null; // حالة الجلسة الحالية
let eventsBound = false;

// ------------------------------------------------------------------ دورة الحياة
export function initShare(c) {
  disposeShare();
  ctx = c;
  const user = c.store && c.store.user;
  if (!c.store || c.store.mode !== 'cloud' || !user) { st = { cloud: false }; bindEvents(); return disposeShare; }
  st = {
    cloud: true, uid: user.uid, email: String(user.email || '').toLowerCase(),
    data: { projects: [], deliverables: [], financeEntries: [], meetings: [], requirements: [], shareConfigs: [] },
    ready: new Set(), unsubs: [], timer: null, queue: Promise.resolve(), fb: null,
    status: {}, sheetProjectId: null, listSig: '',
    requests: {}, reqUnsubs: {}, known: {}, busy: new Set(),
  };
  bindEvents();
  const me = st;
  import(`${FB_BASE}/firebase-app.js`).then(async (appMod) => {
    const fs = await import(`${FB_BASE}/firebase-firestore.js`);
    if (st !== me) return;
    const db = fs.getFirestore(appMod.getApp());
    me.fb = { fs, db };
    for (const name of DATA) {
      me.unsubs.push(fs.onSnapshot(
        fs.collection(db, 'users', me.uid, name),
        { includeMetadataChanges: true },
        (snap) => {
          if (st !== me) return;
          me.data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          // لا ننشر شيئًا قبل أن يصل كل مجموعة من الخادم، حتى لا نكتب نسخة ناقصة من ذاكرة الجهاز المؤقتة.
          if (!snap.metadata.fromCache) me.ready.add(name);
          if (name === 'shareConfigs') { refreshList(); syncRequestListeners(); }
          schedule(name === 'shareConfigs' ? 0 : SYNC_DELAY);
        },
        (err) => { if (st === me) { me.status._global = { state: 'error', message: errMsg(err) }; refreshList(true); } },
      ));
    }
  }).catch((err) => { if (st === me) { me.status._global = { state: 'error', message: errMsg(err) }; refreshList(true); } });
  return disposeShare;
}

export function disposeShare() {
  if (st && st.unsubs) st.unsubs.forEach((u) => { try { u(); } catch { /* تجاهل */ } });
  if (st && st.reqUnsubs) Object.values(st.reqUnsubs).forEach((u) => { try { u(); } catch { /* تجاهل */ } });
  if (st && st.cloud) setTitleBadge(0);
  if (st && st.timer) clearTimeout(st.timer);
  st = null;
  const layer = document.getElementById('layer');
  if (layer && layer.querySelector('[data-share-overlay]')) layer.innerHTML = '';
}

function errMsg(e) {
  if (e && e.code === 'permission-denied') {
    return L('قواعد Firestore الجديدة لم تُنشر بعد: انسخ محتوى firestore.rules إلى Firebase Console ▸ Firestore ▸ Rules ثم Publish.', 'The new Firestore rules are not published yet: copy firestore.rules into Firebase Console ▸ Firestore ▸ Rules and Publish.');
  }
  return String((e && e.message) || e || 'error');
}

function configs() { return (st.data.shareConfigs || []).map((c) => ({ ...c, guests: cleanGuests(c.guests), published: c.published || {} })); }
const configOf = (projectId) => configs().find((c) => c.id === projectId) || null;
const allReady = () => DATA.every((n) => st.ready.has(n));

// ------------------------------------------------------------------ نشر النسخة المشتركة
function schedule(delay) {
  if (!st || !st.cloud) return;
  clearTimeout(st.timer);
  const me = st;
  st.timer = setTimeout(() => { me.queue = me.queue.then(() => (st === me ? runSync(me) : null)).catch(() => {}); }, delay);
}

async function runSync(me) {
  if (!me.fb || !allReady()) return;
  const { fs, db } = me.fb;
  for (const cfg of configs()) {
    const found = me.data.projects.find((p) => p.id === cfg.projectId);
    if (!found && cfg.guests.length) continue;
    const project = found || { id: cfg.projectId, name: cfg.projectName || '' };
    const built = found ? buildSections({
      project, deliverables: me.data.deliverables, financeEntries: me.data.financeEntries,
      meetings: me.data.meetings, requirements: me.data.requirements,
      progress: ctx.progressOf ? ctx.progressOf(project, me.data.deliverables) : null,
    }) : {};
    const plan = planPublish({ ownerUid: me.uid, project, config: cfg, built, published: cfg.published });
    const sectionTodo = plan.sections.filter((s) => s.op !== 'skip');
    const accessTodo = plan.access.filter((a) => a.op !== 'skip');
    const metaTodo = plan.meta.op !== 'skip';
    if (!sectionTodo.length && !accessTodo.length && !metaTodo) {
      await cleanup(me, cfg);
      if (!me.status[cfg.id] || me.status[cfg.id].state !== 'ok') setStatus(cfg.id, { state: 'ok', at: Date.now() });
      continue;
    }
    setStatus(cfg.id, { state: 'syncing' });
    try {
      const shareRef = fs.doc(db, 'shares', plan.shareId);
      const now = Date.now();

      // نسحب وصول المحذوفين/المقيّدين أولًا. كل ضيف له مستند صلاحيات لا يستطيع غيره قراءته.
      for (const a of accessTodo.filter((x) => x.op === 'delete')) {
        await fs.deleteDoc(fs.doc(db, 'shares', plan.shareId, 'access', a.email));
      }
      for (const a of accessTodo.filter((x) => x.op === 'set')) {
        await fs.setDoc(fs.doc(db, 'shares', plan.shareId, 'access', a.email), { ...a.doc, updatedAt: now });
      }

      // تحديث النسخة المشتركة بعد تجهيز الصلاحيات؛ مستندات الأقسام لا تحتوي أي بريد أو قائمة أعضاء.
      for (const s of sectionTodo) {
        const ref = fs.doc(db, 'shares', plan.shareId, 'sections', s.section);
        if (s.op === 'set') await fs.setDoc(ref, { ...s.doc, updatedAt: now });
        else await fs.deleteDoc(ref);
      }

      if (plan.meta.op === 'set') await fs.setDoc(shareRef, { ...plan.meta.doc, doneColor: typeof me.doneColor === 'function' ? me.doneColor() : '#1f9c70', updatedAt: now });
      else if (plan.meta.op === 'delete') await fs.deleteDoc(shareRef);

      const published = { ...(cfg.published || {}), access: { ...((cfg.published && cfg.published.access) || {}) } };
      for (const s of sectionTodo) published[s.section] = s.op === 'set' ? s.hash : null;
      for (const a of accessTodo) {
        if (a.op === 'set') published.access[a.email] = a.hash;
        else delete published.access[a.email];
      }
      if (!Object.keys(published.access).length) delete published.access;
      if (metaTodo) published.meta = plan.meta.op === 'set' ? plan.meta.hash : null;
      await ctx.store.save('shareConfigs', { id: cfg.id, published });
      setStatus(cfg.id, { state: 'ok', at: Date.now() });
    } catch (err) {
      console.error('share sync failed', err);
      setStatus(cfg.id, { state: 'error', message: errMsg(err) });
    }
  }
}

// إعداد بلا ضيوف وبلا أي شيء منشور لا فائدة منه: نحذفه.
async function cleanup(me, cfg) {
  const none = !cfg.guests.length && !Object.values(cfg.published).some(Boolean);
  if (none) { try { await ctx.store.remove('shareConfigs', cfg.id); } catch { /* تجاهل */ } }
}

function setStatus(projectId, s) {
  if (!st) return;
  st.status[projectId] = s;
  refreshList(true);
  if (st.sheetProjectId === projectId) paintStatus(projectId);
}

async function saveConfig(patch) {
  // دمج جزئي (merge): لا نكتب published هنا حتى لا نمسح ما سجّله النشر.
  await ctx.store.save('shareConfigs', { ...patch, updatedAt: Date.now() });
}

// ------------------------------------------------------------------ شاشة المشاركة (تبويب منفصل)
function ensureStyles() {
  if (document.getElementById('share-css')) return;
  const l = document.createElement('link');
  l.id = 'share-css'; l.rel = 'stylesheet'; l.href = 'share.css';
  document.head.appendChild(l);
}

function summaryOf(cfg) {
  if (!cfg || !cfg.guests.length) return L('غير مشترك', 'Not shared');
  const n = cfg.guests.length;
  return L(`${n} ${n === 1 ? 'ضيف' : 'ضيوف'}`, `${n} guest${n === 1 ? '' : 's'}`);
}

function statusLine(projectId) {
  const s = st.status[projectId];
  if (!s) return '';
  if (s.state === 'error') return `<span class="sh-bad">${esc(s.message)}</span>`;
  if (s.state === 'syncing') return `<span class="sh-dim">${L('جارٍ تحديث النسخة المشتركة…', 'Updating the shared copy…')}</span>`;
  const t = new Date(s.at || Date.now()).toLocaleTimeString(lang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  return `<span class="sh-dim">${L('آخر تحديث للنسخة المشتركة', 'Shared copy updated')} ${t}</span>`;
}

export function renderSharing() {
  ensureStyles();
  if (!st || !st.cloud) {
    return `<div class="sh-page"><section class="sh-note"><strong>${L('المشاركة تحتاج الحساب السحابي', 'Sharing needs the cloud account')}</strong><p>${L('سجّل الدخول بحساب Google (وضع Firebase) لتشارك مشاريعك. في الوضع المحلي بياناتك على هذا الجهاز فقط.', 'Sign in with Google (Firebase mode) to share projects. In local mode your data stays on this device only.')}</p></section></div>`;
  }
  const cfgs = configs();
  const projects = [...st.data.projects].filter((p) => !p.archivedAt)
    .sort((a, b) => (configOf(b.id)?.guests.length ? 1 : 0) - (configOf(a.id)?.guests.length ? 1 : 0) || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  const orphans = cfgs.filter((c) => c.guests.length && !st.data.projects.some((p) => p.id === c.projectId));
  const globalErr = st.status._global ? `<p class="sh-bad">${esc(st.status._global.message)}</p>` : '';
  const rows = projects.map((p) => {
    const cfg = configOf(p.id);
    const chips = (cfg ? cfg.guests : []).slice(0, 4).map((g) => `<span class="sh-chip" dir="ltr">${esc(g.email)}</span>`).join('');
    return `<div class="sh-row"><div class="sh-row-main"><strong>${esc(p.name)}</strong><small>${esc(summaryOf(cfg))}</small>${chips ? `<div class="sh-chips">${chips}</div>` : ''}${cfg && cfg.guests.length ? `<div class="sh-line">${statusLine(p.id)}</div>` : ''}</div><button class="btn sm" data-share-open="${esc(p.id)}" type="button">${cfg && cfg.guests.length ? L('إدارة', 'Manage') : L('مشاركة', 'Share')}</button></div>`;
  }).join('');
  const orphanRows = orphans.map((c) => `<div class="sh-row"><div class="sh-row-main"><strong>${esc(c.projectName || c.projectId)}</strong><small>${L('مشروع محذوف ما زالت له مشاركة', 'Deleted project that is still shared')}</small></div><button class="btn sm danger" data-share-stop="${esc(c.id)}" type="button">${L('إيقاف المشاركة', 'Stop sharing')}</button></div>`).join('');
  return `<div class="sh-page">
    <section class="sh-note"><strong>${L('من يرى ماذا', 'Who sees what')}</strong><p>${L('اختر مشروعًا وأضف بريد Google للضيف، ثم حدّد الأقسام التي يراها. الضيف لا يرى أي شيء آخر في البرنامج: لا مهام ولا اجتماعات عامة ولا ماليات لم تسمح بها.', 'Pick a project and add the guest’s Google email, then choose the sections they can see. Guests see nothing else in the app.')}</p>${globalErr}</section>
    ${renderShareRequests()}
    <div class="sh-list">${rows || `<p class="muted">${L('لا توجد مشاريع بعد.', 'No projects yet.')}</p>`}</div>
    ${requestLog()}
    ${orphanRows ? `<h3 class="sh-h">${L('مشاركات يتيمة', 'Orphaned shares')}</h3><div class="sh-list">${orphanRows}</div>` : ''}
  </div>`;
}

export function shareButton(projectId) {
  const n = pendingFor(projectId);
  return `<button class="text-action" data-share-open="${esc(projectId)}" type="button">${L('مشاركة', 'Share')}</button>${n ? `<span class="rq-badge" title="${L('طلبات تعديل بانتظار موافقتك', 'Edit requests waiting for you')}">${n}</span>` : ''}`;
}

function refreshList(force) {
  if (!st || !ctx) return;
  const sig = JSON.stringify([configs().map((c) => [c.id, c.guests]), st.status, st.data.projects.map((p) => [p.id, p.name, p.archivedAt || null])]);
  if (!force && sig === st.listSig) return;
  st.listSig = sig;
  if (ctx.isActive && ctx.isActive()) ctx.rerender();
}

// ------------------------------------------------------------------ نافذة إدارة مشروع واحد
function shareUrl(projectId) {
  const u = new URL('share.html', location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('s', shareIdFor(st.uid, projectId));
  return u.toString();
}

function paintStatus(projectId) {
  const el = document.getElementById('sh-status');
  if (el && st && st.sheetProjectId === projectId) el.innerHTML = statusLine(projectId) || `<span class="sh-dim">${allReady() ? '' : L('جارٍ تحميل بياناتك قبل النشر…', 'Loading your data before publishing…')}</span>`;
}

function openSheet(projectId) {
  if (!st || !st.cloud) { ctx && ctx.toast(L('المشاركة تحتاج تسجيل الدخول بحساب Google (الوضع السحابي).', 'Sharing needs the cloud (Google) account.')); return; }
  const project = st.data.projects.find((p) => p.id === projectId);
  if (!project) { ctx.toast(L('المشروع غير موجود.', 'Project not found.')); return; }
  ensureStyles();
  st.sheetProjectId = projectId;
  paintSheet();
}

function paintSheet() {
  const projectId = st.sheetProjectId;
  const project = st.data.projects.find((p) => p.id === projectId);
  const layer = document.getElementById('layer');
  if (!project || !layer) return;
  const cfg = configOf(projectId);
  const guests = cfg ? cfg.guests : [];
  const prevEmail = document.getElementById('sh-email') ? document.getElementById('sh-email').value : '';
  const guestCards = guests.map((g) => `<div class="sh-guest">
      <div class="sh-guest-head"><strong dir="ltr">${esc(g.email)}</strong><button class="btn sm danger" data-share-remove="${esc(g.email)}" type="button">${L('إزالة', 'Remove')}</button></div>
      <div class="sh-access">${SECTIONS.map((s) => `<label class="sh-acc"><span>${esc(sectionLabel(s))}</span><select class="input" data-share-access="${s}" data-email="${esc(g.email)}" aria-label="${esc(sectionLabel(s))}">
        <option value="none" ${g.access[s] === 'none' ? 'selected' : ''}>${L('مخفي', 'Hidden')}</option>
        <option value="view" ${g.access[s] === 'view' ? 'selected' : ''}>${L('عرض فقط', 'View only')}</option>
        ${EDITABLE_SECTIONS.includes(s) ? `<option value="edit" ${g.access[s] === 'edit' ? 'selected' : ''}>${L('عرض وتعديل (بموافقتك)', 'View & edit (you approve)')}</option>` : ''}</select></label>`).join('')}</div>
      ${g.access.expenses !== 'none' && g.access.finance !== 'none' ? `<p class="sh-warn">${L('تنبيه: رؤية التحصيلات مع المصروفات تكشف له هامش ربح المشروع.', 'Heads-up: seeing collections together with expenses reveals the project’s margin.')}</p>` : ''}
    </div>`).join('');
  layer.innerHTML = `<div class="overlay" data-share-overlay><section class="sheet glass sh-sheet" role="dialog" aria-modal="true" aria-label="${L('مشاركة المشروع', 'Share project')}">
    <div class="sheet-head"><h2>${L('مشاركة', 'Share')} «${esc(project.name)}»</h2><button class="btn icon-btn" data-share-close type="button" aria-label="${L('إغلاق', 'Close')}">×</button></div>
    <p class="muted small">${L('الضيف يدخل بحساب Google على الرابط أدناه ويرى الأقسام التي تسمح بها فقط. تتحدث النسخة تلقائيًا.', 'The guest signs in with Google at the link below and sees only the sections you allow. The copy updates automatically.')}</p>
    <div class="sh-linkbox"><input class="input" id="sh-link" dir="ltr" readonly value="${esc(shareUrl(projectId))}" aria-label="${L('رابط المشاركة', 'Share link')}"><button class="btn sm" data-share-copy type="button">${L('نسخ', 'Copy')}</button></div>
    <div id="sh-status" class="sh-line"></div>
    ${guestCards || `<p class="muted small">${L('لا يوجد ضيوف بعد. أضف أول ضيف:', 'No guests yet. Add the first one:')}</p>`}
    <div class="sh-add">
      <label class="lab" for="sh-email">${L('بريد Google للضيف', 'Guest’s Google email')}</label>
      <input class="input" id="sh-email" type="email" inputmode="email" dir="ltr" autocomplete="off" placeholder="name@gmail.com" value="${esc(prevEmail)}">
      <label class="lab" for="sh-preset">${L('الصلاحيات المبدئية', 'Starting permissions')}</label>
      <select class="input" id="sh-preset">${Object.keys(PRESETS).map((k) => `<option value="${k}">${esc(L(PRESET_LABEL[k][0], PRESET_LABEL[k][1]))}</option>`).join('')}</select>
      <div class="sheet-actions"><button class="btn primary" data-share-add type="button">${L('إضافة الضيف', 'Add guest')}</button></div>
    </div>
    ${guests.length ? `<div class="sh-foot"><button class="text-action" data-share-republish="${esc(projectId)}" type="button">${L('إعادة نشر النسخة المشتركة', 'Re-publish shared copy')}</button><button class="text-action danger" data-share-stop="${esc(projectId)}" type="button">${L('إيقاف مشاركة المشروع بالكامل', 'Stop sharing this project')}</button></div>` : ''}
  </section></div>`;
  paintStatus(projectId);
}

// ------------------------------------------------------------------ الأحداث
function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st && st.sheetProjectId) closeSheet(); });
}

function closeSheet() {
  if (!st) return;
  st.sheetProjectId = null;
  const layer = document.getElementById('layer');
  if (layer && layer.querySelector('[data-share-overlay]')) layer.innerHTML = '';
}

async function onClick(e) {
  const t = e.target;
  if (t.matches && t.matches('[data-share-overlay]')) { closeSheet(); return; }
  const el = t.closest && t.closest('[data-share-open],[data-share-close],[data-share-add],[data-share-remove],[data-share-copy],[data-share-stop],[data-share-republish],[data-rq-approve],[data-rq-reject],[data-rq-open]');
  if (!el || !ctx) return;
  const d = el.dataset;
  try {
    if (d.shareOpen !== undefined) { openSheet(d.shareOpen); return; }
    if (!st || !st.cloud) return;
    if (d.shareClose !== undefined) { closeSheet(); return; }
    if (d.shareCopy !== undefined) { await copyLink(); return; }
    if (d.shareAdd !== undefined) { await addGuest(); return; }
    if (d.shareRemove !== undefined) { await removeGuest(d.shareRemove); return; }
    if (d.shareStop !== undefined) { await stopSharing(d.shareStop); return; }
    if (d.shareRepublish !== undefined) { await republish(d.shareRepublish); return; }
    if (d.rqApprove !== undefined) { await resolveRequest(d.rqApprove, true); return; }
    if (d.rqReject !== undefined) { await resolveRequest(d.rqReject, false); return; }
    if (d.rqOpen !== undefined) { openRequestItem(d.rqOpen); }
  } catch (err) { ctx.toast(errMsg(err)); }
}

async function onChange(e) {
  const el = e.target.closest && e.target.closest('[data-share-access]');
  if (!el || !st || !st.cloud || !st.sheetProjectId) return;
  const projectId = st.sheetProjectId;
  const cfg = configOf(projectId);
  if (!cfg) return;
  const section = el.dataset.shareAccess;
  if (!SECTIONS.includes(section)) return;
  // «عرض وتعديل» متاح لأربعة أقسام فقط، وكل تعديل يمر عليك كطلب موافقة.
  const value = el.value === 'edit' && EDITABLE_SECTIONS.includes(section) ? 'edit' : el.value === 'view' ? 'view' : 'none';
  const guests = cfg.guests.map((g) => (g.email === el.dataset.email ? { ...g, access: { ...g.access, [section]: value } } : g));
  await commitGuests(projectId, guests);
}

async function commitGuests(projectId, guests) {
  const project = st.data.projects.find((p) => p.id === projectId);
  const current = st.data.shareConfigs.find((c) => c.id === projectId);
  const next = { id: projectId, projectId, projectName: project ? project.name : (current && current.projectName) || '', guests };
  // نحدّث نسختنا المحلية فورًا ليعكسها العرض، ثم نحفظ (Firestore يؤكد لاحقًا).
  st.data.shareConfigs = [...st.data.shareConfigs.filter((c) => c.id !== projectId), { ...(current || {}), ...next, published: (current && current.published) || {} }];
  if (st.sheetProjectId === projectId) paintSheet();
  try { await saveConfig(next); } catch (err) { ctx.toast(errMsg(err)); }
  schedule(0);
}

async function addGuest() {
  const projectId = st.sheetProjectId;
  const email = normalizeEmail(document.getElementById('sh-email').value);
  if (!email) { ctx.toast(L('اكتب بريدًا صحيحًا.', 'Enter a valid email.')); return; }
  if (email === st.email) { ctx.toast(L('هذا بريدك أنت.', 'That is your own email.')); return; }
  const cfg = configOf(projectId);
  const guests = cfg ? cfg.guests : [];
  if (guests.some((g) => g.email === email)) { ctx.toast(L('هذا الضيف مضاف بالفعل.', 'This guest is already added.')); return; }
  const preset = PRESETS[document.getElementById('sh-preset').value] || PRESETS.custom;
  document.getElementById('sh-email').value = '';
  await commitGuests(projectId, [...guests, { email, access: { ...preset }, addedAt: Date.now() }]);
  ctx.toast(L('تمت إضافة الضيف.', 'Guest added.'));
}

async function removeGuest(email) {
  const projectId = st.sheetProjectId;
  const cfg = configOf(projectId);
  if (!cfg) return;
  if (!confirm(L(`إزالة ${email} من المشروع؟ سيفقد الوصول فورًا.`, `Remove ${email} from this project? Access ends immediately.`))) return;
  await commitGuests(projectId, cfg.guests.filter((g) => g.email !== email));
}

async function stopSharing(projectId) {
  if (!confirm(L('إيقاف مشاركة هذا المشروع بالكامل؟ سيفقد كل الضيوف الوصول وتُحذف النسخة المشتركة وطلباتها.', 'Stop sharing this project entirely? All guests lose access and the shared copy and its requests are deleted.'))) return;
  await purgeRequests(projectId);
  await commitGuests(projectId, []);
  closeSheet();
}

async function republish(projectId) {
  const cfg = configOf(projectId);
  if (!cfg) return;
  const cleared = Object.fromEntries([...SECTIONS, 'meta'].map((k) => [k, null]));
  st.data.shareConfigs = st.data.shareConfigs.map((c) => (c.id === projectId ? { ...c, published: cleared } : c));
  await ctx.store.save('shareConfigs', { id: projectId, published: cleared });
  schedule(0);
  ctx.toast(L('جارٍ إعادة النشر…', 'Re-publishing…'));
}

async function copyLink() {
  const url = shareUrl(st.sheetProjectId);
  try { await navigator.clipboard.writeText(url); ctx.toast(L('تم نسخ الرابط.', 'Link copied.')); }
  catch { const i = document.getElementById('sh-link'); if (i) { i.focus(); i.select(); } ctx.toast(L('انسخ الرابط يدويًا.', 'Copy the link manually.')); }
}


// ====================================================================== طلبات تعديل الضيوف (المرحلة 2)
// الضيف ينشئ طلبًا في shares/{id}/requests. هنا نسمع لهذه الطلبات، ننبّهك، ونطبّقها على بياناتك الأصلية فقط عند موافقتك.
const APPROVAL_LABEL = { pending: ['لم يُرسل', 'Not sent'], submitted: ['مرسل للمراجعة', 'Sent for review'], approved: ['معتمد', 'Approved'], revision: ['مطلوب تعديل', 'Revision requested'] };
const STATE_LABEL = { pending: ['بانتظار قرارك', 'Waiting for you'], approved: ['تمت الموافقة', 'Approved'], rejected: ['مرفوض', 'Rejected'] };
const REASON_LABEL = {
  no_access: ['لم يعد هذا الضيف مصرّحًا له بالتعديل في هذا القسم.', 'This guest is no longer allowed to edit this section.'],
  target_missing: ['العنصر المطلوب لم يعد موجودًا في المشروع.', 'The requested item no longer exists in the project.'],
  invalid: ['الطلب غير صالح.', 'The request is not valid.'],
  project_missing: ['المشروع غير موجود.', 'The project no longer exists.'],
  resolved: ['تمت معالجة هذا الطلب من قبل.', 'This request was already handled.'],
};
const localISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const money = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const nameOf = (r) => r.authorName || r.authorEmail || L('ضيف', 'Guest');
const projectOf = (projectId) => (st.data.projects || []).find((p) => p.id === projectId) || null;

function allRequests() {
  const out = [];
  for (const [projectId, list] of Object.entries(st.requests || {})) for (const r of list) out.push({ ...r, projectId });
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
const pendingList = () => allRequests().filter((r) => r.status === 'pending');
export function pendingShareCount() { return st && st.cloud ? pendingList().length : 0; }
const pendingFor = (projectId) => (st && st.cloud ? pendingList().filter((r) => r.projectId === projectId).length : 0);

function setTitleBadge(n) {
  try { document.title = (n ? `(${n}) ` : '') + document.title.replace(/^\(\d+\)\s*/, ''); } catch { /* تجاهل */ }
}

function syncRequestListeners() {
  if (!st || !st.cloud || !st.fb) return;
  const me = st;
  const { fs, db } = st.fb;
  const want = new Set(configs().filter((c) => c.guests.length).map((c) => c.projectId || c.id));
  for (const pid of Object.keys(st.reqUnsubs)) {
    if (want.has(pid)) continue;
    try { st.reqUnsubs[pid](); } catch { /* تجاهل */ }
    delete st.reqUnsubs[pid]; delete st.requests[pid]; delete st.known[pid];
  }
  for (const pid of want) {
    if (st.reqUnsubs[pid]) continue;
    const q = fs.query(fs.collection(db, 'shares', shareIdFor(st.uid, pid), 'requests'), fs.orderBy('createdAt', 'desc'), fs.limit(200));
    st.reqUnsubs[pid] = fs.onSnapshot(q, (snap) => {
      if (st !== me) return;
      const list = snap.docs.map((d) => normalizeRequest(d.id, d.data())).filter(Boolean);
      me.requests[pid] = list;
      // لا ننبّه على ما كان موجودًا قبل فتح البرنامج: نبدأ التنبيه بعد أول لقطة من الخادم.
      if (!snap.metadata || !snap.metadata.fromCache) {
        const seen = me.known[pid];
        if (seen) list.filter((r) => r.status === 'pending' && !seen.has(r.id)).forEach((r) => announce(pid, r));
        me.known[pid] = new Set(list.map((r) => r.id));
      }
      afterRequestsChange();
    }, (err) => { if (st === me) { me.status._global = { state: 'error', message: errMsg(err) }; refreshList(true); } });
  }
}

function afterRequestsChange() {
  if (!st) return;
  setTitleBadge(pendingShareCount());
  if (ctx && ctx.isActive && ctx.isActive()) ctx.rerender();
}

function announce(projectId, r) {
  const project = projectOf(projectId);
  const msg = L(`${nameOf(r)} طلب تعديلًا${project ? ` في «${project.name}»` : ''}`, `${nameOf(r)} requested an edit${project ? ` in “${project.name}”` : ''}`);
  ctx.toast(msg, { label: L('عرض', 'View'), fn: () => ctx.openItem && ctx.openItem({ today: true }) });
  try { if (document.hidden && window.Notification && Notification.permission === 'granted') new Notification(msg); } catch { /* تجاهل */ }
}

function describe(r, view) {
  const who = view.targetName ? `«${esc(view.targetName)}»` : '';
  if (r.type === 'deliverable_status') {
    const to = r.payload.status === 'approved' ? L('اعتماد', 'Approve') : L('طلب تعديل', 'Request revision');
    const cur = APPROVAL_LABEL[view.current] ? L(...APPROVAL_LABEL[view.current]) : '';
    const target = r.payload.status === 'approved' ? L('معتمد', 'Approved') : L('مطلوب تعديل', 'Revision requested');
    return { title: `${to} ${who}`, detail: `${cur ? `${esc(cur)} ← ${esc(target)}` : esc(target)}${r.payload.text ? `<br>${esc(r.payload.text)}` : ''}` };
  }
  if (r.type === 'requirement_add') return { title: L('إضافة متطلب أو ملاحظة', 'Add a requirement or note'), detail: esc(r.payload.text) };
  if (r.type === 'meeting_note') return { title: `${L('ملاحظة على اجتماع', 'Meeting note')} ${who}`, detail: esc(r.payload.text) };
  return { title: `${L('تسجيل دفعة كمدفوعة', 'Mark payment as received')} ${who}`, detail: view.amount != null ? `${money(view.amount)} ${L('ج.م', 'EGP')}` : '' };
}

function ago(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return L('الآن', 'now');
  if (m < 60) return L(`منذ ${m} دقيقة`, `${m} min ago`);
  const h = Math.round(m / 60);
  if (h < 24) return L(`منذ ${h} ساعة`, `${h} h ago`);
  const dd = Math.round(h / 24);
  return L(`منذ ${dd} يوم`, `${dd} d ago`);
}

function requestCard(r) {
  const project = projectOf(r.projectId);
  const cfg = configOf(r.projectId);
  const view = viewOf(r, { project, deliverables: st.data.deliverables, meetings: st.data.meetings });
  const guest = cfg && cfg.guests.find((g) => g.email === r.authorEmail);
  const allowed = !!(guest && guest.access[r.section] === 'edit');
  const problem = !view.valid ? view.reason : (!allowed ? 'no_access' : '');
  const d = describe(r, view);
  const busy = st.busy.has(`${r.projectId}|${r.id}`);
  const key = `${esc(r.projectId)}|${esc(r.id)}`;
  return `<article class="rq-card" data-rq-card="${key}">
    <header class="rq-top"><span class="rq-avatar" aria-hidden="true">${esc([...nameOf(r)][0] || '?')}</span><div class="rq-who"><strong>${esc(nameOf(r))}</strong><small dir="ltr">${esc(r.authorEmail)}</small></div><span class="rq-time">${esc(ago(r.createdAt))}</span></header>
    <p class="rq-proj">${esc(project ? project.name : '')}</p>
    <div class="rq-body"><strong>${d.title}</strong>${d.detail ? `<p>${d.detail}</p>` : ''}</div>
    ${problem ? `<p class="rq-warn">${esc(L(...REASON_LABEL[problem]))}</p>` : ''}
    <div class="rq-actions">
      ${problem ? '' : `<button class="btn primary sm" data-rq-approve="${key}" type="button" ${busy ? 'disabled' : ''}>${L('موافقة', 'Approve')}</button>`}
      <button class="btn sm" data-rq-reject="${key}" type="button" ${busy ? 'disabled' : ''}>${L('رفض', 'Reject')}</button>
      ${problem ? '' : `<button class="text-action" data-rq-open="${key}" type="button">${L('افتح العنصر', 'Open item')}</button>`}
    </div></article>`;
}

// تُستدعى من شاشة «النهارده» ومن تبويب المشاركة: كروت الطلبات المعلقة (مميزة بلون مختلف).
export function renderShareRequests() {
  if (!st || !st.cloud) return '';
  const list = pendingList();
  if (!list.length) return '';
  ensureStyles();
  const shown = list.slice(0, 20);
  return `<section class="rq-wrap" aria-label="${L('طلبات تعديل من الضيوف', 'Edit requests from guests')}">
    <h2 class="rq-head"><span class="rq-dot" aria-hidden="true"></span>${L('طلبات تعديل بانتظار موافقتك', 'Edit requests waiting for your approval')} <span class="rq-count">${list.length}</span></h2>
    ${shown.map(requestCard).join('')}
    ${list.length > shown.length ? `<p class="sh-dim">${L(`و${list.length - shown.length} طلبات أخرى — أنهِ هذه أولًا.`, `${list.length - shown.length} more — handle these first.`)}</p>` : ''}
  </section>`;
}

// سجل الطلبات في تبويب المشاركة: ما أضافه الضيوف اليوم وما قبله، ومن قرّر فيه.
function requestLog() {
  const done = allRequests().filter((r) => r.status !== 'pending');
  if (!done.length) return '';
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = done.filter((r) => r.createdAt >= start.getTime());
  const older = done.filter((r) => r.createdAt < start.getTime()).slice(0, 30);
  const row = (r) => {
    const project = projectOf(r.projectId);
    const d = describe(r, viewOf(r, { project, deliverables: st.data.deliverables, meetings: st.data.meetings }));
    return `<div class="sh-row"><div class="sh-row-main"><strong>${esc(nameOf(r))} · ${d.title}</strong><small>${esc(project ? project.name : '')} · ${esc(ago(r.createdAt))}</small>${d.detail ? `<small class="rq-clip">${d.detail}</small>` : ''}</div><div class="rq-state"><span class="sv-pill rq-${r.status}">${esc(L(...STATE_LABEL[r.status]))}</span>${r.status === 'approved' ? `<button class="text-action" data-rq-open="${esc(r.projectId)}|${esc(r.id)}" type="button">${L('افتح', 'Open')}</button>` : ''}</div></div>`;
  };
  return `${today.length ? `<h3 class="sh-h">${L('ما سجّله الضيوف اليوم', 'What guests logged today')}</h3><div class="sh-list">${today.map(row).join('')}</div>` : ''}
    ${older.length ? `<h3 class="sh-h">${L('طلبات سابقة', 'Earlier requests')}</h3><div class="sh-list">${older.map(row).join('')}</div>` : ''}`;
}

function findRequest(key) {
  const [projectId, id] = String(key).split('|');
  const r = ((st.requests || {})[projectId] || []).find((x) => x.id === id);
  return r ? { ...r, projectId } : null;
}

async function runSaves(saves) {
  const done = [];
  try {
    for (const s of saves) { await ctx.store.save(s.col, s.doc); done.push(s); }
  } catch (err) {
    for (const d of done.reverse()) if (d.undo) await ctx.store.remove(d.undo.col, d.undo.id).catch(() => {});
    throw err;
  }
}

async function resolveRequest(key, approve) {
  const r = findRequest(key);
  if (!r || !st.fb) return;
  const busyKey = `${r.projectId}|${r.id}`;
  if (st.busy.has(busyKey)) return;
  st.busy.add(busyKey);
  if (ctx.isActive && ctx.isActive()) ctx.rerender();
  const { fs, db } = st.fb;
  try {
    if (approve) {
      const project = projectOf(r.projectId);
      const plan = planApply({ req: r, config: configOf(r.projectId), project, deliverables: st.data.deliverables, meetings: st.data.meetings, now: Date.now(), today: localISO() });
      if (!plan.ok) { ctx.toast(L(...(REASON_LABEL[plan.reason] || REASON_LABEL.invalid))); return; }
      await runSaves(plan.saves);
    }
    await fs.setDoc(fs.doc(db, 'shares', shareIdFor(st.uid, r.projectId), 'requests', r.id), { status: approve ? 'approved' : 'rejected', resolvedAt: Date.now() }, { merge: true });
    ctx.toast(approve ? L('تمت الموافقة وطُبّق التعديل.', 'Approved and applied.') : L('تم رفض الطلب.', 'Request rejected.'));
  } catch (err) {
    ctx.toast(errMsg(err));
  } finally {
    st.busy.delete(busyKey);
    if (ctx.isActive && ctx.isActive()) ctx.rerender();
  }
}

function openRequestItem(key) {
  const r = findRequest(key);
  if (!r || !ctx.openItem) return;
  ctx.openItem({ projectId: r.projectId, type: r.type, targetId: r.type === 'requirement_add' ? `gr_${String(r.id).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 120)}` : r.targetId });
}

// عند إيقاف مشاركة مشروع: احذف طلباته أيضًا (Firestore لا يحذف المجموعات الفرعية تلقائيًا).
async function purgeRequests(projectId) {
  const list = (st.requests || {})[projectId] || [];
  if (!list.length || !st.fb) return;
  const { fs, db } = st.fb;
  const sid = shareIdFor(st.uid, projectId);
  for (const r of list) { try { await fs.deleteDoc(fs.doc(db, 'shares', sid, 'requests', r.id)); } catch { /* تجاهل */ } }
}
