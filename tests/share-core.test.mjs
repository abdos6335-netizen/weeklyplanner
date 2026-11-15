// تشغيل: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS, PRESETS, normalizeEmail, shareIdFor, cleanGuests, audience, membersOf,
  buildSections, fit, hashOf, planPublish,
} from '../js/share-core.js';

// كل قيمة «سرّية» تحمل علامة SECRET_ حتى نتأكد أنها لا تظهر في أي قسم.
const project = {
  id: 'p1', name: 'فيلا التجمع', type: 'residential', status: 'active', startDate: '2026-01-01', endDate: '2026-06-01',
  workScope: ['design', '3d'], contractValue: 100000,
  client: 'SECRET_CLIENT', location: 'SECRET_LOCATION', notes: 'SECRET_NOTES', followUpNote: 'SECRET_FOLLOWUP',
  links: [{ id: 'l', title: 'SECRET_LINK', url: 'https://secret.example' }], profitSharePct: 40, archivedAt: null,
  installments: [
    { id: 'i1', title: 'مقدم', amount: 30000, status: 'paid', dueDate: '2026-01-05', paidAt: '2026-01-06', secretField: 'SECRET_INST' },
    { id: 'i2', title: 'دفعة ثانية', amount: 20000, status: 'pending', dueDate: '2026-03-01' },
  ],
};
const deliverables = [
  { id: 'd1', projectId: 'p1', name: 'مسقط', stage: 'design', kind: 'plan', status: 'approved', rev: 2, dueDate: '2026-02-01', notes: 'SECRET_DELIV_NOTE', source: 'SECRET_SOURCE', submittedAt: 1700000000000 },
  { id: 'd2', projectId: 'p1', name: 'قطاع', stage: 'technical', kind: 'section', status: 'revision', rev: 1, notes: 'SECRET_DELIV_NOTE2' },
  { id: 'd3', projectId: 'OTHER', name: 'SECRET_OTHER_PROJECT_DELIVERABLE', status: 'pending' },
];
const financeEntries = [
  { id: 'f1', projectId: 'p1', kind: 'income', amount: 30000, date: '2026-01-06', category: 'دفعة تعاقد', description: 'SECRET_INCOME_DESC' },
  { id: 'f2', projectId: 'p1', kind: 'expense', amount: 12000, date: '2026-02-01', category: 'خامات', description: 'SECRET_EXPENSE_DESC' },
  { id: 'f3', projectId: 'OTHER', kind: 'income', amount: 999999, date: '2026-02-01', category: 'SECRET_OTHER_CAT' },
];
const meetings = [
  { id: 'm1', projectId: 'p1', title: 'اجتماع 1', date: '2026-02-02', decisions: 'قرار', actions: ['أ', 'ب'], minutes: 'محضر', transcript: 'SECRET_TRANSCRIPT', audioFileName: 'SECRET_AUDIO', hasAudio: true, requirements: 'SECRET_RAW_REQ', secondParty: 'SECRET_CLIENT' },
  { id: 'm2', projectId: 'OTHER', title: 'SECRET_OTHER_MEETING', date: '2026-02-03' },
];
const requirements = [
  { id: 'r1', projectId: 'p1', text: 'غيّر لون الحائط', status: 'open', date: '2026-02-04', source: 'whatsapp', sourceLabel: 'SECRET_SENDER', sourceId: 'SECRET_SRC_ID' },
  { id: 'r2', projectId: 'OTHER', text: 'SECRET_OTHER_REQ' },
];
const progress = { percent: 50, phases: [{ key: 'design', label: 'التصميم', done: 1, total: 2, percent: 50, items: 'SECRET_PHASE_ITEMS' }] };

const built = () => buildSections({ project, deliverables, financeEntries, meetings, requirements, progress });

