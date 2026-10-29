# WeeklyPlanner

مخطط أسبوعي مفتوح المصدر، مجاني بالكامل، يعمل على الهاتف والتابلت والكمبيوتر (PWA) بدون Google Play.
تسجيل الدخول بحساب Google، وبياناتك في Firestore الخاص بك، محمية بقواعد تسمح لحسابك فقط.

**المرحلة 1 (هذا الإصدار):** الدخول، المهام الأسبوعية، الثيم والإعدادات.
**قادم:** المشروعات (أنواع، تسليمات واعتماد، سجل) ← الماليات (تعاقد، تحصيل، مصروفات، نسبة المكسب) ← التسجيل الصوتي.

## تجربة سريعة (بدون Firebase)
التطبيق يعمل مباشرة في **الوضع المحلي** (البيانات على الجهاز فقط) طالما `js/firebase-config.js` فيه `null`.
لا يعمل بفتح الملف مباشرة (`file://`) — شغّله من خادم:

```bash
python3 -m http.server 8000     # ثم افتح http://localhost:8000
```

## النشر على GitHub Pages (مجاني)
1. أنشئ مستودعًا جديدًا على GitHub وارفع محتويات هذا المجلد كما هي.
2. Settings ▸ Pages ▸ Source: `Deploy from a branch` ▸ Branch: `main` / root ▸ Save.
3. بعد دقيقة يظهر الرابط: `https://<username>.github.io/<repo>/`
4. افتحه من الهاتف: Chrome ▸ ⋮ ▸ **Install app** / **Add to Home screen**. على الكمبيوتر: أيقونة التثبيت في شريط العنوان.

## تفعيل الدخول بـ Google والمزامنة (Firebase، مجاني)
1. https://console.firebase.google.com ▸ **Add project** (لا تحتاج Google Analytics).
2. **Build ▸ Authentication ▸ Get started ▸ Sign-in method ▸ Google ▸ Enable**.
3. **Build ▸ Firestore Database ▸ Create database** (اختر Production mode وأقرب منطقة).
4. تبويب **Rules**: الصق محتوى `firestore.rules` ثم **Publish**.
   - اختياري: فك التعليق عن شرط البريد وضع بريدك ليدخل حسابك فقط.
5. **Project settings ▸ General ▸ Your apps ▸ Web (`</>`)** ▸ سجّل التطبيق وانسخ `firebaseConfig` إلى `js/firebase-config.js`.
6. **Authentication ▸ Settings ▸ Authorized domains ▸ Add domain**: `<username>.github.io` (و `localhost` للتجربة).
7. ارفع التعديل على GitHub. من الآن زر الدخول يصبح «الدخول بحساب Google».

> قيم `firebaseConfig` ليست أسرارًا. الحماية في قواعد Firestore: كل مستخدم يصل إلى `users/{uid}` الخاص به فقط.

### الخطة المجانية (Spark)
تكفي الاستخدام الشخصي بمراحل (قراءات/كتابات يومية بالآلاف). لا تحتاج بطاقة بنكية.

## النسخ الاحتياطي
الإعدادات ▸ الحساب والبيانات ▸ **تصدير نسخة احتياطية** (ملف JSON) و**استيراد**.

## الهيكل
```
index.html, styles.css, manifest.webmanifest, sw.js
js/app.js            الواجهة والمنطق
js/store.js          البيانات (Firebase أو محلي) بواجهة واحدة
js/theme.js          محرك الثيم (ألوان، تشبع، زجاج، خطوط)
js/i18n.js           عربي / إنجليزي
js/icons.js, dates.js
firestore.rules      قواعد الأمان
tools/make_icons.py  توليد اللوجو والأيقونات
```

## بيانات المهمة
`id, title, notes, date (YYYY-MM-DD أو null), weekRef, priority (1-3), status (todo|doing|done), createdAt, updatedAt, doneAt, projectId`
- مهمة بدون تاريخ تتبع أسبوع `weekRef`، وإن لم تنتهِ تظهر في «مهام من أسابيع سابقة» مع زر **ترحيل**.
- المهام القديمة لا تُحذف عند تغيير الأسبوع.

## ملاحظات
- لتحديث نسخة مثبّتة بعد النشر غيّر `VERSION` في `sw.js`.
- التطبيق مجرَّب في المتصفح المحلي (الوضع المحلي). اتصال Firebase الفعلي يحتاج مشروعك أنت، ويُنصح بتجربته بعد الإعداد.

الرخصة: MIT
