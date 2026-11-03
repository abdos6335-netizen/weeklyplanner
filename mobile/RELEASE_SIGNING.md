# إعداد نسخة Android Release وتسجيل الدخول بجوجل

## ما الذي يبنيه GitHub Actions؟
- Debug APK للاختبار.
- Release APK موقّع بالمفتاح المحفوظ في GitHub Actions، إذا كانت أسرار التوقيع الأربعة موجودة.
- يطبع سجل البناء بصمتي SHA-1 وSHA-256 للشهادة المستخدمة.

## إعداد Google OAuth
في مشروع Google Cloud/Firebase نفسه:
1. أنشئ OAuth Client من نوع Android للحزمة `com.weeklyplanner.mobile`.
2. أضف بصمة SHA-1 لمفتاح التوقيع الذي سيُستخدم على الجهاز. بصمة مفتاح Release الحالية من تشغيل CI السابق:
   `99:FA:40:F3:99:20:1A:A4:B6:9B:16:40:A3:27:73:C8:5F:49:13:F1`
3. تأكد أن Google Sign-In مفعّل في Firebase Authentication.
4. أضف OAuth Client من نوع Web للمشروع نفسه، ثم أضف معرّف Web Client كـ GitHub Actions repository variable باسم `GOOGLE_WEB_CLIENT_ID` (ليس Secret).
5. بعد إعداد Google Cloud/Firebase، أعد تنزيل `google-services.json` إن كان المشروع يستخدمه. هذا التطبيق يمرر Web Client ID وقت البناء صراحةً.

## مفاتيح توقيع Release
لا تضع ملف keystore أو كلمات مروره داخل المستودع. استخدم أسرار Actions التالية:
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

لا تنشئ مفتاح توقيع جديدًا إذا كان لديك مفتاح Release مستخدم في إصدار سابق. فقدان المفتاح أو استبداله يمنع تحديث التطبيق المثبت بنفس الحزمة دون إجراء منفصل قد يؤدي لفقد البيانات.

## قبل تثبيت APK
تحقق أن الحزمة `com.weeklyplanner.mobile`، وشهادة التوقيع مطابقة للإصدار المثبت، وأن `versionCode` أعلى من النسخة المثبتة. لا تحذف النسخة المثبتة بغرض التجربة؛ اختبر كتحديث فقط إذا تطابقت الشهادة وكان رقم الإصدار أعلى.
