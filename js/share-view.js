// صفحة الضيف: عرض فقط للأقسام التي سمح بها المدير، وتتحدث مباشرة.
// تقرأ shares/{id} وshares/{id}/sections/* فقط. لا علاقة لها ببيانات المدير الأصلية، والقواعد (firestore.rules)
// هي التي تقرر ما يُقرأ: أي قسم لم يُسمح به يرجع «permission-denied» فنخفيه.

import { firebaseConfig } from './firebase-config.js';
import { FB_BASE } from './store.js';
import { normalizeRequest, canEditSection } from './share-core.js';

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

const state = { user: null, meta: undefined, sections: {}, denied: new Set(), tab: null, unsubs: [], fb: null, error: '', requests: [], sending: false };
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
    state.user = u ? { email: String(u.email || '').toLowerCase(), verified: !!u.emailVerified, name: String(u.displayName || '') } : null;
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
  state.unsubs = []; state.meta = undefined; state.sections = {}; state.denied = new Set(); state.tab = null; state.requests = []; closeCompose();
}

function startListening() {
  const { fs, db } = state.fb;
  screen('جارٍ التحميل…', '');
  // يقرأ الضيف سجل الصلاحيات الخاص ببريده فقط؛ لا يقرأ مستند المشروع أو قائمة المدعوين.
  state.unsubs.push(fs.onSnapshot(fs.doc(db, 'shares', shareId, 'access', state.user.email),
    (snap) => { state.meta = snap.exists() ? snap.data() : null; render(); },
    () => { state.meta = null; render(); }));
  for (const s of SECTIONS) {
    state.unsubs.push(fs.onSnapshot(fs.doc(db, 'shares', shareId, 'sections', s),
      (snap) => { if (snap.exists()) state.sections[s] = snap.data(); else delete state.sections[s]; state.denied.delete(s); render(); },
      () => { delete state.sections[s]; state.denied.add(s); render(); }));
  }
  // طلباتي: الطلبات التي أرسلتُها أنا فقط (القواعد تسمح بقراءتها دون غيرها).
  state.unsubs.push(fs.onSnapshot(fs.query(fs.collection(db, 'shares', shareId, 'requests'), fs.where('authorEmail', '==', state.user.email)),
    (snap) => { state.requests = snap.docs.map((d) => normalizeRequest(d.id, d.data())).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt); render(); },
    () => { state.requests = []; }));
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
    <section class="sv-panel" role="tabpanel">${PANELS[state.tab](state.sections[state.tab].data, canEdit(state.tab))}${myRequestsHtml()}</section>
    <footer class="sv-foot">${esc(state.user.email)} · <button class="sv-link" id="sv-out" type="button">تسجيل الخروج</button></footer>
  </div>`;
  app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { state.tab = b.dataset.tab; render(); }; });
  document.getElementById('sv-out').onclick = signOut;
  app.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => openCompose(b.dataset); });
}

// ------------------------------------------------------------------ الأقسام (كل القيم تمر على esc)
const bar = (p) => `<div class="sv-bar"><i style="width:${pct(p)}%"></i></div>`;
const rowHtml = (main, sub, end, extra) => `<div class="sv-row"><div class="sv-row-main"><strong>${main}</strong>${sub ? `<small>${sub}</small>` : ''}${extra || ''}</div><div class="sv-row-end">${end || ''}</div></div>`;
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
  technical(d, ed) {
    const phases = (d.progress && d.progress.phases) || [];
    const reqs = d.requirements || [];
    return `${ed ? `<div class="sv-edit-bar"><button class="sv-mini primary" data-act="requirement_add" data-target="" type="button">+ إضافة متطلب أو ملاحظة</button></div>` : ''}<div class="sv-kv">
      <div><small>النوع</small><strong>${esc(TYPE[d.type] || d.type || '—')}</strong></div>
      <div><small>الحالة</small><strong>${esc(STATUS[d.status] || d.status || '—')}</strong></div>
      <div><small>البداية</small><strong>${dt(d.startDate) || '—'}</strong></div>
      <div><small>النهاية المتوقعة</small><strong>${dt(d.endDate) || '—'}</strong></div>
    </div>
    <div><h2 class="sv-h">مراحل العمل</h2>${phases.length ? phases.map((p) => rowHtml(esc(p.label), `${Number(p.done) || 0} من ${Number(p.total) || 0}`, pct(p.percent) + '%') + bar(p.percent)).join('') : empty('لا توجد مراحل مسجلة بعد.')}</div>
    <div><h2 class="sv-h">المتطلبات والملاحظات</h2>${reqs.length ? reqs.map((r) => rowHtml(esc(r.text), dt(r.date), `<span class="sv-pill ${r.status === 'done' ? '' : 'warn'}">${esc(REQ[r.status] || r.status || '')}</span>`)).join('') : empty('لا توجد متطلبات مسجلة.')}</div>`;
  },
  deliverables(d, ed) {
    const items = d.items || [];
    const acts = (x) => (!ed || x.status === 'approved' ? '' : pendingMine('deliverable_status', x.id) ? '<div class="sv-actions"><span class="sv-pill warn">طلبك بانتظار موافقة المدير</span></div>' : `<div class="sv-actions"><button class="sv-mini primary" data-act="deliverable_status" data-status="approved" data-target="${esc(x.id)}" type="button">اعتماد</button><button class="sv-mini" data-act="deliverable_status" data-status="revision" data-target="${esc(x.id)}" type="button">طلب تعديل</button></div>`);
    return items.length ? `<div>${items.map((x) => rowHtml(esc(x.name) + (x.rev > 1 ? ` <small>(V${Number(x.rev)})</small>` : ''), `${esc(STAGE[x.stage] || x.stage || '')} · ${esc(kindLabel(x.kind))}${x.dueDate ? ' · موعد ' + dt(x.dueDate) : ''}`,
      `<span class="sv-pill ${x.status === 'approved' ? '' : x.status === 'revision' ? 'warn' : 'dim'}">${esc(APPROVAL[x.status] || x.status || '')}</span>`, acts(x))).join('')}</div>` : empty('لا توجد تسليمات مسجلة.');
  },
  finance(d, ed) {
    const instActs = (i) => (!ed || i.status === 'paid' ? '' : pendingMine('installment_paid', i.id) ? '<div class="sv-actions"><span class="sv-pill warn">طلبك بانتظار موافقة المدير</span></div>' : `<div class="sv-actions"><button class="sv-mini primary" data-act="installment_paid" data-target="${esc(i.id)}" type="button">تم دفعها</button></div>`);
    const inst = d.installments || [];
    const inc = d.income || [];
    return `<div class="sv-kv">
      <div><small>قيمة التعاقد</small><strong>${money(d.contractValue)}</strong></div>
      <div><small>تم تحصيله</small><strong>${money(d.collected)}</strong></div>
      <div><small>المتبقي</small><strong>${money(d.remaining)}</strong></div>
      <div><small>نسبة التحصيل</small><strong>${d.collectionPct == null ? '—' : esc(d.collectionPct) + '%'}</strong></div>
    </div>${d.collectionPct == null ? '' : bar(d.collectionPct)}
    <div><h2 class="sv-h">الدفعات</h2>${inst.length ? inst.map((i) => rowHtml(esc(i.title || 'دفعة'), i.dueDate ? 'موعدها ' + dt(i.dueDate) : '', `${money(i.amount)} <span class="sv-pill ${i.status === 'paid' ? '' : 'warn'}">${i.status === 'paid' ? 'تم التحصيل' : 'مستحقة'}</span>`, instActs(i))).join('') : empty('لا توجد دفعات مسجلة.')}</div>
    <div><h2 class="sv-h">سجل التحصيلات</h2>${inc.length ? inc.map((x) => rowHtml(esc(x.category || 'تحصيل'), dt(x.date), money(x.amount))).join('') : empty('لا توجد تحصيلات مسجلة.')}</div>`;
  },
  expenses(d) {
    const items = d.items || [];
    return `<div class="sv-kv"><div><small>إجمالي المصروفات</small><strong>${money(d.total)}</strong></div></div>
    <div>${items.length ? items.map((x) => rowHtml(esc(x.category || 'مصروف'), dt(x.date), money(x.amount))).join('') : empty('لا توجد مصروفات مسجلة.')}</div>`;
  },
  meetings(d, ed) {
    const items = d.items || [];
    const block = (label, v) => (v ? `<b>${label}</b><p class="sv-text">${esc(v)}</p>` : '');
    return items.length ? items.map((m) => `<article class="sv-meeting"><h3>${esc(m.title || 'اجتماع')}</h3><div class="sv-sub">${dt(m.date)}${m.participants ? ' · ' + esc(m.participants) : ''}</div>${block('الغرض', m.purpose)}${block('المواضيع', m.topics)}${block('القرارات', m.decisions)}${block('المطلوب تنفيذه', m.actions)}${block('المحضر', m.minutes)}${ed ? `<div class="sv-actions"><button class="sv-mini" data-act="meeting_note" data-target="${esc(m.id)}" type="button">إضافة ملاحظة</button></div>` : ''}</article>`).join('') : empty('لا توجد اجتماعات مسجلة.');
  },
};

// ------------------------------------------------------------------ تعديلات الضيف = طلبات تنتظر موافقة المدير
const canEdit = (section) => !!(state.user && canEditSection(state.meta && state.meta.sections, section));
const pendingMine = (type, targetId) => state.requests.some((r) => r.status === 'pending' && r.type === type && r.targetId === targetId);
const TYPE_LABEL = { deliverable_status: 'اعتماد / تعديل تسليم', requirement_add: 'متطلب أو ملاحظة', meeting_note: 'ملاحظة على اجتماع', installment_paid: 'دفعة مدفوعة' };
const STATE_PILL = { pending: ['بانتظار موافقة المدير', 'warn'], approved: ['تمت الموافقة', ''], rejected: ['مرفوض', 'dim'] };

function targetNameOf(r) {
  const sec = state.sections[r.section] && state.sections[r.section].data;
  if (!sec) return '';
  if (r.type === 'deliverable_status') return ((sec.items || []).find((x) => x.id === r.targetId) || {}).name || '';
  if (r.type === 'meeting_note') return ((sec.items || []).find((x) => x.id === r.targetId) || {}).title || '';
  if (r.type === 'installment_paid') return ((sec.installments || []).find((x) => x.id === r.targetId) || {}).title || '';
  return '';
}

function myRequestsHtml() {
  const list = state.requests.slice(0, 8);
  if (!list.length) return '';
  return `<div class="sv-mine"><h2 class="sv-h">طلباتك</h2>${list.map((r) => {
    const [label, cls] = STATE_PILL[r.status];
    const what = r.type === 'deliverable_status' ? (r.payload.status === 'approved' ? 'اعتماد' : 'طلب تعديل') : TYPE_LABEL[r.type];
    return rowHtml(esc(what) + (targetNameOf(r) ? ' «' + esc(targetNameOf(r)) + '»' : ''), r.payload.text ? esc(r.payload.text.slice(0, 140)) : '', `<span class="sv-pill ${cls}">${label}</span>`);
  }).join('')}</div>`;
}

function showToast(msg) {
  let t = document.getElementById('sv-toast');
  if (!t) { t = document.createElement('div'); t.id = 'sv-toast'; t.className = 'sv-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.remove(), 3500);
}

function closeCompose() { const el = document.getElementById('sv-compose'); if (el) el.remove(); }

function openCompose(ds) {
  const type = ds.act;
  const needText = type !== 'installment_paid' && !(type === 'deliverable_status' && ds.status === 'approved');
  const titles = { deliverable_status: ds.status === 'approved' ? 'اعتماد هذا التسليم' : 'طلب تعديل على هذا التسليم', requirement_add: 'إضافة متطلب أو ملاحظة', meeting_note: 'إضافة ملاحظة على الاجتماع', installment_paid: 'تسجيل هذه الدفعة كمدفوعة' };
  const hints = { deliverable_status: ds.status === 'approved' ? 'سيصل طلبك للمدير وهو يوافق عليه قبل أن يتغير أي شيء.' : 'اكتب التعديل المطلوب. سيصل للمدير وهو يوافق عليه قبل أن يتغير أي شيء.', requirement_add: 'اكتب المتطلب أو الملاحظة. تظهر للمدير باسمك بعد موافقته.', meeting_note: 'تُضاف الملاحظة لمحضر الاجتماع باسمك بعد موافقة المدير.', installment_paid: 'سيصل الطلب للمدير ليتأكد من الدفع ويسجله.' };
  closeCompose();
  const host = document.createElement('div');
  host.id = 'sv-compose'; host.className = 'sv-sheet-bg';
  host.innerHTML = `<form class="sv-sheet" role="dialog" aria-modal="true" aria-label="${esc(titles[type])}"><h2>${esc(titles[type])}</h2><p>${esc(hints[type])}</p>${needText ? '<textarea id="sv-text" maxlength="2000" required placeholder="اكتب هنا…"></textarea>' : ''}<div class="sv-sheet-actions"><button class="sv-btn" type="button" id="sv-cancel">إلغاء</button><button class="sv-btn primary" type="submit" id="sv-send">إرسال للمدير</button></div></form>`;
  document.body.appendChild(host);
  const ta = host.querySelector('#sv-text'); if (ta) ta.focus();
  host.addEventListener('click', (e) => { if (e.target === host) closeCompose(); });
  host.querySelector('#sv-cancel').onclick = closeCompose;
  host.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const text = ta ? ta.value.trim() : '';
    if (needText && !text) { showToast('اكتب نص الطلب أولًا.'); return; }
    await sendRequest(type, ds.target || '', { ...(ds.status ? { status: ds.status } : {}), ...(text ? { text } : {}) });
  };
}

async function sendRequest(type, targetId, payload) {
  if (state.sending) return;
  if (state.requests.filter((r) => r.status === 'pending').length >= 15) { showToast('لديك طلبات كثيرة بانتظار موافقة المدير. انتظر الرد عليها أولًا.'); return; }
  state.sending = true;
  const btn = document.getElementById('sv-send'); if (btn) btn.disabled = true;
  const { fs, db } = state.fb;
  const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).replace(/[^A-Za-z0-9_-]/g, '');
  try {
    await fs.setDoc(fs.doc(db, 'shares', shareId, 'requests', id), { type, targetId, payload, authorEmail: state.user.email, authorName: state.user.name, status: 'pending', createdAt: Date.now() });
    closeCompose();
    showToast('تم إرسال طلبك للمدير. سيظهر هنا قراره.');
  } catch (e) {
    showToast(e && e.code === 'permission-denied' ? 'لم يعد مسموحًا لك بالتعديل في هذا القسم.' : 'تعذر إرسال الطلب. حاول مرة أخرى.');
    if (btn) btn.disabled = false;
  } finally { state.sending = false; }
}

main().catch((e) => { console.error(e); screen('تعذر التحميل', 'حدث خطأ أثناء التحميل. حدّث الصفحة وحاول مرة أخرى.'); });
