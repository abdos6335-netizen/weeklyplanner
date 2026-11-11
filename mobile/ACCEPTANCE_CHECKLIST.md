# WeeklyPlanner acceptance checklist

Use this checklist on a test account and test device before merging or publishing changes. Do not use production data for destructive tests.

## Web / PWA

- [ ] App loads from GitHub Pages on desktop and mobile.
- [ ] Arabic/English toggle updates navigation, dialogs, forms, and dynamically added content.
- [ ] Local mode clearly indicates data is stored on this device only.
- [ ] Firebase sign-in, sign-out, reload, and cross-device sync work with the intended account.
- [ ] Backup export and import preserve tasks, projects, deliverables, requirements, meetings, and finance records.
- [ ] Task completion and project progress metrics update after changes.
- [ ] Finance calculations distinguish contract value, collections, expenses, net cash flow, and outstanding collections.
- [ ] Ratio appearance settings persist after reload and remain readable on narrow screens.

## Projects / requirements / WhatsApp

- [ ] Project work scope options match the actual contracted services.
- [ ] Deliverable categories and statuses can be created, edited, and displayed.
- [ ] Requirements can be added manually and their status can be changed.
- [ ] WhatsApp and WhatsApp Business exported text files can be imported.
- [ ] Sender selection filters candidate messages to the client.
- [ ] Candidate requirements are shown for review and are not saved until explicitly approved.
- [ ] Approved requirements are linked to the selected project without creating duplicates.

## Meetings / browser recording

- [ ] Create a meeting with project, client, date, time, category, purpose, topics, and attendees.
- [ ] Record, stop, save, play, and download a browser recording.
- [ ] Transcription sends audio only after the user explicitly requests it.
- [ ] Transcript is saved and remains editable.
- [ ] MOM generation separates discussion, decisions, actions, and explicit client requirements.
- [ ] Uncertain project/client extraction is flagged for manual review.
- [ ] Approved requirements from meeting minutes appear in the linked project's requirements.
- [ ] Meeting minutes can be edited, printed, and found in previous/upcoming/calendar views.

## Meeting AI Worker

- [ ] Confirm the deployed Worker URL responds to the expected routes.
- [ ] Confirm missing/invalid Firebase tokens are rejected.
- [ ] Confirm a different Firebase UID is rejected.
- [ ] Confirm only the published app origin can call the Worker from a browser.
- [ ] Confirm /transcribe, /minutes, and /manager work with the configured secrets.
- [ ] Confirm oversized audio and invalid transcript input return a clear error.
- [ ] Confirm Groq failures are shown clearly and do not lose the saved meeting or transcript.

## Android device

- [ ] Start recording from the foreground and verify the persistent notification appears.
- [ ] Pause, resume, and stop from both the app and notification.
- [ ] Verify the stopped recording appears on the meeting and can be played/downloaded.
- [ ] Verify the native audio read/delete bridge works after closing and reopening the app.
- [ ] Verify transcription can read the native M4A file from the same device.
- [ ] Test screen lock, app switching, incoming calls, Bluetooth route changes, permission denial, low storage, and process termination.
- [ ] Confirm users are warned that app-private recordings are not backed up or synchronized.

## Release gate

- [ ] Web checks pass.
- [ ] Worker deployment and protected routes are verified.
- [ ] Firebase sync is tested on two devices using the intended account.
- [ ] Android acceptance tests pass on a physical device.
- [ ] Review the feature branch diff before creating or merging a pull request.
- [ ] Do not merge to main or trigger production deployment until explicitly approved.
