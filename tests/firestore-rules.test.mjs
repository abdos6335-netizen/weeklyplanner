import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where,
} from 'firebase/firestore';

const projectId = 'demo-weeklyplanner';
const shareId = 'owner123_project1';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
let env;

const owner = () => env.authenticatedContext('owner123', {
  email: 'owner@example.com', email_verified: true, name: 'Owner',
}).firestore();
const guestA = () => env.authenticatedContext('guestA', {
  email: 'a@example.com', email_verified: true, name: 'Guest A',
}).firestore();
const guestB = () => env.authenticatedContext('guestB', {
  email: 'b@example.com', email_verified: true, name: 'Guest B',
}).firestore();
const unverifiedA = () => env.authenticatedContext('guestA', {
  email: 'a@example.com', email_verified: false, name: 'Guest A',
}).firestore();

const ref = (db, path) => doc(db, path);
const accessPath = (email) => `shares/${shareId}/access/${email}`;
const sectionPath = (name) => `shares/${shareId}/sections/${name}`;
const requestPath = (id) => `shares/${shareId}/requests/${id}`;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(ref(db, `shares/${shareId}`), {
      ownerUid: 'owner123', projectId: 'project1', projectName: 'Test project',
    });
    await setDoc(ref(db, accessPath('a@example.com')), {
      projectName: 'Test project',
      sections: {
        technical: { view: true, edit: false },
        deliverables: { view: true, edit: true },
        finance: { view: false, edit: false },
      },
    });
    await setDoc(ref(db, accessPath('b@example.com')), {
      projectName: 'Test project',
      sections: { technical: { view: true, edit: false } },
    });
    for (const section of ['technical', 'deliverables', 'finance']) {
      await setDoc(ref(db, sectionPath(section)), {
        ownerUid: 'owner123', projectId: 'project1', section,
        data: { privateMarker: `data-${section}` },
      });
    }
    await setDoc(ref(db, requestPath('request-a')), {
      type: 'deliverable_status', targetId: 'd1', payload: { status: 'approved' },
      authorEmail: 'a@example.com', authorName: 'Guest A', status: 'pending', createdAt: 1,
    });
    await setDoc(ref(db, requestPath('request-b')), {
      type: 'deliverable_status', targetId: 'd2', payload: { status: 'revision' },
      authorEmail: 'b@example.com', authorName: 'Guest B', status: 'pending', createdAt: 2,
    });
  });
});

after(async () => {
  if (env) await env.cleanup();
});

test('الضيف يقرأ سجل وصوله فقط ولا يستطيع تعداد الضيوف أو قراءة مستند المالك', async () => {
  const db = guestA();
  await assertSucceeds(getDoc(ref(db, accessPath('a@example.com'))));
  await assertFails(getDoc(ref(db, accessPath('b@example.com'))));
  await assertFails(getDocs(collection(db, `shares/${shareId}/access`)));
  await assertFails(getDoc(ref(db, `shares/${shareId}`)));
});

test('الضيف يقرأ الأقسام المسموحة فقط ولا يكتب مباشرة في بيانات المشروع', async () => {
  const db = guestA();
  await assertSucceeds(getDoc(ref(db, sectionPath('technical'))));
  await assertSucceeds(getDoc(ref(db, sectionPath('deliverables'))));
  await assertFails(getDoc(ref(db, sectionPath('finance'))));
  await assertFails(setDoc(ref(db, sectionPath('technical')), { data: { hacked: true } }));
  await assertFails(updateDoc(ref(db, sectionPath('technical')), { 'data.privateMarker': 'hacked' }));
  await assertFails(getDocs(collection(db, `shares/${shareId}/sections`)));
  await assertSucceeds(getDoc(ref(guestB(), sectionPath('technical'))));
  await assertFails(getDoc(ref(guestB(), sectionPath('deliverables'))));
});

test('طلب التعديل يحتاج صلاحية edit وبريدًا موثقًا ومحتوى ضمن القائمة البيضاء', async () => {
  const db = guestA();
  const valid = {
    type: 'deliverable_status', targetId: 'd3', payload: { status: 'approved' },
    authorEmail: 'a@example.com', authorName: 'Guest A', status: 'pending', createdAt: 3,
  };
  await assertSucceeds(setDoc(ref(db, requestPath('new-valid')), valid));
  await assertFails(setDoc(ref(db, requestPath('view-only')), {
    ...valid, type: 'requirement_add', targetId: 'project1',
  }));
  await assertFails(setDoc(ref(unverifiedA(), requestPath('unverified')), valid));
  await assertFails(setDoc(ref(db, requestPath('spoof-email')), {
    ...valid, authorEmail: 'b@example.com',
  }));
  await assertFails(setDoc(ref(db, requestPath('extra-field')), {
    ...valid, secret: 'not allowed',
  }));
  await assertFails(setDoc(ref(db, requestPath('invalid-payload')), {
    ...valid, payload: { status: 'approved', ownerUid: 'owner123' },
  }));
});

test('الضيف لا يقرأ طلب ضيف آخر ولا يحدّث أو يحذف الطلب؛ المالك يستطيع المراجعة', async () => {
  const guest = guestA();
  await assertSucceeds(getDoc(ref(guest, requestPath('request-a'))));
  await assertFails(getDoc(ref(guest, requestPath('request-b'))));
  await assertFails(updateDoc(ref(guest, requestPath('request-a')), { status: 'approved' }));
  await assertFails(deleteDoc(ref(guest, requestPath('request-a'))));

  const db = owner();
  await assertSucceeds(getDoc(ref(db, `shares/${shareId}`)));
  await assertSucceeds(getDocs(collection(db, `shares/${shareId}/access`)));
  await assertSucceeds(updateDoc(ref(db, requestPath('request-a')), { status: 'approved' }));
  await assertSucceeds(deleteDoc(ref(db, requestPath('request-b'))));
});

test('سحب سجل الوصول يمنع القراءة والطلبات فورًا', async () => {
  await assertSucceeds(deleteDoc(ref(owner(), accessPath('a@example.com'))));
  const db = guestA();
  const revokedAccess = await assertSucceeds(getDoc(ref(db, accessPath('a@example.com'))));
  assert.equal(revokedAccess.exists(), false, 'سجل الصلاحيات المحذوف لا يعيد بيانات');
  await assertFails(getDoc(ref(db, sectionPath('technical'))));
  await assertFails(getDoc(ref(db, requestPath('request-a'))));
  await assertFails(setDoc(ref(db, requestPath('after-revoke')), {
    type: 'deliverable_status', targetId: 'd4', payload: { status: 'approved' },
    authorEmail: 'a@example.com', authorName: 'Guest A', status: 'pending', createdAt: 4,
  }));
});

test('حساب غير موثق لا يحصل على أي وصول حتى لو تطابق البريد', async () => {
  const db = unverifiedA();
  await assertFails(getDoc(ref(db, accessPath('a@example.com'))));
  await assertFails(getDoc(ref(db, sectionPath('technical'))));
});
