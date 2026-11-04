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
export const COLLECTIONS = ['tasks', 'settings', 'projects', 'deliverables', 'financeEntries', 'personalExpenses', 'personalBudgets', 'meetings'];

const clean = (o) => JSON.parse(JSON.stringify(o, (_, v) => (v === undefined ? null : v)));

// ================================================================== محلي
function createLocalStore() {
  const KEY = (n) => `wp1:${n}`;
  const cache = {};
  const watchers = {};
  const authCbs = new Set();
  const statusCbs = new Set();
  const emitStatus = (status) => statusCbs.forEach((cb) => cb(status));
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
    onStatus(cb) { statusCbs.add(cb); cb({ state: 'local', message: 'البيانات محفوظة على هذا الجهاز فقط' }); return () => statusCbs.delete(cb); },
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

// طلب رمز تسجيل الدخول من تطبيق Android الأصلي (الرد يصل عبر حدث weeklyplanner-native-recorder).
// يرجع null إذا ألغى المستخدم، ويرمي خطأً واضحًا في باقي الحالات.
function requestNativeGoogleToken() {
  return new Promise((resolve, reject) => {
    const requestId = 'google_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    let timer;
    const done = (fn, value) => { clearTimeout(timer); window.removeEventListener('weeklyplanner-native-recorder', onEvent); fn(value); };
    const onEvent = (event) => {
      const d = (event && event.detail) || {};
      if (d.requestId !== requestId) return;
      if (d.state === 'google-token') done(resolve, d.idToken ? { idToken: d.idToken } : { cancelled: true, message: 'لم يرجع جوجل رمز تسجيل الدخول.' });
      else if (d.cancelled) done(resolve, { cancelled: true, message: d.message || '' });
      else if (d.state === 'google-error' || d.state === 'audio-error') {
        // audio-error يعني أن نسخة التطبيق المثبّتة قديمة ولا تعرف طلب تسجيل الدخول.
        const old = d.state === 'audio-error';
        done(reject, new Error(old ? 'حدّث تطبيق Android إلى آخر إصدار لتسجيل الدخول بجوجل.' : (d.message || 'تعذر تسجيل الدخول بجوجل.')));
      }
    };
    window.addEventListener('weeklyplanner-native-recorder', onEvent);
    timer = setTimeout(() => done(reject, new Error('لم يرد تطبيق أندرويد خلال دقيقة: تسجيل جوجل الأصلي لم يكتمل. تأكد من بصمة SHA-1 وإعداد عميل Android.')), 60000);
    window.WeeklyPlannerNative.postMessage(JSON.stringify({ action: 'google-sign-in', requestId }));
  });
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
  // Android WebView may not support persistent IndexedDB in every environment.
  // Fall back to memory cache rather than aborting application startup.
  let db;
  let persistentCacheEnabled = false;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
    persistentCacheEnabled = true;
  } catch (cacheError) {
    console.warn('Persistent Firestore cache unavailable; using memory cache.', cacheError);
    db = fs.getFirestore(app);
  }

  let user = null;
  const authCbs = new Set();
  const statusCbs = new Set();
  const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  let syncState = { state: 'idle', message: 'جارٍ التحقق من الاتصال…' };
  const emitStatus = (state, message) => { syncState = { state, message }; statusCbs.forEach((cb) => cb(syncState)); };
  const pendingCollections = new Set();
  const reportOffline = () => {
    if (persistentCacheEnabled) {
      emitStatus('offline', 'غير متصل — يدعم هذا الجهاز حفظ تغييرات Firestore محليًا ومزامنتها عند عودة الاتصال');
    } else {
      emitStatus('offline-memory', 'غير متصل — التخزين المحلي الدائم غير متاح؛ لا تغلق التطبيق قبل عودة الاتصال وتأكيد الحفظ');
    }
  };
  const refreshSyncStatus = () => {
    if (pendingCollections.size) emitStatus('syncing', 'جارٍ مزامنة التغييرات مع السحابة…');
    else if (!isOnline()) reportOffline();
  };
  if (!isOnline()) reportOffline();
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', reportOffline);
    window.addEventListener('online', () => emitStatus('syncing', 'عاد الاتصال — جارٍ التحقق من مزامنة البيانات…'));
  }
  const lastData = {};
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  authMod.onAuthStateChanged(auth, (u) => {
    user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null;
    resolveReady();
    authCbs.forEach((cb) => cb(user));
  });
  // نتيجة تسجيل الدخول عبر إعادة التوجيه (بديل النافذة المنبثقة)
  authMod.getRedirectResult(auth).catch((error) => {
    console.error('Google sign-in redirect result failed:', error);
    emitStatus('auth-error', 'تعذر استكمال تسجيل الدخول: ' + (error.code || error.message || error));
  });

  const colRef = (n) => fs.collection(db, 'users', user.uid, n);

  return {
    mode: 'cloud',
    onStatus(cb) { statusCbs.add(cb); cb(syncState); return () => statusCbs.delete(cb); },
    get user() { return user; },
    ready,
    onAuth(cb) {
      authCbs.add(cb);
      ready.then(() => cb(user));
      return () => authCbs.delete(cb);
    },
    async signIn() {
      // داخل تطبيق Android: جوجل تمنع تسجيل الدخول داخل WebView (نافذة منبثقة أو إعادة توجيه)،
      // لذلك نستخدم تسجيل دخول جوجل الأصلي ثم نمرّر الرمز إلى Firebase.
      if (typeof window !== 'undefined' && window.WeeklyPlannerNative) {
        const note = (m) => { try { const el = document.getElementById('login-err'); if (el) el.textContent = m; } catch { /* تجاهل */ } };
        note('1/3 جارٍ فتح اختيار حساب جوجل…');
        const res = await requestNativeGoogleToken();
        // أغلق المستخدم النافذة، أو أرجعها أندرويد كملغاة (يحدث أيضًا عند نقص إعداد Google).
        if (!res || res.cancelled || !res.idToken) { note(''); return { cancelled: true, message: (res && res.message) || '' }; }
        const idToken = res.idToken;
        note('2/3 تم استلام الرمز من جوجل، جارٍ الدخول إلى Firebase…');
        let fbTimer;
        try {
          await Promise.race([
            authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(idToken)),
            new Promise((_, rej) => { fbTimer = setTimeout(() => rej(new Error('لم يرد Firebase خلال 30 ثانية. تحقق من الاتصال بالإنترنت وتفعيل Google في Firebase Authentication.')), 30000); }),
          ]);
        } finally { clearTimeout(fbTimer); }
        note('3/3 تم الدخول، جارٍ تحميل بياناتك…');
        return;
      }
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
          await authMod.signInWithRedirect(auth, provider);
        } else if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) {
          return { cancelled: true, message: '' };
        } else {
          throw e;
        }
      }
    },
    async signInEmail(email, password) { await authMod.signInWithEmailAndPassword(auth, email, password); },
    async signUpEmail(email, password) { await authMod.createUserWithEmailAndPassword(auth, email, password); },
    async resetPassword(email) { await authMod.sendPasswordResetEmail(auth, email); },
    async signOut() { await authMod.signOut(auth); },
    watch(n, cb) {
      if (!user) return () => {};
      return fs.onSnapshot(
        colRef(n),
        { includeMetadataChanges: true },
        (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          lastData[n] = arr;
          if (snap.metadata?.hasPendingWrites) pendingCollections.add(n);
          else pendingCollections.delete(n);
          if (pendingCollections.size) emitStatus('syncing', 'جارٍ مزامنة التغييرات مع السحابة…');
          else if (!isOnline()) reportOffline();
          else if (snap.metadata?.fromCache) emitStatus('cached', 'نعرض البيانات المحلية مؤقتًا — جارٍ التحقق من اتصال السحابة…');
          else emitStatus('synced', 'تمت مزامنة البيانات مع السحابة');
          cb(arr);
        },
        (err) => { console.error('firestore watch error', n, err); emitStatus('error', `تعذر تحميل ${n}: ${err.message || err}`); }
      );
    },
    // لا ننتظر تأكيد السيرفر (يعمل أوفلاين)؛ الأخطاء تُرمى لمن ينتظر الوعد
    async save(n, doc) {
      if (!user) throw new Error('يجب تسجيل الدخول قبل الحفظ');
      const { id, ...rest } = clean(doc);
      if (!id) throw new Error('معرّف السجل مطلوب قبل الحفظ');
      emitStatus('syncing', 'جارٍ حفظ التغييرات…');
      try {
        // انتظر نتيجة Firestore الفعلية حتى لا تعرض الواجهة نجاحًا قبل تأكيد الكتابة.
        await fs.setDoc(fs.doc(db, 'users', user.uid, n, id), rest, { merge: true });
        refreshSyncStatus();
        if (isOnline() && !pendingCollections.size) emitStatus('synced', 'تم تأكيد حفظ التغييرات على السحابة');
      } catch (err) {
        emitStatus('error', `فشل الحفظ أو المزامنة: ${err.message || err}`);
        console.error('firestore save error', n, err);
        throw err;
      }
    },
    async remove(n, id) {
      if (!user) throw new Error('يجب تسجيل الدخول قبل الحذف');
      if (!id) throw new Error('معرّف السجل مطلوب قبل الحذف');
      emitStatus('syncing', 'جارٍ تحديث البيانات…');
      try {
        await fs.deleteDoc(fs.doc(db, 'users', user.uid, n, id));
        refreshSyncStatus();
        if (isOnline() && !pendingCollections.size) emitStatus('synced', 'تم تأكيد تحديث البيانات على السحابة');
      } catch (err) {
        emitStatus('error', `فشل الحذف أو المزامنة: ${err.message || err}`);
        console.error('firestore delete error', n, err);
        throw err;
      }
    },
    snapshot: (n) => (lastData[n] || []).slice(),
  };
}

export async function createStore() {
  if (firebaseConfig && firebaseConfig.apiKey) {
    return createCloudStore();
  }
  return createLocalStore();
}
