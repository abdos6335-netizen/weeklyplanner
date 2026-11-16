// تشغيل: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS, PRESETS, normalizeEmail, shareIdFor, cleanGuests, audience, membersOf,
  buildSections, fit, hashOf, planPublish,
  REQUEST_TYPES, EDITABLE_SECTIONS, normalizeRequest, viewOf, planApply,
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

test('خطة النشر: بيانات الأقسام والبيانات الوصفية لا تكشف بريد أي ضيف', () => {
  const config = { guests: [{ email: 'worker@x.com', access: PRESETS.contractor }] };
  const plan = planPublish({ ownerUid: 'U', project, config, built: built() });
  const byName = Object.fromEntries(plan.sections.map((s) => [s.section, s]));
  assert.equal(byName.finance.op, 'skip');
  assert.equal(byName.expenses.op, 'skip');
  assert.equal(byName.meetings.op, 'skip');
  assert.equal(byName.technical.op, 'set');
  assert.ok(!('readers' in byName.technical.doc) && !('editors' in byName.technical.doc));
  assert.ok(!JSON.stringify(byName).includes('worker@x.com'));
  assert.equal(plan.meta.op, 'set');
  assert.ok(!('members' in plan.meta.doc));
  assert.ok(!JSON.stringify(plan.meta.doc).includes('worker@x.com'));
  assert.equal(plan.access.length, 1);
  assert.equal(plan.access[0].email, 'worker@x.com');
  assert.equal(plan.access[0].doc.sections.technical.view, true);
  assert.equal(plan.access[0].doc.sections.technical.edit, false);
  assert.equal(plan.access[0].doc.sections.finance.view, false);
  assert.ok(plan.shareId.startsWith('U_'));
});

test('خطة النشر: لا كتابة عند عدم التغيير، وتحديث البيانات يكتب الأقسام المتأثرة فقط', () => {
  const config = { guests: [{ email: 'c@x.com', access: PRESETS.client }] };
  const first = planPublish({ ownerUid: 'U', project, config, built: built() });
  const published = Object.fromEntries([...first.sections.filter((s) => s.hash).map((s) => [s.section, s.hash]), ['meta', first.meta.hash]]);
  published.access = Object.fromEntries(first.access.filter((a) => a.hash).map((a) => [a.email, a.hash]));
  const again = planPublish({ ownerUid: 'U', project, config, built: built(), published });
  assert.ok(again.sections.every((s) => s.op === 'skip') && again.access.every((a) => a.op === 'skip') && again.meta.op === 'skip');

  const changed = buildSections({ project, deliverables: [...deliverables, { id: 'd9', projectId: 'p1', name: 'جديد', status: 'pending' }], financeEntries, meetings, requirements, progress });
  const third = planPublish({ ownerUid: 'U', project, config, built: changed, published });
  const ops = Object.fromEntries(third.sections.map((s) => [s.section, s.op]));
  assert.equal(ops.deliverables, 'set');
  assert.equal(ops.report, 'set');
  assert.equal(ops.technical, 'skip');
  assert.equal(ops.finance, 'skip');
  assert.ok(third.access.every((a) => a.op === 'skip'));
});

