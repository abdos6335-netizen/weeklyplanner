import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';

void main() => runApp(const WeeklyPlannerMobile());

class WeeklyPlannerMobile extends StatelessWidget {
  const WeeklyPlannerMobile({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'WeeklyPlanner',
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff21865b)), useMaterial3: true),
    home: const PlannerWebView(),
  );
}

class PlannerWebView extends StatefulWidget {
  const PlannerWebView({super.key});
  @override
  State<PlannerWebView> createState() => _PlannerWebViewState();
}

class _PlannerWebViewState extends State<PlannerWebView> {
  static const MethodChannel recorder = MethodChannel('weeklyplanner/meeting_recorder');
  late final WebViewController web;
  bool loading = true;
  String? activePath, meetingId, projectId;

  @override
  void initState() {
    super.initState();
    web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('WeeklyPlannerRecorder', onMessageReceived: handleMessage)
      ..addJavaScriptChannel('WeeklyPlannerNative', onMessageReceived: handleNativeRequest)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) => setState(() => loading = true),
        onPageFinished: (_) => setState(() => loading = false),
      ))
      ..loadRequest(Uri.parse('https://abdos6335-netizen.github.io/weeklyplanner/'));
  }

  Future<void> notifyWeb(Map<String, dynamic> data) async {
    final json = jsonEncode(data);
    await web.runJavaScript('window.dispatchEvent(new CustomEvent("weeklyplanner-native-recorder",{detail:$json}));');
  }

  Future<void> handleNativeRequest(JavaScriptMessage message) async {
    try {
      final data = jsonDecode(message.message) as Map<String, dynamic>;
      final action = data['action']?.toString();
      final requestId = data['requestId']?.toString();
      final fileName = data['fileName']?.toString() ?? '';
      if (fileName.isEmpty || fileName.contains('/') || fileName.contains('\\\\')) {
        throw StateError('اسم ملف التسجيل غير صالح');
      }
      final base = await getApplicationDocumentsDirectory();
      final file = File('${base.path}/MeetingRecordings/$fileName');
      if (action == 'read') {
        if (!await file.exists()) throw StateError('ملف التسجيل غير موجود على هذا الجهاز');
        final bytes = await file.readAsBytes();
        await notifyWeb({'state':'audio-data','requestId':requestId,'fileName':fileName,'base64':base64Encode(bytes)});
      } else if (action == 'delete') {
        if (await file.exists()) await file.delete();
        await notifyWeb({'state':'audio-deleted','requestId':requestId,'fileName':fileName});
      } else {
        throw StateError('طلب غير معروف');
      }
    } catch (e) {
      await notifyWeb({'state':'audio-error','requestId': (() { try { return (jsonDecode(message.message) as Map)['requestId']; } catch (_) { return null; } })(), 'message':e.toString()});
    }
  }

  Future<void> handleMessage(JavaScriptMessage message) async {
    try {
      final data = jsonDecode(message.message) as Map<String, dynamic>;
      final action = data['action'];
      if (action == 'start') {
        if (activePath != null) throw StateError('يوجد تسجيل يعمل بالفعل');
        final permission = await Permission.microphone.request();
        if (!permission.isGranted) throw StateError('يجب السماح باستخدام الميكروفون');
        await Permission.notification.request();
        final base = await getApplicationDocumentsDirectory();
        final dir = Directory('${base.path}/MeetingRecordings');
        await dir.create(recursive: true);
        final path = '${dir.path}/meeting_${DateTime.now().millisecondsSinceEpoch}.m4a';
        await recorder.invokeMethod('start', {'path': path});
        activePath = path;
        meetingId = data['meetingId']?.toString();
        projectId = data['projectId']?.toString();
        await notifyWeb({'state':'recording','meetingId':meetingId});
      } else if (action == 'pause') {
        await recorder.invokeMethod('pause');
        await notifyWeb({'state':'paused','meetingId':meetingId});
      } else if (action == 'resume') {
        await recorder.invokeMethod('resume');
        await notifyWeb({'state':'recording','meetingId':meetingId});
      } else if (action == 'stop') {
        await recorder.invokeMethod('stop');
        await notifyWeb({'state':'stopped','meetingId':meetingId,'projectId':projectId,'fileName':activePath?.split(Platform.pathSeparator).last});
        activePath = null;
        meetingId = null;
        projectId = null;
      }
    } catch (e) {
      await notifyWeb({'state':'error','message':e.toString()});
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(child: Stack(children: [
      WebViewWidget(controller: web),
      if (loading) const LinearProgressIndicator(minHeight: 2),
    ])),
  );
}
