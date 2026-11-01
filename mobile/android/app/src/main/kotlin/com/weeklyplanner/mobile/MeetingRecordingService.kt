package com.weeklyplanner.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.io.File

class MeetingRecordingService : Service() {
    private var recorder: MediaRecorder? = null
    private var paused = false
    private var outputPath: String? = null
    private val channelId = "meeting_recording"

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(channelId, "تسجيل الاجتماعات", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                outputPath = intent.getStringExtra(EXTRA_PATH)
                startForeground(NOTIFICATION_ID, notification("جارٍ تسجيل الاجتماع", true))
                startRecording()
            }
            ACTION_PAUSE -> pauseRecording()
            ACTION_RESUME -> resumeRecording()
            ACTION_STOP -> stopRecording()
        }
        return START_NOT_STICKY
    }

    @Suppress("DEPRECATION")
    private fun createRecorder(): MediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this) else MediaRecorder()

    private fun startRecording() {
        val path = outputPath ?: run { stopSelf(); return }
        try {
            File(path).parentFile?.mkdirs()
            val r = createRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioEncodingBitRate(128000)
            r.setAudioSamplingRate(44100)
            r.setOutputFile(path)
            r.prepare()
            r.start()
            recorder = r
            paused = false
            updateNotification("جارٍ تسجيل الاجتماع", true)
        } catch (e: Exception) {
            recorder?.release(); recorder = null
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun pauseRecording() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try { recorder?.pause(); paused = true; updateNotification("التسجيل متوقف مؤقتًا", false) } catch (_: Exception) {}
        }
    }

    private fun resumeRecording() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try { recorder?.resume(); paused = false; updateNotification("جارٍ تسجيل الاجتماع", true) } catch (_: Exception) {}
        }
    }

    private fun stopRecording() {
        try { recorder?.stop() } catch (_: Exception) {}
        recorder?.release(); recorder = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun notification(text: String, isRecording: Boolean): Notification {
        val open = PendingIntent.getActivity(this, 10, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("WeeklyPlanner")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        if (isRecording) {
            b.addAction(0, "إيقاف مؤقت", actionIntent(ACTION_PAUSE, 11))
        } else {
            b.addAction(0, "استكمال", actionIntent(ACTION_RESUME, 12))
        }
        b.addAction(0, "إنهاء", actionIntent(ACTION_STOP, 13))
        return b.build()
    }

    private fun actionIntent(action: String, request: Int): PendingIntent {
        val i = Intent(this, RecordingActionReceiver::class.java).setAction(action)
        return PendingIntent.getBroadcast(this, request, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun updateNotification(text: String, recording: Boolean) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text, recording))
    }

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() { try { recorder?.release() } catch (_: Exception) {}; recorder = null; super.onDestroy() }

    companion object {
        const val ACTION_START = "com.weeklyplanner.mobile.START"
        const val ACTION_PAUSE = "com.weeklyplanner.mobile.PAUSE"
        const val ACTION_RESUME = "com.weeklyplanner.mobile.RESUME"
        const val ACTION_STOP = "com.weeklyplanner.mobile.STOP"
        const val EXTRA_PATH = "recording_path"
        const val NOTIFICATION_ID = 4107
    }
}

class RecordingActionReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: android.content.Context, intent: Intent) {
        // The service is already running in the foreground while a recording is active.
        // Do not call startForegroundService for pause/resume/stop: Android 12+ may
        // reject it when the app is backgrounded because these actions do not start
        // a new microphone foreground-service session.
        val serviceIntent = Intent(context, MeetingRecordingService::class.java).setAction(intent.action)
        try {
            context.startService(serviceIntent)
        } catch (_: IllegalStateException) {
            // The recording service is no longer active; ignore a stale notification action.
        }
    }
}