test('سحب الصلاحية: حذف سجل الضيف أو القسم من سجله الخاص دون تعديل بيانات القسم', () => {
  const both = { guests: [{ email: 'c@x.com', access: PRESETS.client }, { email: 'd@x.com', access: PRESETS.client }] };
  const p1 = planPublish({ ownerUid: 'U', project, config: both, built: built() });
  const published = Object.fromEntries([...p1.sections.filter((s) => s.hash).map((s) => [s.section, s.hash]), ['meta', p1.meta.hash]]);
  published.access = Object.fromEntries(p1.access.filter((a) => a.hash).map((a) => [a.email, a.hash]));

  const onlyOne = { guests: [{ email: 'c@x.com', access: PRESETS.client }] };
  const p2 = planPublish({ ownerUid: 'U', project, config: onlyOne, built: built(), published });
  assert.ok(p2.sections.every((s) => s.op === 'skip'));
  assert.deepEqual(p2.access.map((a) => [a.email, a.op]), [['c@x.com', 'skip'], ['d@x.com', 'delete']]);

  const nobody = planPublish({ ownerUid: 'U', project, config: { guests: [] }, built: built(), published });
  assert.ok(nobody.sections.filter((s) => published[s.section]).every((s) => s.op === 'delete'));
  assert.equal(nobody.meta.op, 'delete');
  assert.deepEqual(nobody.access.map((a) => [a.email, a.op]), [['c@x.com', 'delete'], ['d@x.com', 'delete']]);

  const noFinance = { guests: [{ email: 'c@x.com', access: { ...PRESETS.client, finance: 'none' } }] };
  const p3 = planPublish({ ownerUid: 'U', project, config: noFinance, built: built(), published });
  assert.equal(p3.sections.find((s) => s.section === 'finance').op, 'delete');
  assert.equal(p3.access[0].doc.sections.finance.view, false);
  assert.equal(p3.access[0].doc.sections.finance.edit, false);
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


// ====================================================================== طلبات التعديل (المرحلة 2)
const cfgEdit = { guests: [{ email: 'client@x.com', access: { ...PRESETS.client, deliverables: 'edit', technical: 'edit', meetings: 'edit', finance: 'edit' } }] };
const mkReq = (over = {}) => normalizeRequest('r1', { type: 'deliverable_status', targetId: 'd1', payload: { status: 'revision', text: 'غيّر اللون' }, authorEmail: 'Client@X.com', authorName: 'أحمد', status: 'pending', createdAt: 1, ...over });
const baseCtx = () => ({ project: { ...project }, deliverables: deliverables.map((d) => ({ ...d })), meetings: meetings.map((m) => ({ ...m })), now: 1000, today: '2026-11-15' });

test('كل نوع طلب مرتبط بقسم، والتعديل مسموح في أربعة أقسام فقط', () => {
  assert.deepEqual(Object.values(REQUEST_TYPES).sort(), ['deliverables', 'finance', 'meetings', 'technical']);
  assert.deepEqual([...EDITABLE_SECTIONS].sort(), ['deliverables', 'finance', 'meetings', 'technical']);
});

test('normalizeRequest: القسم يُشتق من النوع لا من الضيف، والنوع الغريب يُرفض، والبريد يُطبَّع', () => {
  const r = normalizeRequest('x', { type: 'deliverable_status', section: 'finance', targetId: 'd1', payload: { status: 'approved', evil: 'x' }, authorEmail: ' A@B.COM ', authorName: 'ن', status: 'weird' });
  assert.equal(r.section, 'deliverables');
  assert.equal(r.authorEmail, 'a@b.com');
  assert.equal(r.status, 'pending');
  assert.deepEqual(Object.keys(r.payload).sort(), ['status', 'text']);
  assert.equal(normalizeRequest('x', { type: 'delete_everything' }), null);
  assert.equal(normalizeRequest('x', null), null);
});

test('planApply: طلب تعديل على تسليم يرفع الإصدار ويسجل اسم الضيف في الملاحظات', () => {
  const c = baseCtx();
  const plan = planApply({ req: mkReq(), config: cfgEdit, ...c });
  assert.equal(plan.ok, true);
  const doc = plan.saves[0].doc;
  assert.equal(plan.saves[0].col, 'deliverables');
  assert.equal(doc.status, 'revision');
  assert.equal(doc.rev, 3);
  assert.ok(doc.notes.includes('أحمد') && doc.notes.includes('غيّر اللون'));
  assert.deepEqual(doc.appliedRequestIds, ['r1']);
  assert.equal(doc.projectId, 'p1');
});

test('planApply: إعادة الموافقة على نفس الطلب لا تكرر التعديل', () => {
  const c = baseCtx();
  const first = planApply({ req: mkReq(), config: cfgEdit, ...c });
  c.deliverables = c.deliverables.map((d) => (d.id === 'd1' ? first.saves[0].doc : d));
  const again = planApply({ req: mkReq(), config: cfgEdit, ...c });
  assert.equal(again.ok, true);
  assert.equal(again.noop, true);
  assert.equal(again.saves.length, 0);
});

test('planApply: اعتماد تسليم', () => {
  const c = baseCtx();
  const plan = planApply({ req: mkReq({ targetId: 'd2', payload: { status: 'approved' } }), config: cfgEdit, ...c });
  assert.equal(plan.saves[0].doc.status, 'approved');
  assert.equal(plan.saves[0].doc.rev, 1);
});

test('planApply: حالة غير مسموحة أو تسليم من مشروع آخر أو غير موجود تُرفض', () => {
  const c = baseCtx();
  assert.equal(planApply({ req: mkReq({ payload: { status: 'pending' } }), config: cfgEdit, ...c }).reason, 'invalid');
  assert.equal(planApply({ req: mkReq({ targetId: 'd3' }), config: cfgEdit, ...c }).reason, 'target_missing');
  assert.equal(planApply({ req: mkReq({ targetId: 'nope' }), config: cfgEdit, ...c }).reason, 'target_missing');
});

test('planApply: بلا صلاحية «عرض وتعديل» على القسم لحظة الموافقة → يُرفض', () => {
  const c = baseCtx();
  const viewOnly = { guests: [{ email: 'client@x.com', access: PRESETS.client }] };
  assert.equal(planApply({ req: mkReq(), config: viewOnly, ...c }).reason, 'no_access');
  assert.equal(planApply({ req: mkReq(), config: { guests: [] }, ...c }).reason, 'no_access');
  const otherSection = { guests: [{ email: 'client@x.com', access: { ...PRESETS.client, meetings: 'edit' } }] };
  assert.equal(planApply({ req: mkReq(), config: otherSection, ...c }).reason, 'no_access');
  const other = { guests: [{ email: 'someone@x.com', access: { ...PRESETS.client, deliverables: 'edit' } }] };
  assert.equal(planApply({ req: mkReq(), config: other, ...c }).reason, 'no_access');
});

test('planApply: طلب تمت معالجته لا يُطبَّق مرة ثانية', () => {
  assert.equal(planApply({ req: mkReq({ status: 'approved' }), config: cfgEdit, ...baseCtx() }).reason, 'resolved');
  assert.equal(planApply({ req: mkReq({ status: 'rejected' }), config: cfgEdit, ...baseCtx() }).reason, 'resolved');
});

test('planApply: متطلب جديد باسم الضيف وبمعرّف ثابت (لا تكرار)', () => {
  const r = mkReq({ type: 'requirement_add', targetId: 'p1', payload: { text: 'ضيفوا مخرج كهرباء' } });
  const plan = planApply({ req: r, config: cfgEdit, ...baseCtx() });
  const doc = plan.saves[0].doc;
  assert.equal(plan.saves[0].col, 'requirements');
  assert.equal(doc.id, 'gr_r1');
  assert.equal(doc.projectId, 'p1');
  assert.equal(doc.source, 'guest');
  assert.equal(doc.sourceLabel, 'أحمد');
  assert.equal(doc.status, 'open');
  assert.equal(planApply({ req: mkReq({ type: 'requirement_add', payload: { text: '   ' } }), config: cfgEdit, ...baseCtx() }).reason, 'invalid');
});

test('planApply: بدون اسم يُسجَّل البريد، والنص الطويل يُقصّ', () => {
  const r = mkReq({ type: 'requirement_add', authorName: '', payload: { text: 'x'.repeat(5000) } });
  const doc = planApply({ req: r, config: cfgEdit, ...baseCtx() }).saves[0].doc;
  assert.equal(doc.sourceLabel, 'client@x.com');
  assert.ok(doc.text.length <= 1200);
});

test('planApply: ملاحظة اجتماع تُلحق بالمحضر باسم الضيف ولا تتكرر', () => {
  const c = baseCtx();
  const r = mkReq({ type: 'meeting_note', targetId: 'm1', payload: { text: 'أؤكد الموعد' } });
  const plan = planApply({ req: r, config: cfgEdit, ...c });
  const doc = plan.saves[0].doc;
  assert.equal(plan.saves[0].col, 'meetings');
  assert.ok(doc.minutes.startsWith('محضر') && doc.minutes.includes('أحمد') && doc.minutes.includes('أؤكد الموعد'));
  assert.equal(doc.transcript, 'SECRET_TRANSCRIPT'); // باقي الحقول كما هي
  c.meetings = c.meetings.map((m) => (m.id === 'm1' ? doc : m));
  assert.equal(planApply({ req: r, config: cfgEdit, ...c }).noop, true);
  assert.equal(planApply({ req: mkReq({ type: 'meeting_note', targetId: 'm2', payload: { text: 'x' } }), config: cfgEdit, ...c }).reason, 'target_missing');
});

test('planApply: دفعة مدفوعة = حركة تحصيل بمعرّف installment_ ثم تحديث الدفعة، وتتراجع الأولى إن فشلت الثانية', () => {
  const c = baseCtx();
  const r = mkReq({ type: 'installment_paid', targetId: 'i2', payload: {} });
  const plan = planApply({ req: r, config: cfgEdit, ...c });
  assert.deepEqual(plan.saves.map((x) => x.col), ['financeEntries', 'projects']);
  const [entry, proj] = [plan.saves[0].doc, plan.saves[1].doc];
  assert.equal(entry.id, 'installment_i2');
  assert.equal(entry.kind, 'income');
  assert.equal(entry.amount, 20000);
  assert.equal(entry.date, '2026-11-15');
  assert.deepEqual(plan.saves[0].undo, { col: 'financeEntries', id: 'installment_i2' });
  assert.equal(proj.installments.find((i) => i.id === 'i2').status, 'paid');
  assert.equal(proj.installments.find((i) => i.id === 'i1').status, 'paid');
  assert.equal(proj.client, 'SECRET_CLIENT'); // لا يضيع أي حقل في المشروع
  // دفعة مدفوعة سلفًا أو غير موجودة
  assert.equal(planApply({ req: mkReq({ type: 'installment_paid', targetId: 'i1', payload: {} }), config: cfgEdit, ...c }).noop, true);
  assert.equal(planApply({ req: mkReq({ type: 'installment_paid', targetId: 'zzz', payload: {} }), config: cfgEdit, ...c }).reason, 'target_missing');
});

test('viewOf: المبلغ والاسم يأتيان من بياناتك لا من الضيف', () => {
  const c = baseCtx();
  const v = viewOf(mkReq({ type: 'installment_paid', targetId: 'i2', payload: { text: 'مبلغ 1' } }), c);
  assert.equal(v.amount, 20000);
  assert.equal(v.targetName, 'دفعة ثانية');
  assert.equal(viewOf(mkReq(), c).targetName, 'مسقط');
  assert.equal(viewOf(mkReq(), { ...c, project: null }).reason, 'project_missing');
});
