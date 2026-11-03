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
  String? pageError;
  String? activePath, meetingId, projectId;

  @override
  void initState() {
    super.initState();
    recorder.setMethodCallHandler((call) async {
      if (call.method == 'serviceEvent') {
        final data = Map<String, dynamic>.from(call.arguments as Map);
        final state = data['state']?.toString();
        final path = data['path']?.toString() ?? activePath;
        if (state == 'stopped') {
          await notifyWeb({'state':'stopped','meetingId':meetingId,'projectId':projectId,'fileName':path?.split(Platform.pathSeparator).last});
          activePath = null;
          meetingId = null;
          projectId = null;
        } else if (state == 'error') {
          await notifyWeb({'state':'error','message':data['message'] ?? 'حدث خطأ في التسجيل'});
          activePath = null;
          meetingId = null;
          projectId = null;
        } else if (state == 'recording' || state == 'paused') {
          await notifyWeb({'state':state,'meetingId':meetingId});
        }
      }
      return null;
    });
    web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('WeeklyPlannerRecorder', onMessageReceived: handleMessage)
      ..addJavaScriptChannel('WeeklyPlannerNative', onMessageReceived: handleNativeRequest)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) { if (!mounted) return; setState(() { loading = true; pageError = null; }); },
        onPageFinished: (_) { if (mounted) setState(() => loading = false); },
        onWebResourceError: (error) {
          if (error.isForMainFrame == false || !mounted) return;
          setState(() { loading = false; pageError = 'تعذر تحميل التطبيق: ${error.description}'; });
        },
        onHttpError: (error) {
          if (!mounted) return;
          final code = error.response?.statusCode;
          if (code != null && code >= 400) {
            setState(() { loading = false; pageError = 'خطأ من الخادم: HTTP $code'; });
          }
        },
      ))
      ..loadRequest(Uri.parse('https://abdos6335-netizen.github.io/weeklyplanner/'));
  }

  Future<void> reloadPage() async {
    if (!mounted) return;
    setState(() { pageError = null; loading = true; });
    await web.loadRequest(Uri.parse('https://abdos6335-netizen.github.io/weeklyplanner/'));
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
      if (!RegExp(r'^meeting_[0-9]{10,20}\.m4a$').hasMatch(fileName)) {
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
      } else if (action == 'resume') {
        await recorder.invokeMethod('resume');
      } else if (action == 'stop') {
        await recorder.invokeMethod('stop');
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
      if (pageError != null) ColoredBox(
        color: Theme.of(context).scaffoldBackgroundColor,
        child: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.cloud_off, size: 44),
          const SizedBox(height: 16),
          const Text('تعذر فتح WeeklyPlanner', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(pageError!, textAlign: TextAlign.center),
          const SizedBox(height: 20),
          FilledButton.icon(onPressed: reloadPage, icon: const Icon(Icons.refresh), label: const Text('إعادة المحاولة')),
        ]))),
      ),
    ])),
  );
}