test('لا يتسرب أي حقل سرّي ولا بيانات مشروع آخر إلى أي قسم', () => {
  const b = built();
  const all = JSON.stringify(b);
  assert.ok(!all.includes('SECRET_'), 'تسرّبت قيمة سرّية: ' + (all.match(/SECRET_[A-Z_0-9]*/g) || []).join(','));
  assert.ok(!all.includes('999999'));
  assert.ok(!all.includes('profitShare'));
});

test('قسم الماليات لا يحتوي مصروفات، وقسم المصروفات لا يحتوي تحصيلات', () => {
  const b = built();
  const fin = JSON.stringify(b.finance);
  assert.ok(!fin.includes('12000') && !fin.includes('expense'));
  assert.equal(b.finance.collected, 30000);
  assert.equal(b.finance.remaining, 70000);
  assert.equal(b.finance.collectionPct, 30);
  assert.equal(b.expenses.total, 12000);
  assert.ok(!JSON.stringify(b.expenses).includes('دفعة تعاقد'));
});

test('الأقسام تحمل البيانات المتوقعة', () => {
  const b = built();
  assert.equal(b.technical.requirements.length, 1);
  assert.equal(b.technical.progress.percent, 50);
  assert.equal(b.deliverables.items.length, 2);
  assert.equal(b.meetings.items.length, 1);
  assert.equal(b.meetings.items[0].actions, 'أ\nب');
  assert.deepEqual(b.report.counts, { total: 2, pending: 0, submitted: 0, approved: 1, revision: 1 });
  assert.equal(b.finance.installments[0].status, 'paid');
});

test('حالة تسليم غريبة لا تكسر العدّاد', () => {
  const b = buildSections({ project, deliverables: [{ id: 'x', projectId: 'p1', status: 'constructor' }, { id: 'y', projectId: 'p1', status: 'total' }], financeEntries: [], meetings: [], requirements: [], progress: null });
  assert.equal(b.report.counts.total, 2);
  assert.equal(typeof b.report.counts.approved, 'number');
});

test('normalizeEmail', () => {
  assert.equal(normalizeEmail('  Ali@Example.COM '), 'ali@example.com');
  for (const bad of ['', 'x', 'a@b', 'a b@c.com', 'a@b.c,d@e.f', '<a@b.com>', null, undefined]) assert.equal(normalizeEmail(bad), '', String(bad));
});

test('shareIdFor يبدأ بـ uid المدير ولا يحتوي /', () => {
  const id = shareIdFor('UID123', 'a/b c');
  assert.ok(id.startsWith('UID123_'));
  assert.ok(!id.includes('/'));
});

test('cleanGuests يزيل المكرر والبريد الخاطئ ويطبّع الصلاحيات', () => {
  const g = cleanGuests([
    { email: 'A@x.com', access: { technical: 'view', finance: 'hax', bogus: 'view' } },
    { email: 'a@x.com', access: { technical: 'edit' } },
    { email: 'bad' },
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].access.technical, 'view');
  assert.equal(g[0].access.finance, 'none');
  assert.ok(!('bogus' in g[0].access));
});

test('الجمهور: كل قسم يقرأه من أُعطي صلاحيته فقط', () => {
  const config = { guests: [
    { email: 'client@x.com', access: PRESETS.client },
    { email: 'worker@x.com', access: PRESETS.contractor },
  ] };
  const aud = audience(config);
  assert.deepEqual(aud.finance.readers, ['client@x.com']);
  assert.deepEqual(aud.technical.readers, ['client@x.com', 'worker@x.com']);
  assert.deepEqual(aud.expenses.readers, []);
  assert.deepEqual(aud.meetings.readers, []);
  assert.deepEqual(membersOf(config), ['client@x.com', 'worker@x.com']);
});

