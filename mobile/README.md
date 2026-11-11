# WeeklyPlanner Mobile

Android-first Flutter host for the existing WeeklyPlanner web application.

## Current integration

- Flutter opens the hosted WeeklyPlanner PWA in an Android WebView.
- JavaScript channel WeeklyPlannerRecorder starts, pauses, resumes, and stops the Android foreground recording service.
- Android stores M4A files in the app-private MeetingRecordings directory.
- The native bridge returns the recording filename and meeting/project identifiers to the web app when recording stops.
- JavaScript channel WeeklyPlannerNative supports reading a native audio file as Base64 and deleting it. The web app uses this bridge for playback, download, transcription, and deletion on the recording device.
- Notification actions for pause/resume/stop are forwarded through the service event bridge to the open WebView.
- Browser-based recording remains available outside the native WebView.
- The web app can explicitly send a saved recording to the configured Meeting AI Worker for transcription, then request an editable Minutes of Meeting. The Worker uses Groq; it is not an offline/on-device transcription engine.

## Build

The checked-in folder is Flutter source. Generate the platform scaffolding if it is not present, then install dependencies and analyze:

    bash mobile/tool/bootstrap_platforms.sh
    cd mobile
    flutter pub get
    flutter analyze
    flutter build apk --debug

For a signed release, configure the Android signing setup separately. Do not treat a debug build as a release artifact.

## Known limitations / validation still required

- Native M4A files are app-private and are not currently uploaded to Firebase Storage or included in the app's JSON backup. They can be read/downloaded from the device where they were recorded. Uninstalling the app or clearing its data may remove them.
- Meeting metadata and transcript/minutes can sync through the configured app data store, but the audio bytes themselves do not sync between devices.
- Transcription and AI-generated minutes require the Cloudflare Worker, valid Firebase sign-in, the allowed Firebase UID, and a working Groq API key. The user must explicitly start transcription; audio is transmitted to the Worker/Groq for that action.
- Notification controls and audio-file read/delete behavior need physical-device acceptance testing across supported Android versions, including screen lock, app switching, interruptions, denied notification permission, low storage, and process termination.
- iOS native recording, background recording, and lock-screen controls are not implemented.
- The repository's platform scaffolding/build must be generated and validated before a signed Android release can be considered production-ready.

See PLATFORM_SETUP.md and ACCEPTANCE_CHECKLIST.md.
