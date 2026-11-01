# iOS native recording configuration

The Flutter recording package is used for iOS in the current Dart UI. To enable continued audio capture when the app is backgrounded, the generated Runner target must include the `audio` background mode and microphone usage description.

Add the following to the generated `ios/Runner/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>يستخدم WeeklyPlanner الميكروفون لتسجيل محاضر الاجتماعات بناءً على طلبك.</string>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

The iOS build must also configure an `AVAudioSession` category suitable for recording and background operation. This must be validated on a physical iPhone; iOS does not permit Android-style floating overlay bubbles. Lock-screen controls are not included yet.