test('خطة النشر: أقسام بلا قراء لا تُكتب أبدًا', () => {
  const config = { guests: [{ email: 'worker@x.com', access: PRESETS.contractor }] };
  const plan = planPublish({ ownerUid: 'U', project, config, built: built() });
  const byName = Object.fromEntries(plan.sections.map((s) => [s.section, s]));
  assert.equal(byName.finance.op, 'skip');
  assert.equal(byName.expenses.op, 'skip');
  assert.equal(byName.meetings.op, 'skip');
  assert.equal(byName.technical.op, 'set');
  assert.deepEqual(byName.technical.doc.readers, ['worker@x.com']);
  assert.equal(plan.meta.op, 'set');
  assert.deepEqual(plan.meta.doc.members, ['worker@x.com']);
  assert.ok(plan.shareId.startsWith('U_'));
});

test('خطة النشر: بدون تغيير لا كتابة، وتغيير البيانات يكتب القسم المتأثر فقط', () => {
  const config = { guests: [{ email: 'c@x.com', access: PRESETS.client }] };
  const first = planPublish({ ownerUid: 'U', project, config, built: built() });
  const published = Object.fromEntries([...first.sections.filter((s) => s.hash).map((s) => [s.section, s.hash]), ['meta', first.meta.hash]]);
  const again = planPublish({ ownerUid: 'U', project, config, built: built(), published });
  assert.ok(again.sections.every((s) => s.op === 'skip') && again.meta.op === 'skip');

  const changed = buildSections({ project, deliverables: [...deliverables, { id: 'd9', projectId: 'p1', name: 'جديد', status: 'pending' }], financeEntries, meetings, requirements, progress });
  const third = planPublish({ ownerUid: 'U', project, config, built: changed, published });
  const ops = Object.fromEntries(third.sections.map((s) => [s.section, s.op]));
  assert.equal(ops.deliverables, 'set');
  assert.equal(ops.report, 'set');
  assert.equal(ops.technical, 'skip');
  assert.equal(ops.finance, 'skip');
});

test('سحب الصلاحية: إزالة ضيف أو قسم تُحدّث القراء أو تحذف القسم', () => {
  const both = { guests: [{ email: 'c@x.com', access: PRESETS.client }, { email: 'd@x.com', access: PRESETS.client }] };
  const p1 = planPublish({ ownerUid: 'U', project, config: both, built: built() });
  const published = Object.fromEntries([...p1.sections.filter((s) => s.hash).map((s) => [s.section, s.hash]), ['meta', p1.meta.hash]]);

  const onlyOne = { guests: [{ email: 'c@x.com', access: PRESETS.client }] };
  const p2 = planPublish({ ownerUid: 'U', project, config: onlyOne, built: built(), published });
  const fin = p2.sections.find((s) => s.section === 'finance');
  assert.equal(fin.op, 'set');
  assert.deepEqual(fin.doc.readers, ['c@x.com']);

  const nobody = planPublish({ ownerUid: 'U', project, config: { guests: [] }, built: built(), published });
  assert.ok(nobody.sections.filter((s) => published[s.section]).every((s) => s.op === 'delete'));
  assert.equal(nobody.meta.op, 'delete');

  const noFinance = { guests: [{ email: 'c@x.com', access: { ...PRESETS.client, finance: 'none' } }] };
  const p3 = planPublish({ ownerUid: 'U', project, config: noFinance, built: built(), published });
  assert.equal(p3.sections.find((s) => s.section === 'finance').op, 'delete');
});

test('fit يقلّص المصفوفات الكبيرة ويحافظ على الأحدث', () => {
  const big = { items: Array.from({ length: 2000 }, (_, i) => ({ id: i, text: 'x'.repeat(500) })) };
  const out = fit(big, ['items'], 100000);
  assert.ok(JSON.stringify(out).length <= 100000);
  assert.equal(out.items[0].id, 0);
});

test('hashOf ثابت ويتغير بتغير القيمة', () => {
  assert.equal(hashOf({ a: 1 }), hashOf({ a: 1 }));
  assert.notEqual(hashOf({ a: 1 }), hashOf({ a: 2 }));
});

test('كل الأقسام معرّفة في القوالب', () => {
  for (const p of Object.values(PRESETS)) assert.deepEqual(Object.keys(p).sort(), [...SECTIONS].sort());
});
