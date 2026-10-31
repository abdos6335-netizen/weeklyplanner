package com.weeklyplanner.mobile

import android.content.Intent
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "weeklyplanner/meeting_recorder")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "start" -> {
                        val path = call.argument<String>("path")
                        if (path.isNullOrBlank()) { result.error("BAD_PATH", "Recording path is required", null); return@setMethodCallHandler }
                        val intent = Intent(this, MeetingRecordingService::class.java).apply {
                            action = MeetingRecordingService.ACTION_START
                            putExtra(MeetingRecordingService.EXTRA_PATH, path)
                        }
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
                            result.success(true)
                        } catch (e: Exception) { result.error("START_FAILED", e.message, null) }
                    }
                    "pause" -> { startService(Intent(this, MeetingRecordingService::class.java).setAction(MeetingRecordingService.ACTION_PAUSE)); result.success(true) }
                    "resume" -> { startService(Intent(this, MeetingRecordingService::class.java).setAction(MeetingRecordingService.ACTION_RESUME)); result.success(true) }
                    "stop" -> { startService(Intent(this, MeetingRecordingService::class.java).setAction(MeetingRecordingService.ACTION_STOP)); result.success(true) }
                    else -> result.notImplemented()
                }
            }
    }
}
