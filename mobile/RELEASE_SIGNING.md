# توقيع نسخة Release

لا يحتوي المستودع على أي مفتاح أو كلمة سر. المفتاح يُنشأ مرة واحدة على جهازك ويُحفظ نسخة منه في مكانين آمنين. إذا ضاع فلن تستطيع تحديث التطبيق المثبّت بعد ذلك.

## 1) إنشاء المفتاح (مرة واحدة)

```
keytool -genkey -v -keystore weeklyplanner-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias weeklyplanner
```

## 2) تحويله إلى base64

Windows (PowerShell):

```
[Convert]::ToBase64String([IO.File]::ReadAllBytes("weeklyplanner-release.jks")) | Set-Clipboard
```

macOS / Linux:

```
base64 -w0 weeklyplanner-release.jks
```

## 3) إضافة Secrets في GitHub

Settings ← Secrets and variables ← Actions ← New repository secret:

| الاسم | القيمة |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | ناتج الخطوة 2 |
| `ANDROID_KEYSTORE_PASSWORD` | كلمة سر ملف المفتاح |
| `ANDROID_KEY_ALIAS` | `weeklyplanner` |
| `ANDROID_KEY_PASSWORD` | كلمة سر المفتاح |

## 4) البناء

عند وجود الـ Secrets يبني الـ workflow ملف `app-release.apk` ويرفعه باسم
`weeklyplanner-android-release-apk`، ويطبع بصمة الشهادة (SHA-256) في سجل التشغيل.
بدون الـ Secrets يبني نسخة Debug فقط كما كان.

## قبل التثبيت فوق نسخة موجودة

الـ APK الموقّع بمفتاح مختلف لا يُثبَّت كتحديث فوق النسخة الحالية، ويتطلب حذفها
(ومعه مسح بياناتها المحلية). خذ نسخة احتياطية من بياناتك أولًا.
