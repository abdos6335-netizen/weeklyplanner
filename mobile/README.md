# WeeklyPlanner Mobile

Android-first Flutter host for the existing WeeklyPlanner web application.

## Build
```bash
bash mobile/tool/bootstrap_platforms.sh
cd mobile
flutter analyze
flutter build apk --debug
```

## Current integration slice
- Flutter opens the hosted WeeklyPlanner app inside an Android WebView.
- A JavaScript channel named `WeeklyPlannerRecorder` connects meeting UI actions to the native Android foreground recording service.
- The meeting screen can request native start/stop recording; Android stores M4A files in the app-private MeetingRecordings directory.
- A stopped native recording returns its filename and meeting/project identifiers to the web UI; the meeting record stores that filename as metadata.
- Browser-based recording remains available outside the native WebView.

## Known gaps — not production complete
- Native audio bytes are not yet exposed back to the web app, so the existing web playback/download controls cannot play native M4A files yet; the current meeting stores the filename only.
- Notification pause/resume/stop controls work at the service level, but their state is not yet synchronized back into the open WebView UI.
- The recording file is app-private and is not uploaded or backed up; uninstalling the app can remove it.
- Transcription and AI-generated minutes are not implemented.
- iOS native background recording and lock-screen controls are not implemented.
- Device testing is still required, especially Android microphone foreground-service restrictions and notification actions.

No paid transcription API or subscription is used.
