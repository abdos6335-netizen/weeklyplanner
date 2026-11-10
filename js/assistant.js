// منطق المدير الذكي واستخراج متطلبات واتساب. دوال نقية بلا DOM حتى يسهل اختبارها.
import * as D from './dates.js';

// ------------------------------------------------------------------ WhatsApp
// يدعم تصدير أندرويد «12/03/2026, 10:45 - الاسم: نص» وآيفون «[12/03/2026, 10:45:12] الاسم: نص».
const LINE_RES = [
  /^‎?\[?(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}),?\s+(\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s?[APap][Mm]|\s?[صم])?)\]?\s*(?:-\s*)?(.*)$/,
];
const toISO = (raw) => {
  const p = raw.split(/[\/.\-]/).map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return '';
  let [a, b, c] = p; let y, m, d;
  if (a > 31) { y = a; m = b; d = c; } else { d = a; m = b; y = c < 100 ? 2000 + c : c; if (m > 12 && d <= 12) [d, m] = [m, d]; }
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? D.iso(dt) : '';
};
export function parseWhatsAppChat(raw) {
  const msgs = []; let cur = null;
  for (const lineRaw of String(raw || '').replace(/\r/g, '').split('\n')) {
    const line = lineRaw.replace(/[‎‏‪-‮]/g, '');
    const m = LINE_RES[0].exec(line);
    if (m) {
      const rest = m[3] || ''; const i = rest.indexOf(': ');
      if (i > 0 && i < 60) { cur = { date: toISO(m[1]), time: m[2], sender: rest.slice(0, i).trim(), text: rest.slice(i + 2).trim() }; msgs.push(cur); }
      else cur = null; // رسالة نظام (تشفير، انضمام…)
    } else if (cur && line.trim()) cur.text += '\n' + line.trim();
  }
  if (!msgs.length) {
    return String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean).map((text) => ({ date: '', time: '', sender: '', text }));
  }
  return msgs.filter((x) => x.text && !/^<?(?:Media omitted|تم استبعاد الوسائط|الوسائط مستبعدة)>?$/i.test(x.text) && !/محذوفة|This message was deleted/.test(x.text));
}
export const senderList = (msgs) => [...new Set(msgs.map((m) => m.sender).filter(Boolean))];

const CUES = /(عايز|عاوز|عايزه|عايزين|محتاج|محتاجين|نحتاج|احتاج|أحتاج|أريد|اريد|نبغى|نبغي|ممكن|يا ?ريت|ياريت|لو سمحت|من فضلك|ياريت|غير|غيّر|نغير|تغيير|عدل|عدّل|تعديل|ضيف|أضف|اضف|إضافة|اضافة|شيل|احذف|حذف|استبدل|بدل|خلي|خلّي|لازم|يجب|مطلوب|ناقص|مش عاجب|مش عجبني|بدل ما|نزود|زود|كبّر|كبر|صغّر|صغر|لون|مقاس|مكان|please|can you|could you|would you|need|want|change|add|remove|replace|make it|should|must|prefer|instead)/i;
const NOISE = /^(?:شكرا|شكراً|تمام|ok|okay|اوك|أوك|تم|الله يعطيك العافية|صباح الخير|مساء الخير|السلام عليكم|وعليكم السلام|thanks|thank you|👍|🙏)[\s.!؟?]*$/i;
const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function extractRequirements(msgs, { clientSenders = null, existing = [] } = {}) {
  const known = existing.map((r) => norm(r.text));
  const out = []; const seen = new Set();
  for (const m of msgs) {
    if (clientSenders && clientSenders.size && !clientSenders.has(m.sender)) continue;
    for (const part of String(m.text).split(/\n+/)) {
      const text = part.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
      if (text.length < 8 || NOISE.test(text)) continue;
      const cue = CUES.test(text); const q = /[؟?]\s*$/.test(text);
      if (!cue) continue;
      const score = 1 + (q ? 0 : 1) + Math.min(2, (text.match(CUES) || []).length);
      const key = norm(text);
      if (!key || seen.has(key) || known.some((k) => k === key || (k.length > 12 && (k.includes(key) || key.includes(k))))) continue;
      seen.add(key);
      out.push({ text: text.slice(0, 400), date: m.date || '', sender: m.sender || '', score });
    }
  }
  return out;
}

// ------------------------------------------------------------------ المدير الذكي
const DONE_DELIV = new Set(['approved', 'delivered', 'done', 'completed']);
const daysBetween = (a, b) => Math.round((D.parse(b) - D.parse(a)) / 86400000);

