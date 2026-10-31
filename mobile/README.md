# WeeklyPlanner Mobile

Flutter companion application for Android and iOS. This branch contains the first native meeting-recording implementation slice.

## Generate platform projects and install dependencies

Run from the repository root:

```bash
bash mobile/tool/bootstrap_platforms.sh
```

The script generates the standard Android Gradle and iOS Runner scaffolding while preserving the custom Android manifest and Kotlin recording service. It then runs `flutter pub get`.

## Run on a connected device

```bash
cd mobile
flutter run
```

## Implemented in this branch

- Arabic responsive meeting-recording screen.
- Microphone permission request.
- Local AAC/M4A audio file storage in the app's private documents directory.
- Start, pause, resume and stop controls.
- Android foreground recording service with persistent notification controls.
- Android notification action receiver for pause/resume/stop.
- Android CI workflow that generates platform scaffolding, analyzes Dart, and builds a debug APK.

## Not yet complete; do not treat as production-ready

- The recordings list is local and not yet associated with the existing WeeklyPlanner project records.
- Audio is not synced to Firestore or backed up to cloud storage.
- Full-audio transcription and AI meeting minutes have not been implemented.
- iOS background audio mode, interruption handling, and lock-screen transport controls still need native integration and physical-device validation.
- No floating overlay bubble is implemented; Android overlay requires separate user permission and iOS does not provide an equivalent general overlay.
- Android and iOS release builds have not been tested on physical devices in this workspace.

No paid AI API, subscription, or cloud transcription service is used by this recording slice. Do not add paid services without an explicit decision.
