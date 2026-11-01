# Platform build and integration checklist

This folder is a Flutter source project, not yet a complete signed distributable. Generate the standard platform scaffolding from Flutter before building:

```bash
cd mobile
flutter create --platforms=android,ios --org com.weeklyplanner --project-name weeklyplanner_mobile .
flutter pub get
```

Then restore the custom Android files from this repository under `android/app/src/main/` if the generator replaced them. Confirm the Android app package/namespace is `com.weeklyplanner.mobile` in the generated Gradle configuration and add AndroidX Core if it is not already present:

```gradle
dependencies {
    implementation "androidx.core:core-ktx:1.13.1"
}
```

## Android requirements

- Target a current Android SDK and keep the microphone foreground-service permission and `foregroundServiceType="microphone"` declarations from the checked-in manifest.
- Android 13+ requires runtime notification permission for visible notification controls.
- Android 14+ applies microphone foreground-service start restrictions: start recording from a visible user action while the app is in the foreground.
- The ongoing notification provides pause/resume/stop actions. Android does not guarantee a floating overlay; any overlay bubble would require a separate special permission and should remain optional.
- Test screen-off, app switching, incoming calls, Bluetooth route changes, process death, and low-storage behavior on physical devices.

## iOS requirements

- Build on macOS with Xcode. Apply the Info.plist keys in `ios/README.md`.
- Configure `AVAudioSession` for recording and background audio in the generated Runner target.
- Test lock-screen, interruption, route changes, screen lock, and app suspension on a physical iPhone. iOS does not allow a general Android-style overlay bubble.

## Product integration still required

- Link each audio file to a selected project and a meeting metadata record.
- Add audio backup/export and a deliberate sync policy; audio files are not currently uploaded to Firestore.
- Implement offline transcription and local minutes generation, with model size/device capability checks. No paid cloud AI is part of this design.
- Build and test Android and iOS release artifacts before calling this production-ready.
