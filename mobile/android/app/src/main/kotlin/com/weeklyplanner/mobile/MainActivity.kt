package com.weeklyplanner.mobile

import android.content.Intent
import android.os.Build
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File
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
                    "pause", "resume", "stop" -> {
                        val action = when (call.method) {
                            "pause" -> MeetingRecordingService.ACTION_PAUSE
                            "resume" -> MeetingRecordingService.ACTION_RESUME
                            else -> MeetingRecordingService.ACTION_STOP
                        }
                        try {
                            startService(Intent(this, MeetingRecordingService::class.java).setAction(action))
                            result.success(true)
                        } catch (e: Exception) { result.error("RECORDER_ACTION_FAILED", e.message, null) }
                    }
                    "read" -> {
                        val name = call.argument<String>("fileName")
                        if (name.isNullOrBlank() || name.contains("/") || name.contains("\\")) {
                            result.error("BAD_FILE", "Invalid recording file name", null); return@setMethodCallHandler
                        }
                        try {
                            val file = File(getExternalFilesDir(null)?.parentFile ?: filesDir, "MeetingRecordings/$name")
                            if (!file.isFile) result.error("NOT_FOUND", "Recording file not found", null)
                            else result.success(android.util.Base64.encodeToString(file.readBytes(), android.util.Base64.NO_WRAP))
                        } catch (e: Exception) { result.error("READ_FAILED", e.message, null) }
                    }
                    "delete" -> {
                        val name = call.argument<String>("fileName")
                        if (name.isNullOrBlank() || name.contains("/") || name.contains("\\")) {
                            result.error("BAD_FILE", "Invalid recording file name", null); return@setMethodCallHandler
                        }
                        try {
                            val file = File(getExternalFilesDir(null)?.parentFile ?: filesDir, "MeetingRecordings/$name")
                            result.success(!file.exists() || file.delete())
                        } catch (e: Exception) { result.error("DELETE_FAILED", e.message, null) }
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