export function buildManagerReport({ tasks, projects, deliverables, financeEntries, today, totalsFor, progressFor, targets = {} }) {
  const pname = (id) => projects.find((p) => p.id === id)?.name || '';
  const items = [];
  const push = (kind, title, date, projectId, base, extra = {}) => {
    const delta = date ? daysBetween(today, date) : 99;
    let score = base;
    if (delta < 0) score += 100 + Math.min(40, -delta * 2);
    else if (delta === 0) score += 80;
    else if (delta === 1) score += 60;
    else if (delta <= 3) score += 45;
    else if (delta <= 7) score += 30;
    else score += 5;
    const reason = delta < 0 ? 'late' : delta === 0 ? 'today' : delta === 1 ? 'tomorrow' : delta <= 7 ? 'week' : 'later';
    items.push({ kind, title, date: date || '', projectId, project: pname(projectId), score, reason, delta, ...extra });
  };
  for (const x of tasks) if (x.status !== 'done') push('task', x.title, x.date, x.projectId, (Number(x.priority) - 1) * 15, { id: x.id, priority: Number(x.priority) || 2 });
  for (const d of deliverables) if (!DONE_DELIV.has(d.status) && d.dueDate) push('deliverable', d.name || d.kind || 'Deliverable', d.dueDate, d.projectId, 10, { id: d.id });
  for (const p of projects) {
    if (p.archivedAt) continue;
    if (p.followUpDate) push('followup', p.followUpNote || p.name, p.followUpDate, p.id, 5, { id: p.id });
    for (const i of p.installments || []) if (i.status !== 'paid' && i.dueDate) push('installment', i.title || i.name || 'Installment', i.dueDate, p.id, 20, { amount: Number(i.amount) || 0 });
  }
  items.sort((a, b) => b.score - a.score);
  const priorities = items.filter((x) => x.delta <= 7).slice(0, 8);
  const todayItems = items.filter((x) => x.delta <= 0).slice(0, 10);
  const week = {};
  for (let i = 0; i < 7; i++) { const d = D.addDays(today, i); week[d] = items.filter((x) => x.date === d); }
  const late = items.filter((x) => x.delta < 0);

  const alerts = [];
  const lateTasks = late.filter((x) => x.kind === 'task');
  if (lateTasks.length) alerts.push({ level: 'high', key: 'late_tasks', n: lateTasks.length, text: lateTasks.slice(0, 3).map((x) => x.title).join(' · ') });
  const lateDel = late.filter((x) => x.kind === 'deliverable');
  if (lateDel.length) alerts.push({ level: 'high', key: 'late_deliverables', n: lateDel.length, text: lateDel.slice(0, 3).map((x) => `${x.title}${x.project ? ' — ' + x.project : ''}`).join(' · ') });
  const inst = items.filter((x) => x.kind === 'installment' && x.delta <= 3);
  if (inst.length) alerts.push({ level: inst.some((x) => x.delta < 0) ? 'high' : 'mid', key: 'installments', n: inst.length, text: inst.slice(0, 3).map((x) => `${x.project} — ${x.title}`).join(' · ') });
  const fups = items.filter((x) => x.kind === 'followup' && x.delta <= 3);
  if (fups.length) alerts.push({ level: 'mid', key: 'followups', n: fups.length, text: fups.slice(0, 3).map((x) => x.project).join(' · ') });

  const perProject = [];
  let tIncome = 0, tExpense = 0, tContract = 0;
  for (const p of projects) {
    if (p.archivedAt) continue;
    const f = totalsFor(p); const pr = progressFor(p);
    tIncome += f.income; tExpense += f.expense; tContract += f.contract;
    const flags = [];
    if (f.net < 0) flags.push('negative');
    else if (f.profitPct !== null && targets.profit && f.profitPct < targets.profit) flags.push('low_margin');
    if (f.collectionPct !== null && pr?.percent != null && pr.percent - f.collectionPct >= 25) flags.push('collection_behind');
    if (f.contract > 0 && f.income === 0 && p.status === 'active') flags.push('no_collection');
    perProject.push({ id: p.id, name: p.name, income: f.income, expense: f.expense, net: f.net, contract: f.contract, collectionPct: f.collectionPct, profitPct: f.profitPct, progress: pr?.percent ?? null, flags });
  }
  const finance = { income: tIncome, expense: tExpense, net: tIncome - tExpense, outstanding: Math.max(0, tContract - tIncome), perProject, flagged: perProject.filter((p) => p.flags.length) };
  for (const p of finance.flagged) alerts.push({ level: p.flags.includes('negative') ? 'high' : 'mid', key: 'finance', n: 1, text: `${p.name}: ${p.flags.join(', ')}`, flags: p.flags, project: p.name });
  return { priorities, todayItems, week, alerts, finance, counts: { open: items.length, late: late.length } };
}

// نية الأمر النصي/الصوتي الموجّه للمدير. يعيد null إذا لم يكن استعلامًا (يُمرَّر لمحلل الأوامر العادي).
export function managerIntent(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (/(مالي|ماليه|تحصيل|ربح|مصروف|finance|profit|collect)/i.test(s) && /(حلل|تحليل|وضع|حالة|كام|ايه|إيه|analy|status|how)/i.test(s)) return 'finance';
  if (/(خطة|خطه|plan).*(أسبوع|اسبوع|week)|(أسبوع|اسبوع|week).*(خطة|خطه|plan)/i.test(s)) return 'week';
  if (/(خطة|خطه|plan).*(يوم|اليوم|النهارده|today)|(ماذا|ايه|إيه|what).*(اليوم|النهارده|today)/i.test(s)) return 'today';
  if (/(تنبيه|متأخر|تأخير|alert|late|overdue)/i.test(s) && !/(ذكرني|remind)/i.test(s)) return 'alerts';
  if (/(أولوي|اولوي|رتب|priorit|أهم|اهم)/i.test(s)) return 'priorities';
  return null;
}
