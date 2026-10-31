import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import 'package:intl/intl.dart';

void main() => runApp(const WeeklyPlannerMobile());

class WeeklyPlannerMobile extends StatelessWidget {
  const WeeklyPlannerMobile({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'WeeklyPlanner',
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff21865b)), useMaterial3: true, fontFamily: 'Roboto'),
    home: const MeetingsPage(),
  );
}

class RecordingItem {
  const RecordingItem(this.path, this.createdAt);
  final String path;
  final DateTime createdAt;
  String get name => path.split(Platform.pathSeparator).last;
}

class MeetingsPage extends StatefulWidget {
  const MeetingsPage({super.key});
  @override
  State<MeetingsPage> createState() => _MeetingsPageState();
}

class _MeetingsPageState extends State<MeetingsPage> with WidgetsBindingObserver {
  final AudioRecorder _recorder = AudioRecorder();
  final List<RecordingItem> _recordings = [];
  RecordState _state = RecordState.stop;
  StreamSubscription<RecordState>? _stateSub;
  StreamSubscription<Amplitude>? _amplitudeSub;
  Duration _elapsed = Duration.zero;
  Timer? _clock;
  DateTime? _startedAt;
  String? _activePath;
  String? _error;
  double _db = -160;

  bool get _recording => _state == RecordState.record;
  bool get _paused => _state == RecordState.pause;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _stateSub = _recorder.onStateChanged().listen((s) { if (mounted) setState(() => _state = s); });
    _amplitudeSub = _recorder.onAmplitudeChanged(const Duration(milliseconds: 500)).listen((a) { if (mounted) setState(() => _db = a.current); });
    _loadRecordings();
  }

  Future<Directory> _recordingsDir() async {
    final base = await getApplicationDocumentsDirectory();
    final dir = Directory('${base.path}/MeetingRecordings');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  Future<void> _loadRecordings() async {
    try {
      final dir = await _recordingsDir();
      final files = dir.listSync().whereType<File>().where((f) => f.path.endsWith('.m4a')).toList()
        ..sort((a,b) => b.statSync().modified.compareTo(a.statSync().modified));
      if (mounted) setState(() {
        _recordings
          ..clear()
          ..addAll(files.map((f) => RecordingItem(f.path, f.statSync().modified)));
      });
    } catch (e) { _showError('تعذر قراءة التسجيلات: $e'); }
  }

  Future<void> _start() async {
    setState(() => _error = null);
    final permission = await Permission.microphone.request();
    if (!permission.isGranted) { _showError('لازم تسمح باستخدام الميكروفون لبدء التسجيل.'); return; }
    try {
      final dir = await _recordingsDir();
      final stamp = DateFormat('yyyyMMdd_HHmmss').format(DateTime.now());
      final path = '${dir.path}/meeting_$stamp.m4a';
      await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 128000, sampleRate: 44100), path: path);
      _activePath = path;
      _startedAt = DateTime.now();
      _elapsed = Duration.zero;
      _clock?.cancel();
      _clock = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted && _recording && _startedAt != null) setState(() => _elapsed = DateTime.now().difference(_startedAt!));
      });
      setState(() {});
    } catch (e) { _showError('فشل بدء التسجيل: $e'); }
  }

  Future<void> _pause() async {
    try { await _recorder.pause(); _clock?.cancel(); setState(() {}); }
    catch (e) { _showError('تعذر إيقاف التسجيل مؤقتًا: $e'); }
  }

  Future<void> _resume() async {
    try { await _recorder.resume(); _startedAt = DateTime.now().subtract(_elapsed); _clock = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted && _recording && _startedAt != null) setState(() => _elapsed = DateTime.now().difference(_startedAt!)); }); setState(() {}); }
    catch (e) { _showError('تعذر استكمال التسجيل: $e'); }
  }

  Future<void> _stop() async {
    try {
      final path = await _recorder.stop();
      _clock?.cancel();
      _activePath = null;
      if (path != null && await File(path).exists()) await _loadRecordings();
      setState(() { _state = RecordState.stop; _elapsed = Duration.zero; });
    } catch (e) { _showError('تعذر إنهاء التسجيل وحفظه: $e'); }
  }

  Future<void> _delete(RecordingItem item) async {
    final ok = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('حذف التسجيل؟'), content: Text(item.name),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('إلغاء')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('حذف'))],
    ));
    if (ok == true) { await File(item.path).delete(); await _loadRecordings(); }
  }

  void _showError(String message) { if (mounted) setState(() => _error = message); }

  String _duration(Duration d) => '${d.inHours.toString().padLeft(2,'0')}:${(d.inMinutes%60).toString().padLeft(2,'0')}:${(d.inSeconds%60).toString().padLeft(2,'0')}';

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _clock?.cancel(); _stateSub?.cancel(); _amplitudeSub?.cancel(); _recorder.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      appBar: AppBar(title: const Text('اجتماعات المشاريع'), centerTitle: false),
      body: SafeArea(child: ListView(padding: const EdgeInsets.all(16), children: [
        Card(color: Theme.of(context).colorScheme.primaryContainer, child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('تسجيل اجتماع صوتي', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('يسجل الصوت ويحفظه على الجهاز قبل أي معالجة لاحقة.'),
          const SizedBox(height: 20),
          Text(_duration(_elapsed), textAlign: TextAlign.center, style: const TextStyle(fontSize: 34, fontFeatures: [])),
          const SizedBox(height: 14),
          if (!_recording && !_paused) FilledButton.icon(onPressed: _start, icon: const Icon(Icons.mic), label: const Text('بدء تسجيل صوتي')),
          if (_recording) Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: _pause, icon: const Icon(Icons.pause), label: const Text('إيقاف مؤقت'))),
            const SizedBox(width: 8),
            Expanded(child: FilledButton.icon(onPressed: _stop, icon: const Icon(Icons.stop), label: const Text('إنهاء وحفظ'))),
          ]),
          if (_paused) Row(children: [
            Expanded(child: FilledButton.icon(onPressed: _resume, icon: const Icon(Icons.play_arrow), label: const Text('استكمال'))),
            const SizedBox(width: 8),
            Expanded(child: FilledButton.icon(onPressed: _stop, icon: const Icon(Icons.stop), label: const Text('إنهاء وحفظ'))),
          ]),
          if (_recording || _paused) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_recording ? '● جارٍ التسجيل • مستوى الصوت ${_db.toStringAsFixed(0)} dB' : 'التسجيل متوقف مؤقتًا', textAlign: TextAlign.center)),
        ]))),
        if (_error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 12),
        Text('التسجيلات المحفوظة (${_recordings.length})', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        if (_recordings.isEmpty) const Card(child: Padding(padding: EdgeInsets.all(18), child: Text('لا توجد تسجيلات محفوظة حتى الآن.'))),
        ..._recordings.map((item) => Card(child: ListTile(
          leading: const CircleAvatar(child: Icon(Icons.audio_file)),
          title: Text(DateFormat('yyyy/MM/dd – hh:mm a').format(item.createdAt)),
          subtitle: Text(item.name, maxLines: 1, overflow: TextOverflow.ellipsis),
          trailing: IconButton(tooltip: 'حذف', onPressed: () => _delete(item), icon: const Icon(Icons.delete_outline)),
        ))),
        const SizedBox(height: 12),
        const Text('ملاحظة: هذه النسخة تحفظ التسجيل محليًا. ربطه بمشروع ومزامنته وإنشاء محضر الاجتماع سيتم في مرحلة التكامل التالية.', style: TextStyle(fontSize: 12, color: Colors.grey)),
      ])),
    ),
  );
}
