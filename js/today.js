// شاشة «النهارده» وتحليل رسائل الالتقاط — دوال نقية بلا اعتماد على DOM لتسهيل الاختبار.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function normDigits(s) {
  return String(s ?? '').replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).replace(/[٬,](?=\d{3}\b)/g, '');
}

// توحيد الحروف العربية للمطابقة المرنة.
export function normAr(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const STOP = new Set(['في', 'على', 'من', 'الي', 'عن', 'مع', 'ده', 'دي', 'دا', 'هذا', 'هذه', 'ال', 'لو', 'يا', 'انا', 'احنا', 'عايزين', 'عايز', 'محتاج', 'محتاجه', 'مطلوب', 'تعديل', 'لوحه', 'لوحات', 'اللوحه', 'ملف', 'بتاع', 'بتاعه', 'بتاعت']);
function tokens(s) {
  return normAr(s).split(' ').map((w) => w.replace(/^ال/, '')).filter((w) => w.length > 2 && !STOP.has(w));
}

// ---------------------------------------------------------------- الأرقام والمبالغ
const UNITS = {
  واحد: 1, اتنين: 2, اثنين: 2, تلاته: 3, ثلاثه: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5, سته: 6, ست: 6, سبعه: 7, سبع: 7, تمانيه: 8, ثمانيه: 8, تمن: 8, تسعه: 9, تسع: 9, عشره: 10, عشر: 10,
  حداشر: 11, اتناشر: 12, اثناشر: 12, تلتاشر: 13, تلاتاشر: 13, اربعتاشر: 14, خمستاشر: 15, ستاشر: 16, سبعتاشر: 17, تمنتاشر: 18, تسعتاشر: 19,
  عشرين: 20, تلاتين: 30, ثلاثين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, تمانين: 80, ثمانين: 80, تسعين: 90,
  ميه: 100, مايه: 100, مئه: 100, ميت: 100, مية: 100, ميتين: 200, تلتميه: 300, تلتمية: 300, ربعميه: 400, خمسميه: 500, ستميه: 600, سبعميه: 700, تمنميه: 800, تسعميه: 900,
};
const BIG = { الف: 1000, الاف: 1000, الآف: 1000, مليون: 1000000, ملايين: 1000000 };

/** يطلع أول مبلغ في الجملة: أرقام أو كلام بالعامية («خمستاشر ألف»). يرجع 0 لو لم يجد. */
export function parseAmount(text) {
  const s = normDigits(text);
  const m = s.match(/(\d+(?:\.\d+)?)\s*(الف|ألف|آلاف|الاف|k|مليون)?/i);
  if (m && Number(m[1]) > 0) {
    const mult = m[2] ? (/مليون/.test(m[2]) ? 1e6 : 1000) : 1;
    const v = Number(m[1]) * mult;
    if (v >= 1) return Math.round(v);
  }
  const words = normAr(s).split(' ');
  let total = 0, current = 0, found = false;
  for (const raw of words) {
    const w = raw.replace(/^و(?=[^و])/, '');
    if (UNITS[w] !== undefined) { current += UNITS[w]; found = true; }
    else if (BIG[w] !== undefined && (found || current)) { total += (current || 1) * BIG[w]; current = 0; found = true; }
    else if (found && !/^(و|ج|جنيه|جنيها|ريال|دولار|مبلغ)$/.test(w)) break;
  }
  total += current;
  return found && total > 0 ? total : 0;
}

// ---------------------------------------------------------------- الأيام
export function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T00:00:00Z`), b = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}
export function isoOfMs(ms) { return new Date(ms).toISOString().slice(0, 10); }

// ---------------------------------------------------------------- بيانات شاشة النهارده
export function buildToday({ projects = [], deliverables = [], tasks = [], meetings = [], today }) {
  const live = projects.filter((p) => !p.archivedAt && p.status !== 'completed');
  const byId = new Map(projects.map((p) => [p.id, p]));
  const late = [];
  let dueTotal = 0;
  for (const p of live) {
    for (const i of p.installments || []) {
      if (i.status === 'paid' || !i.dueDate) continue;
      const amount = Math.max(0, Number(i.amount) || 0);
      if (i.dueDate <= today) {
        dueTotal += amount;
        late.push({ projectId: p.id, projectName: p.name, client: p.client || '', installmentId: i.id, title: i.title || '', amount, dueDate: i.dueDate, days: Math.max(0, daysBetween(i.dueDate, today)) });
      }
    }
  }
  late.sort((a, b) => b.days - a.days);

  const waiting = deliverables
    .filter((d) => d.status === 'submitted' && byId.has(d.projectId) && !byId.get(d.projectId).archivedAt)
    .map((d) => {
      const since = d.submittedAt ? isoOfMs(d.submittedAt) : d.updatedAt ? isoOfMs(d.updatedAt) : today;
      const p = byId.get(d.projectId);
      return { id: d.id, projectId: d.projectId, projectName: p.name, client: p.client || '', name: d.name, rev: Number(d.rev) || 1, days: Math.max(0, daysBetween(since, today)) };
    })
    .sort((a, b) => b.days - a.days);

  const open = tasks.filter((t) => t.status !== 'done');
  const todayTasks = open.filter((t) => t.date === today).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const lateTasks = open.filter((t) => t.date && t.date < today);
  const todayMeetings = meetings.filter((m) => m.date === today);
  return { dueTotal, late, waiting, todayTasks, lateTasks, todayMeetings, counts: { late: late.length, tasks: todayTasks.length } };
}

/** بعد كم تعديل نعتبر العميل تعدّى المشمول في العقد؟ revisionsIncluded على المشروع (الافتراضي 2). */
export function revisionState(project, deliverable) {
  const raw = project?.revisionsIncluded;
  const included = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : 2;
  const rev = Math.max(1, Number(deliverable?.rev) || 1);
  const requested = rev - 1;
  return { rev, requested, included, over: requested > included };
}

// ---------------------------------------------------------------- تحليل رسالة الالتقاط
const RE_PAY = /(حوّل|حول|حولت|حوّلت|تحويل|دفع|دفعت|سدد|سددت|استلم|وصل|ارسل.*فلوس|transfer|paid|payment)/i;
const RE_REV = /(تعديل|تعديلات|عدّل|عدل|غيّر|غير|بدّل|بدل|مراجعه|مراجعة|ملاحظات|revise|revision|change)/i;
const RE_NEED = /(عايزين|عايز|محتاج|محتاجين|مطلوب|نحتاج|نريد|ابعتلي|ابعت|need|want|please send)/i;
const RE_ITEM = /(لوحه|لوحة|لوحات|شوب|مخطط|مسقط|واجهه|واجهة|رندر|3d|ثري دي|بلان|plan|elevation|section|مقطع|تفاصيل)/i;
const RE_APPROVE = /(وافق|موافق|معتمد|اعتمد|اعتمدنا|approved|اتوافق)/i;

export function splitClauses(text) {
  return String(text ?? '')
    .split(/[.!؟?\n،,؛;]+|\s+و(?=(?:أنا|انا|عايز|محتاج|حوّل|حول|حولت|ابعت|كمان|احنا))/)
    .map((s) => s.trim()).filter((s) => s.length > 3);
}

function bestDeliverable(clause, list) {
  const ct = new Set(tokens(clause));
  let best = null, score = 0;
  for (const d of list) {
    const dt = tokens(d.name);
    const s = dt.reduce((n, w) => n + (ct.has(w) ? 1 : 0), 0);
    if (s > score) { score = s; best = d; }
  }
  return score > 0 ? best : null;
}

function itemNameFrom(clause) {
  const m = clause.match(/(?:لوحة|لوحه|لوحات|شوب|مخطط|مسقط|واجهة|واجهه|رندر|بلان)\s+((?:ال)?[؀-ۿA-Za-z0-9]+(?:\s+(?:ال)?[؀-ۿA-Za-z0-9]+){0,2})/);
  if (!m) return '';
  const full = m[0].trim();
  return full.replace(/\s+(?:و|ده|دي|دا|كمان|بكره|بكرة)$/i, '');
}

/**
 * يحوّل نص (صوت/كتابة/واتساب) إلى إجراءات مقترحة. لا يكتب شيئًا — المراجعة والحفظ في التطبيق.
 * kind: revision | payment | approve | new
 */
export function parseCaptureActions(text, { project, deliverables = [] } = {}) {
  const actions = [];
  const list = project ? deliverables.filter((d) => d.projectId === project.id) : deliverables;
  const pending = project ? (project.installments || []).filter((i) => i.status !== 'paid') : [];
  let n = 0;
  for (const clause of splitClauses(text)) {
    const norm = normAr(clause);
    const amount = parseAmount(clause);
    const id = `a${++n}`;
    if (RE_PAY.test(clause) && (amount > 0 || /فلوس|دفعه|مبلغ/.test(norm))) {
      const sameAmount = amount ? pending.find((i) => Number(i.amount) === amount) : null;
      const inst = sameAmount || [...pending].sort((a, b) => String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')))[0] || null;
      actions.push({ id, kind: 'payment', text: clause, amount, installmentId: inst?.id || null, installmentTitle: inst?.title || '', needsConfirm: true, exact: !!sameAmount });
      continue;
    }
    if (RE_APPROVE.test(clause)) {
      const d = bestDeliverable(clause, list);
      if (d) { actions.push({ id, kind: 'approve', text: clause, deliverableId: d.id, name: d.name }); continue; }
    }
    if (RE_REV.test(clause)) {
      const d = bestDeliverable(clause, list);
      const target = d ? d.name : (itemNameFrom(clause) || clause.replace(RE_REV, '').trim().slice(0, 60));
      actions.push({ id, kind: 'revision', text: clause, deliverableId: d?.id || null, name: target });
      continue;
    }
    if (RE_NEED.test(clause) && RE_ITEM.test(clause)) {
      const name = itemNameFrom(clause);
      if (name) {
        const exists = list.find((d) => normAr(d.name) === normAr(name));
        if (!exists) actions.push({ id, kind: 'new', text: clause, name });
      }
    }
  }
  return actions;
}

export const ACTION_KIND = {
  revision: ['طلب تعديل', 'Revision request'],
  payment: ['دفعة مستلمة', 'Payment received'],
  approve: ['اعتماد', 'Approved'],
  new: ['لوحة جديدة', 'New drawing'],
};
