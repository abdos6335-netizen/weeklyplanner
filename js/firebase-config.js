// إعدادات Firebase الخاصة بك.
//
// 1) أنشئ مشروعًا مجانيًا في https://console.firebase.google.com
// 2) Build ▸ Authentication ▸ Sign-in method ▸ فعّل Google
// 3) Build ▸ Firestore Database ▸ Create database (Production mode)
// 4) انسخ قواعد firestore.rules إلى Firestore ▸ Rules ثم Publish
// 5) Project settings ▸ Your apps ▸ Web app (</>) ▸ انسخ firebaseConfig وضعه هنا
// 6) Authentication ▸ Settings ▸ Authorized domains ▸ أضف <username>.github.io
//
// هذه القيم ليست أسرارًا — الحماية الفعلية في قواعد Firestore (بياناتك لحسابك فقط).
// طالما بقيت القيمة null يعمل التطبيق في الوضع المحلي (البيانات على الجهاز فقط).

export const firebaseConfig = null;

/* مثال:
export const firebaseConfig = {
  apiKey: 'AIza...',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  storageBucket: 'your-project.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};
*/
