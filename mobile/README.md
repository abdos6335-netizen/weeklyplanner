# WeeklyPlanner Mobile

Flutter companion app for Android and iOS. This first implementation slice provides a responsive Arabic meetings screen, microphone permission handling, local AAC recording, pause/resume/stop, and a saved-recordings list.

## Requirements

- Flutter stable (Dart SDK >= 3.4)
- Android Studio / Android SDK for Android builds
- Xcode on macOS for iOS builds (iOS builds cannot be produced on Windows/Linux)

## Run

```bash
cd mobile
flutter pub get
flutter run
```

## Current scope and important limitations

- Audio is stored in the app's private documents directory under `MeetingRecordings`; it is not uploaded.
- The current Flutter UI controls recording while the app is active. This commit does **not** claim reliable background recording, notification transport controls, lock-screen controls, overlay controls, transcription, AI minutes, project association, or Firestore synchronization.
- Those capabilities require native Android foreground-service and iOS background-audio implementations plus platform build configuration and device testing. They must be completed before this app is described as production-ready.
- No paid API or subscription is used by this recording slice.
- The existing web app is unchanged.
