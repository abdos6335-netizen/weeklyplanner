// طبقة البيانات. واجهة واحدة بمحرّكين:
//   - cloud: Firebase Auth (Google) + Firestore (مزامنة وأوفلاين تلقائي)
//   - local: localStorage على الجهاز (عندما لا يكون Firebase مُعدًّا)
//
// الواجهة:
//   store.mode                      'cloud' | 'local'
//   store.onAuth(cb)                cb(user|null) — يُستدعى عند تغير حالة الدخول
//   store.signIn() / signOut()
//   store.watch(name, cb)           cb(array) فورًا وعند كل تغيير؛ يرجع دالة إلغاء الاشتراك
//   store.save(name, doc)           doc.id إلزامي (دمج مع الموجود)
//   store.remove(name, id)
//   store.snapshot(name)            نسخة حالية (للتصدير)

import { firebaseConfig } from './firebase-config.js';

const FB_VERSION = '11.10.0';
const FB_BASE = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
export const COLLECTIONS = ['tasks', 'settings', 'projects', 'deliverables', 'financeEntries'];

const clean = (o) => JSON.parse(JSON.stringify(o, (_, v) => (v === undefined ? null : v)));

// ================================================================== محلي
function createLocalStore() {
  const KEY = (n) => `wp1:${n}`;
  const cache = {};
  const watchers = {};
  const authCbs = new Set();
  let user = localStorage.getItem('wp1:local-user') ? { uid: 'local', name: 'Local', local: true } : null;

  const read = (n) => {
    try { return JSON.parse(localStorage.getItem(KEY(n))) || []; } catch { return []; }
  };
  const get = (n) => (cache[n] ??= read(n));
  const emit = (n) => (watchers[n] || []).forEach((cb) => cb(get(n).slice()));
  const persist = (n) => {
    try { localStorage.setItem(KEY(n), JSON.stringify(get(n))); }
    catch (e) { throw new Error('storage full'); }
  };

  // مزامنة بين تبويبات المتصفح
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('wp1:')) return;
    const n = e.key.slice(4);
    if (COLLECTIONS.includes(n)) { cache[n] = read(n); emit(n); }
  });

  return {
    mode: 'local',
    get user() { return user; },
    ready: Promise.resolve(),
    onAuth(cb) {
      authCbs.add(cb);
      queueMicrotask(() => cb(user));
      return () => authCbs.delete(cb);
    },
    async signIn() {
      localStorage.setItem('wp1:local-user', '1');
      user = { uid: 'local', name: 'Local', local: true };
      authCbs.forEach((cb) => cb(user));
    },
    async signOut() {
      localStorage.removeItem('wp1:local-user');
      user = null;
      authCbs.forEach((cb) => cb(null));
    },
    watch(n, cb) {
      (watchers[n] ||= new Set()).add(cb);
      cb(get(n).slice());
      return () => watchers[n].delete(cb);
    },
    async save(n, doc) {
      const list = get(n);
      const i = list.findIndex((d) => d.id === doc.id);
      const d = clean(doc);
      if (i >= 0) list[i] = { ...list[i], ...d }; else list.push(d);
      persist(n);
      emit(n);
    },
    async remove(n, id) {
      cache[n] = get(n).filter((d) => d.id !== id);
      persist(n);
      emit(n);
    },
    snapshot: (n) => get(n).slice(),
  };
}

// ================================================================== سحابي
async function createCloudStore() {
  const [appMod, authMod, fs] = await Promise.all([
    import(`${FB_BASE}/firebase-app.js`),
    import(`${FB_BASE}/firebase-auth.js`),
    import(`${FB_BASE}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });

  let user = null;
  const authCbs = new Set();
  const lastData = {};
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  authMod.onAuthStateChanged(auth, (u) => {
    user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null;
    resolveReady();
    authCbs.forEach((cb) => cb(user));
  });
  // نتيجة تسجيل الدخول عبر إعادة التوجيه (بديل النافذة المنبثقة)
  authMod.getRedirectResult(auth).catch(() => {});

  const colRef = (n) => fs.collection(db, 'users', user.uid, n);

  return {
    mode: 'cloud',
    get user() { return user; },
    ready,
    onAuth(cb) {
      authCbs.add(cb);
      ready.then(() => cb(user));
      return () => authCbs.delete(cb);
    },
    async signIn() {
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
          await authMod.signInWithRedirect(auth, provider);
        } else if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) {
          return;
        } else {
          throw e;
        }
      }
    },
    async signOut() { await authMod.signOut(auth); },
    watch(n, cb) {
      if (!user) return () => {};
      return fs.onSnapshot(
        colRef(n),
        (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          lastData[n] = arr;
          cb(arr);
        },
        (err) => console.error('firestore watch error', n, err)
      );
    },
    // لا ننتظر تأكيد السيرفر (يعمل أوفلاين)؛ الأخطاء تُرمى لمن ينتظر الوعد
    save(n, doc) {
      const { id, ...rest } = clean(doc);
      return fs.setDoc(fs.doc(db, 'users', user.uid, n, id), rest, { merge: true });
    },
    remove(n, id) { return fs.deleteDoc(fs.doc(db, 'users', user.uid, n, id)); },
    snapshot: (n) => (lastData[n] || []).slice(),
  };
}

export async function createStore() {
  if (firebaseConfig && firebaseConfig.apiKey) {
    return createCloudStore();
  }
  return createLocalStore();
}
