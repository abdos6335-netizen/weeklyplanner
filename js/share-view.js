// صفحة الضيف: عرض فقط للأقسام التي سمح بها المدير، وتتحدث مباشرة.
// تقرأ shares/{id} وshares/{id}/sections/* فقط. لا علاقة لها ببيانات المدير الأصلية، والقواعد (firestore.rules)
// هي التي تقرر ما يُقرأ: أي قسم لم يُسمح به يرجع «permission-denied» فنخفيه.

import { firebaseConfig } from './firebase-config.js';
import { FB_BASE } from './store.js';

const SECTIONS = ['report', 'technical', 'deliverables', 'finance', 'expenses', 'meetings'];
const TAB_LABEL = { report: 'الملخص', technical: 'الحالة الفنية', deliverables: 'التسليمات', finance: 'التحصيلات', expenses: 'المصروفات', meetings: 'الاجتماعات' };
const TYPE = { residential: 'سكني', administrative: 'إداري', commercial: 'تجاري', fitout: 'تشطيبات وتنفيذ' };
const STATUS = { planning: 'تخطيط', active: 'جاري', on_hold: 'متوقف مؤقتًا', completed: 'مكتمل' };
const STAGE = { concept: 'فكرة مبدئية', design: 'تصميم', technical: 'لوحات تنفيذية', execution: 'تنفيذ' };
const APPROVAL = { pending: 'لم يُرسل', submitted: 'مرسل للمراجعة', approved: 'معتمد', revision: 'مطلوب تعديل' };
const REQ = { open: 'مفتوح', doing: 'قيد التنفيذ', done: 'تم' };
const KIND = { plan: 'مسقط أفقي', section: 'قطاع', elevation: 'واجهة داخلية', detail: 'تفصيلة', rcp: 'RCP', '3d': '3D', other: 'أخرى' };

