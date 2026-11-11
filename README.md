# WeeklyPlanner

WeeklyPlanner is a bilingual Arabic/English PWA for managing weekly tasks, interior-design projects, deliverables, client requirements, meetings, and project/personal finances. The same web app can be opened on desktop, tablet, and mobile; an Android Flutter WebView host is also included.

## Current source state

- Web app version declared in js/app.js: **3.1.32**
- Service Worker cache version declared in sw.js: **wp-v4.0.0**
- The Service Worker cache version and the app's displayed/source version are separate values.
- Main application source: js/app.js; data layer: js/store.js.

## Main features

- Weekly tasks with priorities, due dates, overdue carry-forward, and project links.
- Projects with configurable work scope, client requirements, technical deliverables, and project progress.
- Deliverable types for existing/masonry/demolition, furniture and dimension plans, RCP, electrical, low-current, finishes, mechanical services, elevations, and schedules including FF&E.
- Project finance: contract values, collections, expenses, installments, and per-project summaries. Personal expenses and budgets are kept separate.
- Dashboard metrics for tasks, project progress, collections, profit margin, and meeting minutes, with configurable indicator styles and colors.
- Meetings with project/client metadata, weekly calendar, previous/upcoming views, audio recording, transcript review, editable AI-generated Minutes of Meeting, and printing.
- WhatsApp / WhatsApp Business chat import from pasted text or exported TXT files. Candidate requirements are reviewed before being saved to a project.
- AI Manager with local priority/alert/finance analysis and optional server-generated recommendations.
- Arabic/English interface, theme and typography settings, backup export/import, and PWA offline shell.

## Data and sync

The app supports local browser storage and Firebase Authentication + Firestore. Local mode stores data on that browser/device and does not sync to other devices. Cross-device sync requires the Firebase configuration in js/firebase-config.js and a working Firebase project/rules setup.

Firebase configuration values shipped to a browser are not private credentials. Access control must be enforced by Firebase Authentication and Firestore security rules. Never commit service-account keys, API secrets, or private tokens.

## Meeting AI service

The optional Cloudflare Worker lives in workers/meeting-ai/. It provides:
- POST /transcribe: explicit audio upload for Groq Whisper transcription.
- POST /minutes: structured Minutes of Meeting generation from reviewed transcript text.
- POST /manager: AI recommendations based on the app's current summary.

The Worker requires the GitHub Actions secrets documented in workers/meeting-ai/SETUP.md. The app does not silently upload meeting audio: transcription starts only when the user requests it. Audio files remain local to the device in the current implementation; meeting metadata and text are stored through the app data store.

Groq quotas, model availability, and pricing are controlled by Groq and may change. Do not assume the service is unlimited or permanently free.

## Android host

The Flutter host is under mobile/. It loads the hosted PWA in a WebView and bridges native meeting recording, audio-file read/delete, and Google sign-in requests. Android audio recordings are stored in app-private storage. They are not yet backed up or synchronized to Firebase Storage. iOS native recording is not implemented.

See mobile/README.md and mobile/ACCEPTANCE_CHECKLIST.md.

## Local development

Serve the repository root over HTTP; opening index.html directly with file:// is not supported.

    python3 -m http.server 8000

Then open http://localhost:8000.

## Deployment notes

- GitHub Pages deployment and Cloudflare Worker deployment are separate workflows.
- The Worker workflow is .github/workflows/deploy-meeting-ai.yml; it can deploy on a qualifying push to main or by manual dispatch.
- A code change on a feature branch does not publish the PWA to GitHub Pages or deploy the Worker unless a workflow is explicitly configured to run for that branch.
- Do not treat a successful source commit as proof of a successful Pages deployment, Worker deployment, Firebase sync, or Android device test.

## License

MIT
