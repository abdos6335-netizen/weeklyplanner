package com.weeklyplanner.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var recorderChannel: MethodChannel? = null
    private var serviceReceiver: BroadcastReceiver? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "weeklyplanner/meeting_recorder")
        recorderChannel = channel
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    val path = call.argument<String>("path")
                    if (path.isNullOrBlank()) {
                        result.error("BAD_PATH", "Recording path is required", null)
                        return@setMethodCallHandler
                    }
                    val intent = Intent(this, MeetingRecordingService::class.java).apply {
                        action = MeetingRecordingService.ACTION_START
                        putExtra(MeetingRecordingService.EXTRA_PATH, path)
                    }
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("START_FAILED", e.message, null)
                    }
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
                    } catch (e: Exception) {
                        result.error("RECORDER_ACTION_FAILED", e.message, null)
                    }
                }
                else -> result.notImplemented()
            }
        }

        if (serviceReceiver == null) {
            serviceReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    if (intent?.action != MeetingRecordingService.ACTION_SERVICE_EVENT) return
                    channel.invokeMethod("serviceEvent", mapOf(
                        "state" to intent.getStringExtra("state"),
                        "message" to intent.getStringExtra("message"),
                        "path" to intent.getStringExtra("path")
                    ))
                }
            }
            val filter = IntentFilter(MeetingRecordingService.ACTION_SERVICE_EVENT)
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(serviceReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                registerReceiver(serviceReceiver, filter)
            }
        }
    }

    override fun onDestroy() {
        serviceReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Exception) {}
        }
        serviceReceiver = null
        recorderChannel = null
        super.onDestroy()
    }
}
