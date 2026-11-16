// منطق مشاركة المشروع — دوال نقية بلا Firebase ولا DOM حتى يسهل اختبارها.
//
// الفكرة: بيانات المدير الأصلية (users/{uid}/...) لا تُفتح لأحد أبدًا. عند مشاركة مشروع، يكتب برنامج المدير
// «نسخة مشتركة» في shares/{shareId}/sections/{section}، كل قسم في مستند مستقل فيه قائمة بريد من يحق لهم قراءته.
// المستخدم يقرأ هذه النسخة فقط، فلا يوجد مسار يصله إلى المهام أو الاجتماعات العامة أو المصروف الشخصي.
//
// قاعدة ذهبية في هذا الملف: كل قسم يُبنى من قائمة بيضاء (Whitelist) من الحقول. أي حقل جديد يُضاف لاحقًا
// إلى المشروع أو التسليمات لا يظهر للمستخدمين إلا إذا أضفناه هنا عن قصد.

export const SECTIONS = ['technical', 'deliverables', 'finance', 'expenses', 'meetings', 'report'];
export const LEVELS = ['none', 'view', 'edit'];

// قوالب جاهزة لاختيار سريع. المدير يعدّل كل قسم بعدها.
export const PRESETS = {
  client: { technical: 'view', deliverables: 'view', finance: 'view', expenses: 'none', meetings: 'none', report: 'view' },
  contractor: { technical: 'view', deliverables: 'view', finance: 'none', expenses: 'none', meetings: 'none', report: 'view' },
  partner: { technical: 'view', deliverables: 'view', finance: 'view', expenses: 'view', meetings: 'view', report: 'view' },
  custom: { technical: 'none', deliverables: 'none', finance: 'none', expenses: 'none', meetings: 'none', report: 'none' },
};

// حدّ أقصى لحجم المستند الواحد (حد Firestore 1MB؛ نترك هامشًا واسعًا).
const MAX_DOC_CHARS = 700000;

const str = (v, max) => String(v ?? '').slice(0, max);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 10) : null);
const textOf = (v, max) => str(Array.isArray(v) ? v.join('\n') : v, max);
const forProject = (rows, projectId) => (Array.isArray(rows) ? rows : []).filter((r) => r && r.projectId === projectId);

export function normalizeEmail(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@,;<>/()"']+@[^\s@,;<>/()"']+\.[^\s@,;<>/()"']+$/.test(e)) return '';
  return e;
}