const app = document.getElementById('sv-app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US')} ج.م`;
const kindLabel = (k) => KIND[k] || String(k || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const dt = (d) => (d ? `<bdi dir="ltr">${esc(d)}</bdi>` : '');
const pct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

const state = { user: null, meta: undefined, sections: {}, denied: new Set(), tab: null, unsubs: [], fb: null, error: '' };
const shareId = new URLSearchParams(location.search).get('s') || '';

function screen(title, body, actions = '') {
  app.innerHTML = `<div class="sv-center"><h1>${esc(title)}</h1>${body ? `<p>${body}</p>` : ''}${actions}</div>`;
}

async function main() {
  if (!firebaseConfig || !firebaseConfig.apiKey) { screen('غير متاح', 'المشاركة تعمل مع الحساب السحابي فقط.'); return; }
  if (!shareId || shareId.length > 400) { screen('رابط غير صحيح', 'اطلب من صاحب المشروع إرسال الرابط مرة أخرى.'); return; }
  const [appMod, authMod, fs] = await Promise.all([
    import(`${FB_BASE}/firebase-app.js`), import(`${FB_BASE}/firebase-auth.js`), import(`${FB_BASE}/firebase-firestore.js`),
  ]);
  const fbApp = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(fbApp);
  const db = fs.getFirestore(fbApp);
  state.fb = { authMod, auth, fs, db };
  authMod.getRedirectResult(auth).catch((e) => { state.error = e.code || e.message || ''; });
  authMod.onAuthStateChanged(auth, (u) => {
    stopListening();
    state.user = u ? { email: String(u.email || '').toLowerCase(), verified: !!u.emailVerified } : null;
    if (!u) { renderSignIn(); return; }
    startListening();
  });
}

function renderSignIn() {
  screen('مشروع مشارَك معك', 'سجّل الدخول بحساب Google الذي أضافه صاحب المشروع لتشاهد ما سمح لك به.' + (state.error ? `<br><small>${esc(state.error)}</small>` : ''),
    '<div><button class="sv-btn primary" id="sv-signin" type="button">الدخول بحساب Google</button></div>');
  document.getElementById('sv-signin').onclick = async () => {
    const { authMod, auth } = state.fb;
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try { await authMod.signInWithPopup(auth, provider); }
    catch (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) await authMod.signInWithRedirect(auth, provider);
      else if (!(e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request'))) { state.error = e.code || e.message || ''; renderSignIn(); }
    }
  };
}

function signOut() { state.fb.authMod.signOut(state.fb.auth); }

function stopListening() {
  state.unsubs.forEach((u) => { try { u(); } catch { /* تجاهل */ } });
  state.unsubs = []; state.meta = undefined; state.sections = {}; state.denied = new Set(); state.tab = null;
}

function startListening() {
  const { fs, db } = state.fb;
  screen('جارٍ التحميل…', '');
  state.unsubs.push(fs.onSnapshot(fs.doc(db, 'shares', shareId),
    (snap) => { state.meta = snap.exists() ? snap.data() : null; render(); },
    () => { state.meta = null; render(); }));
  for (const s of SECTIONS) {
    state.unsubs.push(fs.onSnapshot(fs.doc(db, 'shares', shareId, 'sections', s),
      (snap) => { if (snap.exists()) state.sections[s] = snap.data(); else delete state.sections[s]; state.denied.delete(s); render(); },
      () => { delete state.sections[s]; state.denied.add(s); render(); }));
  }
}

function render() {
  if (!state.user) return;
  if (state.meta === undefined) return; // ما زال التحميل
  const available = SECTIONS.filter((s) => state.sections[s] && state.sections[s].data);
  if (!state.meta && !available.length) {
    screen('لا توجد صلاحية', `هذا الحساب (${esc(state.user.email)}) لا يملك وصولًا لهذا المشروع، أو أن الرابط غير صحيح. اطلب من صاحب المشروع إضافة بريدك بالضبط، أو سجّل الدخول بحساب آخر.`, '<div><button class="sv-btn" id="sv-out" type="button">تسجيل الخروج</button></div>');
    document.getElementById('sv-out').onclick = signOut;
    return;
  }
  if (!available.length) { screen(state.meta && state.meta.projectName ? state.meta.projectName : 'المشروع', 'لم تُتح لك أقسام للعرض بعد.'); return; }
  if (!state.tab || !available.includes(state.tab)) state.tab = available[0];
  const name = (state.meta && state.meta.projectName) || (state.sections.report && state.sections.report.data.projectName) || (state.sections.technical && state.sections.technical.data.name) || 'المشروع';
  const updated = Math.max(...available.map((s) => Number(state.sections[s].updatedAt) || 0));
  app.innerHTML = `<div class="sv-wrap">
    <header class="sv-head"><div><h1>${esc(name)}</h1><div class="sv-sub">${updated ? 'آخر تحديث ' + esc(new Date(updated).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })) : ''}</div></div><span class="sv-badge">عرض فقط</span></header>
    <nav class="sv-tabs" role="tablist">${available.map((s) => `<button class="sv-tab" role="tab" data-tab="${s}" aria-selected="${s === state.tab}">${TAB_LABEL[s]}</button>`).join('')}</nav>
    <section class="sv-panel" role="tabpanel">${PANELS[state.tab](state.sections[state.tab].data)}</section>
    <footer class="sv-foot">${esc(state.user.email)} · <button class="sv-link" id="sv-out" type="button">تسجيل الخروج</button></footer>
  </div>`;
  app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { state.tab = b.dataset.tab; render(); }; });
  document.getElementById('sv-out').onclick = signOut;
}

// ------------------------------------------------------------------ الأقسام (كل القيم تمر على esc)
const bar = (p) => `<div class="sv-bar"><i style="width:${pct(p)}%"></i></div>`;
const rowHtml = (main, sub, end) => `<div class="sv-row"><div class="sv-row-main"><strong>${main}</strong>${sub ? `<small>${sub}</small>` : ''}</div><div class="sv-row-end">${end || ''}</div></div>`;
const empty = (t) => `<p class="sv-empty">${t}</p>`;

const PANELS = {
  report(d) {
    const c = d.counts || {};
    return `<div class="sv-kv">
      <div><small>الحالة</small><strong>${esc(STATUS[d.status] || d.status || '—')}</strong></div>
      <div><small>نسبة الإنجاز</small><strong>${d.progressPercent == null ? '—' : pct(d.progressPercent) + '%'}</strong></div>
      <div><small>إجمالي التسليمات</small><strong>${Number(c.total) || 0}</strong></div>
      <div><small>معتمد</small><strong>${Number(c.approved) || 0}</strong></div>
      <div><small>مرسل للمراجعة</small><strong>${Number(c.submitted) || 0}</strong></div>
      <div><small>مطلوب تعديل</small><strong>${Number(c.revision) || 0}</strong></div>
    </div>${d.progressPercent == null ? '' : bar(d.progressPercent)}`;
  },
  technical(d) {
    const phases = (d.progress && d.progress.phases) || [];
    const reqs = d.requirements || [];
    return `<div class="sv-kv">
      <div><small>النوع</small><strong>${esc(TYPE[d.type] || d.type || '—')}</strong></div>
      <div><small>الحالة</small><strong>${esc(STATUS[d.status] || d.status || '—')}</strong></div>
      <div><small>البداية</small><strong>${dt(d.startDate) || '—'}</strong></div>
      <div><small>النهاية المتوقعة</small><strong>${dt(d.endDate) || '—'}</strong></div>
    </div>
    <div><h2 class="sv-h">مراحل العمل</h2>${phases.length ? phases.map((p) => rowHtml(esc(p.label), `${Number(p.done) || 0} من ${Number(p.total) || 0}`, pct(p.percent) + '%') + bar(p.percent)).join('') : empty('لا توجد مراحل مسجلة بعد.')}</div>
    <div><h2 class="sv-h">المتطلبات والملاحظات</h2>${reqs.length ? reqs.map((r) => rowHtml(esc(r.text), dt(r.date), `<span class="sv-pill ${r.status === 'done' ? '' : 'warn'}">${esc(REQ[r.status] || r.status || '')}</span>`)).join('') : empty('لا توجد متطلبات مسجلة.')}</div>`;
  },
  deliverables(d) {
    const items = d.items || [];
    return items.length ? `<div>${items.map((x) => rowHtml(esc(x.name) + (x.rev > 1 ? ` <small>(V${Number(x.rev)})</small>` : ''), `${esc(STAGE[x.stage] || x.stage || '')} · ${esc(kindLabel(x.kind))}${x.dueDate ? ' · موعد ' + dt(x.dueDate) : ''}`,
      `<span class="sv-pill ${x.status === 'approved' ? '' : x.status === 'revision' ? 'warn' : 'dim'}">${esc(APPROVAL[x.status] || x.status || '')}</span>`)).join('')}</div>` : empty('لا توجد تسليمات مسجلة.');
  },
  finance(d) {
    const inst = d.installments || [];
    const inc = d.income || [];
    return `<div class="sv-kv">
      <div><small>قيمة التعاقد</small><strong>${money(d.contractValue)}</strong></div>
      <div><small>تم تحصيله</small><strong>${money(d.collected)}</strong></div>
      <div><small>المتبقي</small><strong>${money(d.remaining)}</strong></div>
      <div><small>نسبة التحصيل</small><strong>${d.collectionPct == null ? '—' : esc(d.collectionPct) + '%'}</strong></div>
    </div>${d.collectionPct == null ? '' : bar(d.collectionPct)}
    <div><h2 class="sv-h">الدفعات</h2>${inst.length ? inst.map((i) => rowHtml(esc(i.title || 'دفعة'), i.dueDate ? 'موعدها ' + dt(i.dueDate) : '', `${money(i.amount)} <span class="sv-pill ${i.status === 'paid' ? '' : 'warn'}">${i.status === 'paid' ? 'تم التحصيل' : 'مستحقة'}</span>`)).join('') : empty('لا توجد دفعات مسجلة.')}</div>
    <div><h2 class="sv-h">سجل التحصيلات</h2>${inc.length ? inc.map((x) => rowHtml(esc(x.category || 'تحصيل'), dt(x.date), money(x.amount))).join('') : empty('لا توجد تحصيلات مسجلة.')}</div>`;
  },
  expenses(d) {
    const items = d.items || [];
    return `<div class="sv-kv"><div><small>إجمالي المصروفات</small><strong>${money(d.total)}</strong></div></div>
    <div>${items.length ? items.map((x) => rowHtml(esc(x.category || 'مصروف'), dt(x.date), money(x.amount))).join('') : empty('لا توجد مصروفات مسجلة.')}</div>`;
  },
  meetings(d) {
    const items = d.items || [];
    const block = (label, v) => (v ? `<b>${label}</b><p class="sv-text">${esc(v)}</p>` : '');
    return items.length ? items.map((m) => `<article class="sv-meeting"><h3>${esc(m.title || 'اجتماع')}</h3><div class="sv-sub">${dt(m.date)}${m.participants ? ' · ' + esc(m.participants) : ''}</div>${block('الغرض', m.purpose)}${block('المواضيع', m.topics)}${block('القرارات', m.decisions)}${block('المطلوب تنفيذه', m.actions)}${block('المحضر', m.minutes)}</article>`).join('') : empty('لا توجد اجتماعات مسجلة.');
  },
};

main().catch((e) => { console.error(e); screen('تعذر التحميل', 'حدث خطأ أثناء التحميل. حدّث الصفحة وحاول مرة أخرى.'); });
