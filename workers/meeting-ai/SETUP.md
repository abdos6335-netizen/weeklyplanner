# Meeting AI setup

The app's meeting transcription and MOM generation use a Cloudflare Worker as a private server-side proxy. The Groq API key is stored as a Worker secret and is never shipped to the browser.

## One-time setup

1. Open the deployed Freelance Manager site and sign in with the Firebase account that owns the app.
2. In Meetings, copy the displayed Firebase UID.
3. Create a Groq API key in the Groq console.
4. Create a Cloudflare API token with permission to edit Workers and obtain the Cloudflare Account ID.
5. In GitHub, open Settings → Secrets and variables → Actions → New repository secret and add: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GROQ_API_KEY`, and `ALLOWED_FIREBASE_UID` (the UID copied in step 2).
6. Open Actions → Deploy Meeting AI Worker → Run workflow.
7. When the workflow succeeds, copy the Worker URL from the deployment log. It looks like `https://weeklyplanner-meeting-ai.<your-workers-subdomain>.workers.dev`.
8. Open `https://...workers.dev/health` in a browser. A healthy deployment returns `{"ok":true,"service":"weeklyplanner-meeting-ai"}`. This check does not verify Groq credentials or Firebase authorization.
9. Return to Meetings in the app, paste the base Worker URL (without `/health`) into the AI service field, and save it.

## How to use

1. Record and stop a meeting, then save the meeting.
2. On its card, choose تفريغ التسجيل. The audio is sent to Groq Whisper for transcription.
3. Review the transcript.
4. Choose إنشاء MOM بالذكاء الاصطناعي.
5. Open مراجعة وتعديل المحضر والنص, correct uncertain project/client details, and save before printing.

## Limits and privacy

- Audio uploads are limited to 24 MB per request in this implementation. Longer recordings must be split into shorter recordings.
- Groq availability, free-tier quotas, and any applicable charges are governed by the user's Groq account and may change. Do not assume unlimited free usage.
- Audio is transmitted to Groq for transcription only when the user explicitly starts transcription. Meeting text is sent to Groq for MOM generation.
- The Worker accepts requests only from the configured Firebase UID and the published GitHub Pages origin.
- The Worker does not upload or permanently store audio. The app's existing local audio storage behavior remains unchanged.