// معرّف المشاركة يبدأ بـ uid المدير: قواعد Firestore تعتمد على هذه البادئة لتعرف مالك المشاركة.
export function shareIdFor(ownerUid, projectId) {
  return `${ownerUid}_${String(projectId).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function cleanAccess(access) {
  const out = {};
  for (const s of SECTIONS) {
    const v = access && access[s];
    out[s] = LEVELS.includes(v) ? v : 'none';
  }
  return out;
}

// صلاحية التعديل تُقرأ من سجل وصول الضيف الخاص، لا من مستند القسم المشترك.
export function canEditSection(sections, section) {
  return !!(sections && sections[section] && sections[section].edit === true);
}

export function cleanGuests(guests) {
  const seen = new Set();
  const out = [];
  for (const g of Array.isArray(guests) ? guests : []) {
    const email = normalizeEmail(g && g.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, access: cleanAccess(g.access), addedAt: num(g.addedAt) || null });
  }
  return out;
}

// من يقرأ كل قسم ومن يُسمح له بإرسال طلب تعديل؛ لا يحصل الضيف على كتابة مباشرة في بيانات المالك.
export function audience(config) {
  const guests = cleanGuests(config && config.guests).filter((guest) => SECTIONS.some((section) => guest.access[section] !== 'none'));
  const out = {};
  for (const s of SECTIONS) {
    const readers = [];
    const editors = [];
    for (const g of guests) {
      if (g.access[s] === 'view' || g.access[s] === 'edit') readers.push(g.email);
      if (g.access[s] === 'edit') editors.push(g.email);
    }
    out[s] = { readers: readers.sort(), editors: editors.sort() };
  }
  return out;
}

export function membersOf(config) {
  const set = new Set();
  const aud = audience(config);
  for (const s of SECTIONS) aud[s].readers.forEach((e) => set.add(e));
  return [...set].sort();
}

// ------------------------------------------------------------------ بناء الأقسام (قائمة بيضاء)
function phasesOf(progress) {
  const phases = Array.isArray(progress && progress.phases) ? progress.phases : [];
  return phases.slice(0, 8).map((p) => ({
    key: str(p.key, 40), label: str(p.label, 60), done: num(p.done), total: num(p.total), percent: num(p.percent),
  }));
}

export function buildSections({ project, deliverables, financeEntries, meetings, requirements, progress }) {
  const pid = project.id;
  const ds = forProject(deliverables, pid);
  const fin = forProject(financeEntries, pid);
  const progressPercent = progress && progress.percent != null ? num(progress.percent) : null;

  const technical = {
    name: str(project.name, 160),
    type: str(project.type, 40),
    status: str(project.status, 40),
    startDate: isoDate(project.startDate),
    endDate: isoDate(project.endDate),
    workScope: (Array.isArray(project.workScope) ? project.workScope : []).slice(0, 8).map((x) => str(x, 40)),
    progress: { percent: progressPercent, phases: phasesOf(progress) },
    requirements: forProject(requirements, pid)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 300)
      .map((r) => ({ id: str(r.id, 120), text: str(r.text, 600), status: str(r.status, 20), date: isoDate(r.date) })),
  };

  const deliverablesSection = {
    items: ds.slice(0, 500).map((d) => ({
      id: str(d.id, 120), name: str(d.name, 160), stage: str(d.stage, 30), kind: str(d.kind, 40),
      dueDate: isoDate(d.dueDate), status: str(d.status, 20), rev: num(d.rev) || 1, submittedAt: num(d.submittedAt) || null,
    })),
  };

  const contract = Math.max(0, num(project.contractValue));
  const income = fin.filter((x) => x.kind === 'income');
  const collected = income.reduce((n, x) => n + Math.max(0, num(x.amount)), 0);
  const finance = {
    contractValue: contract,
    collected,
    remaining: Math.max(0, contract - collected),
    collectionPct: contract > 0 ? Math.round(collected / contract * 1000) / 10 : null,
    installments: (Array.isArray(project.installments) ? project.installments : []).slice(0, 100).map((i) => ({
      id: str(i.id, 120), title: str(i.title || i.name, 80), amount: Math.max(0, num(i.amount)),
      status: i.status === 'paid' ? 'paid' : 'pending', dueDate: isoDate(i.dueDate), paidAt: isoDate(i.paidAt),
    })),
    income: income.slice(0, 500).map((x) => ({ id: str(x.id, 120), date: isoDate(x.date), amount: Math.max(0, num(x.amount)), category: str(x.category, 60) })),
  };

  const expenseRows = fin.filter((x) => x.kind === 'expense');
  const expenses = {
    total: expenseRows.reduce((n, x) => n + Math.max(0, num(x.amount)), 0),
    items: expenseRows.slice(0, 500).map((x) => ({ id: str(x.id, 120), date: isoDate(x.date), amount: Math.max(0, num(x.amount)), category: str(x.category, 60) })),
  };

  const meetingsSection = {
    items: forProject(meetings, pid)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 50)
      .map((m) => ({
        id: str(m.id, 120), title: str(m.title, 160), date: isoDate(m.date),
        purpose: textOf(m.purpose, 1000), topics: textOf(m.topics, 3000), decisions: textOf(m.decisions, 4000),
        actions: textOf(m.actions, 4000), minutes: textOf(m.minutes, 8000), participants: textOf(m.participants, 500),
      })),
  };

  const counts = { total: ds.length, pending: 0, submitted: 0, approved: 0, revision: 0 };
  for (const d of ds) if (d.status !== 'total' && Object.hasOwn(counts, d.status)) counts[d.status] += 1;
  const report = { projectName: str(project.name, 160), status: str(project.status, 40), progressPercent, counts };

  return {
    technical: fit(technical, ['requirements']),
    deliverables: fit(deliverablesSection, ['items']),
    finance: fit(finance, ['income', 'installments']),
    expenses: fit(expenses, ['items']),
    meetings: fit(meetingsSection, ['items']),
    report,
  };
}

// يقلّص أكبر مصفوفة تدريجيًا حتى يدخل المستند في الحد الآمن (الأحدث أولًا يبقى).
export function fit(payload, arrayKeys, limit = MAX_DOC_CHARS) {
  let out = payload;
  for (let i = 0; i < 30 && JSON.stringify(out).length > limit; i += 1) {
    const biggest = arrayKeys
      .filter((k) => Array.isArray(out[k]) && out[k].length > 0)
      .sort((a, b) => JSON.stringify(out[b]).length - JSON.stringify(out[a]).length)[0];
    if (!biggest) break;
    out = { ...out, [biggest]: out[biggest].slice(0, Math.floor(out[biggest].length * 0.8)) };
  }
  return out;
}

// بصمة سريعة (cyrb53) لمعرفة هل تغيّر القسم منذ آخر نشر.
export function hashOf(value) {
  const s = JSON.stringify(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// خطة النشر: بيانات الأقسام وسجل صلاحيات مستقل لكل ضيف. `published` يحتفظ ببصمات الأقسام والضيف والبيانات الوصفية.
export function planPublish({ ownerUid, project, config, built, published = {} }) {
  const shareId = shareIdFor(ownerUid, project.id);
  const aud = audience(config);
  const guests = cleanGuests(config && config.guests).filter((guest) => SECTIONS.some((section) => guest.access[section] !== 'none'));
  const sections = [];
  for (const section of SECTIONS) {
    const { readers } = aud[section];
    if (!readers.length) {
      sections.push({ section, op: published[section] ? 'delete' : 'skip', hash: null });
      continue;
    }
    const data = built[section];
    const hash = hashOf(data);
    sections.push({
      section, hash, op: published[section] === hash ? 'skip' : 'set',
      // لا نضع عناوين البريد أو قوائم الصلاحيات داخل مستند القسم؛ الصلاحية في access/{email}.
      doc: { ownerUid, projectId: project.id, section, data },
    });
  }

  // مستند مستقل لكل ضيف. قواعد Firestore تسمح له بقراءة مستنده فقط، ولا تسمح بتعداد المجموعة.
  const previousAccess = published.access && typeof published.access === 'object' ? published.access : {};
  const access = guests.map((guest) => {
    const sections = {};
    for (const section of SECTIONS) {
      sections[section] = {
        view: guest.access[section] === 'view' || guest.access[section] === 'edit',
        edit: guest.access[section] === 'edit',
      };
    }
    const doc = { projectName: str(project.name, 160), sections };
    const hash = hashOf(doc);
    return { email: guest.email, hash, op: previousAccess[guest.email] === hash ? 'skip' : 'set', doc };
  });
  const currentEmails = new Set(guests.map((g) => g.email));
  for (const email of Object.keys(previousAccess)) {
    if (!currentEmails.has(email)) access.push({ email, hash: null, op: 'delete', doc: null });
  }

  // مستند المشروع لا يحمل قائمة أعضاء؛ الضيوف يحصلون على الاسم من access/{their-email}.
  let meta;
  if (!guests.length) {
    meta = { op: published.meta ? 'delete' : 'skip', hash: null };
  } else {
    const hash = hashOf({ name: project.name });
    meta = {
      hash, op: published.meta === hash ? 'skip' : 'set',
      doc: { ownerUid, projectId: project.id, projectName: str(project.name, 160) },
    };
  }
  return { shareId, sections, access, meta };
}


// ====================================================================== طلبات تعديل الضيوف (المرحلة 2)
// الضيف لا يكتب في بياناتك أبدًا: ينشئ «طلبًا» في shares/{id}/requests، وبرنامج المدير يراجعه ويطبّقه بعد موافقتك.
// كل نوع طلب مرتبط بقسم واحد، ولا يُقبل إلا إن كان الضيف «عرض وتعديل» على هذا القسم لحظة الموافقة.
export const REQUEST_TYPES = {
  deliverable_status: 'deliverables', // اعتماد تسليم أو طلب تعديل عليه
  requirement_add: 'technical', // إضافة متطلب أو ملاحظة للمشروع
  meeting_note: 'meetings', // ملاحظة على اجتماع
  installment_paid: 'finance', // تسجيل دفعة على أنها دُفعت
};
export const EDITABLE_SECTIONS = Object.values(REQUEST_TYPES);
const REQ_STATUS = ['pending', 'approved', 'rejected'];
const safeId = (v) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 120);

export function normalizeRequest(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '');
  if (!Object.hasOwn(REQUEST_TYPES, type)) return null;
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {};
  return {
    id: str(id, 120), type, section: REQUEST_TYPES[type],
    targetId: str(raw.targetId, 120),
    payload: { status: str(payload.status, 20), text: str(payload.text, 2000).trim() },
    authorEmail: normalizeEmail(raw.authorEmail), authorName: str(raw.authorName, 80).trim(),
    status: REQ_STATUS.includes(raw.status) ? raw.status : 'pending',
    createdAt: num(raw.createdAt) || 0, resolvedAt: num(raw.resolvedAt) || null,
  };
}

// ما الذي يخص هذا الطلب في بياناتك الآن؟ يُستعمل للعرض وللتحقق قبل التطبيق (لا نثق بأي اسم أو قيمة من الضيف).
export function viewOf(req, { project, deliverables = [], meetings = [] }) {
  const pid = project && project.id;
  const base = { kind: req.type, projectName: project ? str(project.name, 160) : '', targetName: '', current: '', valid: true, reason: '' };
  const bad = (reason) => ({ ...base, valid: false, reason });
  if (!project) return bad('project_missing');
  if (req.type === 'deliverable_status') {
    const d = forProject(deliverables, pid).find((x) => x.id === req.targetId);
    if (!d) return bad('target_missing');
    if (!['approved', 'revision'].includes(req.payload.status)) return bad('invalid');
    return { ...base, targetName: str(d.name, 160), current: str(d.status, 20) };
  }
  if (req.type === 'requirement_add') {
    if (!req.payload.text) return bad('invalid');
    return base;
  }
  if (req.type === 'meeting_note') {
    const m = forProject(meetings, pid).find((x) => x.id === req.targetId);
    if (!m) return bad('target_missing');
    if (!req.payload.text) return bad('invalid');
    return { ...base, targetName: str(m.title, 160) };
  }
  if (req.type === 'installment_paid') {
    const inst = (Array.isArray(project.installments) ? project.installments : []).find((i) => i && i.id === req.targetId);
    if (!inst) return bad('target_missing');
    return { ...base, targetName: str(inst.title || inst.name || '', 80), current: inst.status === 'paid' ? 'paid' : 'pending', amount: Math.max(0, num(inst.amount)) };
  }
  return bad('invalid');
}

const fail = (reason) => ({ ok: false, reason });

// خطة تطبيق الطلب على بياناتك الأصلية: قائمة حفظ مرتبة. لا تنفيذ هنا — الدالة نقية للاختبار.
// undo: مستند أنشأناه قبل خطوة قد تفشل، يُحذف إن فشلت التالية.
export function planApply({ req, config, project, deliverables = [], meetings = [], now = Date.now(), today }) {
  if (!req || req.status !== 'pending') return fail('resolved');
  const guest = cleanGuests(config && config.guests).find((g) => g.email === req.authorEmail);
  if (!guest || guest.access[req.section] !== 'edit') return fail('no_access');
  const v = viewOf(req, { project, deliverables, meetings });
  if (!v.valid) return fail(v.reason);
  const who = req.authorName || req.authorEmail;

  if (req.type === 'deliverable_status') {
    const d = forProject(deliverables, project.id).find((x) => x.id === req.targetId);
    if (req.payload.status === 'approved') {
      if (d.status === 'approved') return { ok: true, saves: [], noop: true };
      return { ok: true, saves: [{ col: 'deliverables', doc: { ...d, status: 'approved', updatedAt: now } }] };
    }
    const applied = Array.isArray(d.appliedRequestIds) ? d.appliedRequestIds : [];
    if (applied.includes(req.id)) return { ok: true, saves: [], noop: true }; // أُعيدت الموافقة بعد فشل جزئي: لا نزيد الإصدار مرتين
    const rev = (Number(d.rev) || 1) + 1;
    const notes = `${d.notes ? d.notes + ' · ' : ''}تعديل (${who}): ${req.payload.text || '—'}`.slice(0, 1000);
    return { ok: true, saves: [{ col: 'deliverables', doc: { ...d, status: 'revision', rev, notes, appliedRequestIds: [...applied, req.id].slice(-50), updatedAt: now } }] };
  }
  if (req.type === 'requirement_add') {
    return { ok: true, saves: [{ col: 'requirements', doc: {
      id: `gr_${safeId(req.id)}`, projectId: project.id, text: req.payload.text.slice(0, 1200), source: 'guest', sourceId: req.id,
      sourceLabel: who, date: today, status: 'open', createdAt: now, updatedAt: now,
    } }] };
  }
  if (req.type === 'meeting_note') {
    const m = forProject(meetings, project.id).find((x) => x.id === req.targetId);
    const applied = Array.isArray(m.appliedRequestIds) ? m.appliedRequestIds : [];
    if (applied.includes(req.id)) return { ok: true, saves: [], noop: true };
    const line = `— ملاحظة من ${who} (${today}): ${req.payload.text.slice(0, 2000)}`;
    const minutes = Array.isArray(m.minutes) ? [...m.minutes, line] : `${m.minutes ? m.minutes + '\n\n' : ''}${line}`;
    return { ok: true, saves: [{ col: 'meetings', doc: { ...m, minutes, appliedRequestIds: [...applied, req.id].slice(-50), updatedAt: now } }] };
  }
  // installment_paid — نفس خطوات البرنامج عند تسجيل دفعة: حركة تحصيل ثم تحديث الدفعة في المشروع
  const list = Array.isArray(project.installments) ? project.installments : [];
  const inst = list.find((i) => i && i.id === req.targetId);
  if (inst.status === 'paid') return { ok: true, saves: [], noop: true };
  const entry = {
    id: `installment_${inst.id}`, projectId: project.id, kind: 'income', amount: Math.max(0, num(inst.amount)), date: today,
    category: 'دفعة تعاقد', description: `تحصيل دفعة: ${inst.title || inst.name || 'دفعة'}`, installmentId: inst.id, createdAt: now,
  };
  const updated = { ...project, installments: list.map((x) => (x.id === inst.id ? { ...x, status: 'paid', paidAt: today } : x)), updatedAt: now };
  return { ok: true, saves: [{ col: 'financeEntries', doc: entry, undo: { col: 'financeEntries', id: entry.id } }, { col: 'projects', doc: updated }] };
}
