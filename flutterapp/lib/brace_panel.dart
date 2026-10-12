import 'dart:async';

import 'package:flutter/material.dart';
import 'api.dart';

const _green = Color(0xFF246B57);

String shanghaiTime(Object? value) {
  if (value == null) return '佩戴中';
  final date = DateTime.parse(value as String).toUtc().add(const Duration(hours: 8));
  return date.toIso8601String().substring(0, 16).replaceFirst('T', ' ');
}

String inputTime(String value) {
  final text = value.trim().replaceFirst(' ', 'T');
  return DateTime.parse(RegExp(r'(Z|[+-]\d\d:\d\d)$').hasMatch(text) ? text : '$text+08:00').toUtc().toIso8601String();
}

String editableShanghaiTime(String value) => DateTime.parse(value).toUtc().add(const Duration(hours: 8)).toIso8601String().replaceFirst('T', ' ').replaceFirst(RegExp(r'Z$'), '');

class TodayBracePanel extends StatefulWidget {
  const TodayBracePanel({super.key, required this.api});
  final SpineApi api;
  @override
  State<TodayBracePanel> createState() => _TodayBracePanelState();
}

class _TodayBracePanelState extends State<TodayBracePanel> {
  List<Map<String, dynamic>> braces = [], wears = [], comforts = [];
  Map<String, dynamic>? stats;
  int? selected;
  String? error;
  bool loading = true;
  Timer? _tick;
  Map<String, dynamic>? get active => wears.where((w) => w['ended_at'] == null).firstOrNull;
  Map<String, dynamic>? get selectedBrace => braces.where((b) => b['id'] == selected).firstOrNull;

  @override
  void initState() { super.initState(); _load(); _tick = Timer.periodic(const Duration(minutes: 1), (_) { if (mounted) setState(() {}); }); }
  @override
  void dispose() { _tick?.cancel(); super.dispose(); }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final nextBraces = await widget.api.list('braces');
      final nextWears = await widget.api.list('wear-sessions');
      final currentActive = nextWears.where((w) => w['ended_at'] == null).firstOrNull;
      final oldSelected = selected;
      final nextSelected = currentActive?['brace'] as int? ?? (nextBraces.any((b) => b['id'] == oldSelected) ? oldSelected : nextBraces.where((b) => b['is_active'] == true).firstOrNull?['id'] as int? ?? nextBraces.firstOrNull?['id'] as int?);
      Map<String, dynamic>? nextStats;
      List<Map<String, dynamic>> nextComforts = [];
      if (nextSelected != null) {
        nextStats = await widget.api.statisticsForBrace(nextSelected);
        nextComforts = await widget.api.list('comfort-entries');
      }
      if (!mounted) return;
      setState(() { braces = nextBraces; wears = nextWears; selected = nextSelected; stats = nextStats; comforts = nextComforts; loading = false; });
    } catch (_) { if (mounted) setState(() { loading = false; error = '暂时无法读取支具记录，请重试。'; }); }
  }

  Future<void> _openManagement() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => BraceManagementPage(api: widget.api, initialBraceId: selected)));
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (loading && braces.isEmpty) return const Card(elevation: 0, child: Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())));
    if (error != null && braces.isEmpty) return Card(elevation: 0, child: Padding(padding: const EdgeInsets.all(20), child: Column(children: [Text(error!), TextButton(onPressed: _load, child: const Text('重试'))])));
    final activeWear = active;
    final brace = selectedBrace;
    final today = DateTime.now().toUtc().add(const Duration(hours: 8)).toIso8601String().substring(0, 10);
    final todayDay = (stats?['days'] as List? ?? []).where((d) => d['date'] == today).firstOrNull;
    final seconds = (todayDay?['seconds'] as num?)?.toDouble() ?? 0;
    final minutes = seconds / 60;
    final currentDuration = activeWear == null ? null : DateTime.now().toUtc().difference(DateTime.parse(activeWear['started_at'] as String).toUtc());
    return Card(elevation: 0, color: const Color(0xFFEAF3ED), child: InkWell(borderRadius: BorderRadius.circular(12), onTap: _openManagement, child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [const Icon(Icons.accessibility_new, color: _green), const SizedBox(width: 10), Expanded(child: Text('支具', style: Theme.of(context).textTheme.titleLarge)), const Icon(Icons.chevron_right)]),
      const SizedBox(height: 12),
      if (brace == null) ...[const Text('还没有支具档案'), const SizedBox(height: 12), OutlinedButton.icon(onPressed: _openManagement, icon: const Icon(Icons.add), label: const Text('添加支具'))]
      else ...[
        Text(brace['name'] as String, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(activeWear != null ? '佩戴中${currentDuration == null ? '' : ' · 本次 ${_duration(currentDuration)}'}' : '当前未佩戴', style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        Text(todayDay == null ? '今日暂无记录' : '今日已记录 ${_duration(Duration(seconds: seconds.round()))}'),
        Text('统计按当前支具计算', style: TextStyle(fontSize: 12, color: Colors.grey.shade700)),
        Align(alignment: Alignment.centerRight, child: TextButton(onPressed: _openManagement, child: const Text('打开支具管理'))),
      ],
      if (error != null) Row(children: [Expanded(child: Text(error!, style: const TextStyle(color: Colors.red))), TextButton(onPressed: _load, child: const Text('重试'))]),
    ]))));
  }
}

String _duration(Duration duration) {
  final minutes = duration.inMinutes;
  return '${minutes ~/ 60}小时${minutes % 60}分钟';
}

class BraceManagementPage extends StatefulWidget {
  const BraceManagementPage({super.key, required this.api, this.initialBraceId});
  final SpineApi api;
  final int? initialBraceId;
  @override
  State<BraceManagementPage> createState() => _BraceManagementPageState();
}

class _BraceManagementPageState extends State<BraceManagementPage> {
  List<Map<String, dynamic>> braces = [], wears = [], comforts = [];
  Map<String, dynamic>? stats;
  int? selected;
  String? error, _startId;
  bool loading = true, busy = false;
  Timer? _tick;
  Map<String, dynamic>? get active => wears.where((w) => w['ended_at'] == null).firstOrNull;
  Map<String, dynamic>? get selectedBrace => braces.where((b) => b['id'] == selected).firstOrNull;
  String get braceName => braces.where((b) => b['id'] == (active?['brace'] ?? selected)).firstOrNull?['name']?.toString() ?? '支具';

  @override
  void initState() { super.initState(); selected = widget.initialBraceId; _reload(); _tick = Timer.periodic(const Duration(minutes: 1), (_) { if (mounted) setState(() {}); }); }
  @override
  void dispose() { _tick?.cancel(); super.dispose(); }

  Future<void> _reload() async {
    try {
      final values = await Future.wait([widget.api.list('braces'), widget.api.list('wear-sessions'), widget.api.list('comfort-entries')]);
      braces = values[0] as List<Map<String, dynamic>>; wears = values[1] as List<Map<String, dynamic>>; comforts = values[2] as List<Map<String, dynamic>>;
      if (!braces.any((b) => b['id'] == selected)) selected = active?['brace'] as int? ?? braces.where((b) => b['is_active'] == true).firstOrNull?['id'] as int? ?? braces.firstOrNull?['id'] as int?;
      if (selected != null) stats = await widget.api.statisticsForBrace(selected);
      if (mounted) setState(() { loading = false; error = null; });
    } catch (_) { if (mounted) setState(() { loading = false; error = '读取失败，请重试；当前页面数据可能尚未更新。'; }); }
  }

  Future<void> _action(Future<void> Function() action) async {
    if (busy) return;
    setState(() { busy = true; error = null; });
    try { await action(); await _reload(); }
    catch (e) { if (mounted) setState(() => error = _friendly(e)); }
    finally { if (mounted) setState(() => busy = false); }
  }

  Future<void> _open(Widget page) async { await Navigator.push(context, MaterialPageRoute(builder: (_) => page)); if (mounted) _reload(); }
  String _friendly(Object e) { final text = '$e'; if (text.contains('HTTP 409')) return '已有冲突佩戴记录，请先结束当前记录或检查历史时间。'; if (text.contains('HTTP 400')) return '提交内容或时间不合法，请检查后重试。'; if (text.contains('HTTP 401')) return '登录状态已失效，请重新登录。'; return '保存失败，已保留本页信息，请检查网络后重试。'; }

  @override
  Widget build(BuildContext context) {
    final activeWear = active;
    final today = DateTime.now().toUtc().add(const Duration(hours: 8)).toIso8601String().substring(0, 10);
    final todayDay = (stats?['days'] as List? ?? []).where((d) => d['date'] == today).firstOrNull;
    final selectedWears = wears.where((w) => w['brace'] == selected).toList();
    final selectedComforts = comforts.where((e) => e['brace'] == selected).take(3).toList();
    if (loading && braces.isEmpty) return Scaffold(appBar: AppBar(title: const Text('支具管理')), body: const Center(child: CircularProgressIndicator()));
    return Scaffold(appBar: AppBar(title: const Text('支具管理')), body: Align(alignment: Alignment.topCenter, child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 700), child: RefreshIndicator(onRefresh: _reload, child: ListView(padding: const EdgeInsets.fromLTRB(18, 8, 18, 32), children: [
      if (error != null) _ErrorBanner(message: error!, onRetry: _reload),
      if (braces.isEmpty) _EmptyState(title: '还没有支具档案', description: '先添加支具信息，再开始记录佩戴。', action: '添加支具', onTap: () => _open(BraceFormPage(api: widget.api))),
      if (braces.isNotEmpty) ...[
        _SectionCard(title: '当前支具', child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          DropdownButton<int>(isExpanded: true, value: selected, items: braces.map((b) => DropdownMenuItem(value: b['id'] as int, child: Text('${b['name']}${b['is_active'] == true ? '' : '（停用）'}'))).toList(), onChanged: busy ? null : (v) async { setState(() { selected = v; error = null; }); await _reload(); }),
          OutlinedButton.icon(onPressed: () => _open(BraceArchivePage(api: widget.api, braces: braces, selectedId: selected)), icon: const Icon(Icons.inventory_2_outlined), label: const Text('支具档案')),
        ])),
        if (activeWear != null) _SectionCard(title: '佩戴状态', child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('佩戴中：${braceName}', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8), Text('本次已记录 ${_duration(DateTime.now().toUtc().difference(DateTime.parse(activeWear['started_at'] as String).toUtc()))} · 当前仍在记录'),
          Text('开始于 ${shanghaiTime(activeWear['started_at'])}（上海时间）'),
          const SizedBox(height: 12), FilledButton(onPressed: busy ? null : () => _action(() async { await widget.api.endWear(activeWear['id'] as int); }), child: const Text('已取下')),
        ])) else if (selected != null) _SectionCard(title: '佩戴状态', child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('当前未佩戴'), Text('今日已记录：${todayDay == null ? '暂无记录' : _duration(Duration(seconds: (todayDay['seconds'] as num).round()))}'),
          const SizedBox(height: 12), FilledButton(onPressed: busy || selectedBrace?['is_active'] != true ? null : () => _action(() async { _startId ??= SpineApi.requestId(); await widget.api.startWear(selected!, _startId!); _startId = null; }), child: const Text('已戴上')),
          if (selectedBrace?['is_active'] != true) const Text('停用档案不能开始新的佩戴记录。', style: TextStyle(fontSize: 12)),
        ])),
        if (activeWear != null && activeWear['brace'] != selected) _ErrorBanner(message: '另一个支具仍有未结束记录：${braceName}。先结束该记录后才能切换佩戴。', onRetry: _reload),
        _SectionCard(title: '记录', child: Wrap(spacing: 8, runSpacing: 8, children: [
          OutlinedButton.icon(onPressed: selected == null ? null : () => _open(ComfortFormPage(api: widget.api, braceId: selected!, wears: selectedWears)), icon: const Icon(Icons.mood_outlined), label: const Text('记录感受')),
          OutlinedButton.icon(onPressed: selected == null || activeWear != null ? null : () => _open(WearFormPage(api: widget.api, braceId: selected!, braceName: braceName)), icon: const Icon(Icons.edit_calendar_outlined), label: const Text('补录')),
          OutlinedButton.icon(onPressed: () => _open(WearHistoryPage(api: widget.api, selectedBraceId: selected)), icon: const Icon(Icons.history), label: const Text('完整历史')),
          OutlinedButton.icon(onPressed: () => _open(BraceTrendsPage(api: widget.api, selectedBraceId: selected)), icon: const Icon(Icons.show_chart), label: const Text('趋势统计')),
          OutlinedButton.icon(onPressed: () => _open(const RequirementsPage()), icon: const Icon(Icons.rule_outlined), label: const Text('佩戴要求')),
        ])),
        _SectionCard(title: '今日佩戴时间（上海时间）', child: todayDay == null ? const Text('今日暂无佩戴记录。') : Text('${_duration(Duration(seconds: (todayDay['seconds'] as num).round()))} · ${todayDay['minutes'].toStringAsFixed(0)} 分钟')),
        _SectionCard(title: '近期感受', child: selectedComforts.isEmpty ? const Text('暂无感受记录。') : Column(children: selectedComforts.map((e) => ListTile(contentPadding: EdgeInsets.zero, title: Text('${shanghaiTime(e['occurred_at'])} · ${e['comfort_level'] == null ? '舒适度未填写' : _comfortLabel(e['comfort_level'] as int)}'), subtitle: Text('痛感：${e['pain'] == null ? '未填写' : '${e['pain']} 分'}${(e['tags'] as List).isEmpty ? '' : ' · ${(e['tags'] as List).join('、')}'}'), onTap: () => _open(ComfortFormPage(api: widget.api, braceId: selected!, wears: selectedWears, record: e)))).toList())),
        if (busy) const LinearProgressIndicator(),
      ],
    ])))));
  }
}

class BraceArchivePage extends StatelessWidget {
  const BraceArchivePage({super.key, required this.api, required this.braces, this.selectedId});
  final SpineApi api; final List<Map<String, dynamic>> braces; final int? selectedId;
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('支具档案'), actions: [IconButton(tooltip: '添加支具', onPressed: () async { await Navigator.push(context, MaterialPageRoute(builder: (_) => BraceFormPage(api: api))); if (context.mounted) Navigator.pop(context); }, icon: const Icon(Icons.add))]), body: ListView(padding: const EdgeInsets.all(16), children: [
    if (braces.isEmpty) const _EmptyState(title: '暂无支具档案', description: '添加后可开始佩戴记录。')
    else ...braces.map((b) => Card(elevation: 0, color: Colors.white, child: ListTile(title: Text('${b['name']}${b['id'] == selectedId ? ' · 当前选择' : ''}'), subtitle: Text('${b['brace_type'] ?? '类型未填写'} · ${b['is_active'] == true ? '在用' : '停用'}${b['institution'] == '' ? '' : ' · ${b['institution']}'}'), trailing: const Icon(Icons.edit_outlined), onTap: () async { await Navigator.push(context, MaterialPageRoute(builder: (_) => BraceFormPage(api: api, record: b))); if (context.mounted) Navigator.pop(context); }))),
    const Padding(padding: EdgeInsets.all(12), child: Text('添加新支具会保留旧档案和历史记录。停用仅影响后续新记录。', style: TextStyle(fontSize: 12))),
  ]));
}

class BraceFormPage extends StatefulWidget {
  const BraceFormPage({super.key, required this.api, this.record});
  final SpineApi api; final Map<String, dynamic>? record;
  @override
  State<BraceFormPage> createState() => _BraceFormPageState();
}
class _BraceFormPageState extends State<BraceFormPage> {
  late final name = TextEditingController(text: widget.record?['name']?.toString() ?? '');
  late final type = TextEditingController(text: widget.record?['brace_type']?.toString() ?? '');
  late final notes = TextEditingController(text: widget.record?['notes']?.toString() ?? '');
  late final institution = TextEditingController(text: widget.record?['institution']?.toString() ?? '');
  late final started = TextEditingController(text: widget.record?['started_on']?.toString() ?? '');
  bool active = true, busy = false; String? error;
  @override
  void initState() { super.initState(); active = widget.record?['is_active'] as bool? ?? true; }
  @override
  void dispose() { for (final c in [name,type,notes,institution,started]) { c.dispose(); } super.dispose(); }
  Future<void> save() async { setState(() { busy = true; error = null; }); try { final d = {'name':name.text.trim(),'brace_type':type.text.trim(),'notes':notes.text.trim(),'institution':institution.text.trim(),'started_on':started.text.trim().isEmpty ? null : started.text.trim(),'is_active':active}; await widget.api.save('braces', d, id: widget.record?['id'] as int?); if (mounted) Navigator.pop(context, true); } catch (_) { if (mounted) setState(() => error = '保存失败，请检查必填字段和网络后重试。'); } finally { if (mounted) setState(() => busy = false); } }
  @override
  Widget build(BuildContext context) => _FormScaffold(title: widget.record == null ? '添加支具' : '编辑支具', busy: busy, error: error, onSave: save, children: [TextField(controller:name, enabled:!busy, decoration:const InputDecoration(labelText:'支具名称（必填）')), TextField(controller:type, enabled:!busy, decoration:const InputDecoration(labelText:'支具类型')), TextField(controller:institution, enabled:!busy, decoration:const InputDecoration(labelText:'配置机构')), TextField(controller:started, enabled:!busy, decoration:const InputDecoration(labelText:'开始使用日期（YYYY-MM-DD）')), TextField(controller:notes, enabled:!busy, maxLines:3, decoration:const InputDecoration(labelText:'备注')), SwitchListTile(title:const Text('在用'), value:active, onChanged:busy ? null : (v)=>setState(()=>active=v))]);
}

class WearFormPage extends StatefulWidget {
  const WearFormPage({super.key, required this.api, required this.braceId, required this.braceName, this.record});
  final SpineApi api; final int braceId; final String braceName; final Map<String, dynamic>? record;
  @override
  State<WearFormPage> createState() => _WearFormPageState();
}
class _WearFormPageState extends State<WearFormPage> {
  late final start = TextEditingController(text: widget.record == null ? _nowShanghai() : editableShanghaiTime(widget.record!['started_at'] as String));
  late final end = TextEditingController(text: widget.record == null || widget.record?['ended_at'] == null ? '' : editableShanghaiTime(widget.record!['ended_at'] as String));
  late final notes = TextEditingController(text: widget.record?['notes']?.toString() ?? '');
  late final reason = TextEditingController();
  final requestId = SpineApi.requestId();
  bool busy=false; String? error;
  @override
  void dispose(){start.dispose();end.dispose();notes.dispose();reason.dispose();super.dispose();}
  Future<void> save() async { setState(()=>busy=true); try { final body=<String,dynamic>{'started_at':inputTime(start.text),'ended_at':end.text.trim().isEmpty ? null : inputTime(end.text),'notes':notes.text.trim()}; if(widget.record==null){body.addAll({'brace':widget.braceId,'request_id':requestId,'original_timezone':'Asia/Shanghai'});} else {body.addAll({'version':widget.record!['version'],'reason':reason.text.trim()});} await widget.api.save('wear-sessions',body,id:widget.record?['id'] as int?); if(mounted)Navigator.pop(context,true); } catch(e){if(mounted)setState(()=>error='$e');} finally{if(mounted)setState(()=>busy=false);} }
  @override
  Widget build(BuildContext context)=>_FormScaffold(title:widget.record==null?'补录佩戴':'修正佩戴记录',busy:busy,error:error,onSave:save,children:[Text('支具：${widget.braceName}'),const Text('使用保存的时间点统计；时间均按上海时间填写。'),TextField(controller:start,enabled:!busy,decoration:const InputDecoration(labelText:'开始时间 YYYY-MM-DD HH:mm')),TextField(controller:end,enabled:!busy,decoration:InputDecoration(labelText:widget.record==null?'结束时间（补录必填）':'结束时间（空白表示仍在记录）')),TextField(controller:notes,enabled:!busy,maxLines:3,decoration:const InputDecoration(labelText:'备注')),if(widget.record!=null)TextField(controller:reason,enabled:!busy,decoration:const InputDecoration(labelText:'修正原因（必填）'))]);
}

String _nowShanghai()=>editableShanghaiTime(DateTime.now().toUtc().toIso8601String());

const _positions=['颈部','肩部','胸背','腰部','髋部','腹部','其他'];
const _tags=['压迫','摩擦','闷热','瘙痒','疼痛','麻木','活动受限','其他'];
String _comfortLabel(int value)=>['','很不舒服','不太舒服','一般','比较舒适','很舒适'][value.clamp(1,5)];

class ComfortFormPage extends StatefulWidget {
  const ComfortFormPage({super.key, required this.api, required this.braceId, required this.wears, this.record});
  final SpineApi api; final int braceId; final List<Map<String,dynamic>> wears; final Map<String,dynamic>? record;
  @override
  State<ComfortFormPage> createState()=>_ComfortFormPageState();
}
class _ComfortFormPageState extends State<ComfortFormPage>{
  late final pain=TextEditingController(text:widget.record?['pain']?.toString()??'');
  late final painNote=TextEditingController(text:widget.record?['pain_note']?.toString()??'');
  late final notes=TextEditingController(text:widget.record?['notes']?.toString()??'');
  late final occurred=TextEditingController(text:widget.record==null?_nowShanghai():editableShanghaiTime(widget.record!['occurred_at'] as String));
  late final customPosition=TextEditingController();
  late final customTag=TextEditingController();
  late Set<String> positions=(widget.record?['positions'] as List? ?? []).cast<String>().toSet();
  late Set<String> tags=(widget.record?['tags'] as List? ?? []).cast<String>().toSet();
  int? comfort=widget.record?['comfort_level'] as int?; int? wearId; bool busy=false; String? error;
  final requestId=SpineApi.requestId();
  @override void initState(){super.initState();wearId=widget.record?['wear_session'] as int?;}
  @override void dispose(){for(final c in [pain,painNote,notes,occurred,customPosition,customTag]){c.dispose();}super.dispose();}
  Future<void> save() async{setState(()=>busy=true);try{final value=pain.text.trim().isEmpty?null:int.parse(pain.text.trim()); if(value!=null&&(value<0||value>10))throw const FormatException('痛感范围为 0—10');final body={'brace':widget.braceId,'wear_session':wearId,'comfort_level':comfort,'pain':value,'pain_note':painNote.text.trim(),'positions':[...positions,...(customPosition.text.trim().isEmpty?[]:[customPosition.text.trim()])],'tags':[...tags,...(customTag.text.trim().isEmpty?[]:[customTag.text.trim()])],'occurred_at':inputTime(occurred.text),'notes':notes.text.trim()}; if(widget.record==null)body['request_id']=requestId; await widget.api.save('comfort-entries',body,id:widget.record?['id'] as int?);if(mounted)Navigator.pop(context,true);}catch(e){if(mounted)setState(()=>error='${e is FormatException?'痛感需填写 0—10 的整数。':'保存失败，请检查时间和网络后重试。'}');}finally{if(mounted)setState(()=>busy=false);}}
  @override Widget build(BuildContext context)=>_FormScaffold(title:widget.record==null?'记录感受':'编辑感受',busy:busy,error:error,onSave:save,children:[const Text('私人记录仅本人可见。痛感留空与 0 分不同。'),DropdownButtonFormField<int>(initialValue:comfort,decoration:const InputDecoration(labelText:'整体舒适度（可选）'),items:List.generate(5,(i)=>DropdownMenuItem(value:i+1,child:Text(_comfortLabel(i+1)))),onChanged:busy?null:(v)=>setState(()=>comfort=v)),TextField(controller:pain,enabled:!busy,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'痛感 0—10（可空）')),TextField(controller:painNote,enabled:!busy,maxLines:2,decoration:const InputDecoration(labelText:'痛感说明（可选）')),_ChoiceGroup(title:'不适位置（可多选）',values:_positions,selected:positions,onChanged:(v)=>setState(()=>positions=v)),TextField(controller:customPosition,enabled:!busy,decoration:const InputDecoration(labelText:'其他位置（可选）')),_ChoiceGroup(title:'感受标签（可多选）',values:_tags,selected:tags,onChanged:(v)=>setState(()=>tags=v)),TextField(controller:customTag,enabled:!busy,decoration:const InputDecoration(labelText:'其他标签（可选）')),TextField(controller:occurred,enabled:!busy,decoration:const InputDecoration(labelText:'实际发生时间（上海时间 YYYY-MM-DD HH:mm）')),DropdownButtonFormField<int?>(initialValue:wearId,decoration:const InputDecoration(labelText:'关联佩戴记录（可选）'),items:[const DropdownMenuItem<int?>(value:null,child:Text('不关联')), ...widget.wears.map((w)=>DropdownMenuItem<int?>(value:w['id'] as int,child:Text('#${w['id']} · ${shanghaiTime(w['started_at'])}')))],onChanged:busy?null:(v)=>setState(()=>wearId=v)),TextField(controller:notes,enabled:!busy,maxLines:3,decoration:const InputDecoration(labelText:'备注（可选）')),if(widget.record!=null)TextButton.icon(onPressed:busy?null:()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>FollowUpPage(api:widget.api,entry:widget.record!))),icon:const Icon(Icons.update),label:const Text('追加后续感受'))]);
}

class _ChoiceGroup extends StatelessWidget{
  const _ChoiceGroup({required this.title,required this.values,required this.selected,required this.onChanged});final String title;final List<String> values;final Set<String> selected;final ValueChanged<Set<String>> onChanged;
  @override Widget build(BuildContext context)=>Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Padding(padding:const EdgeInsets.only(top:12),child:Text(title)),Wrap(spacing:6,children:values.map((v)=>FilterChip(label:Text(v),selected:selected.contains(v),onSelected:(yes){final next={...selected};yes?next.add(v):next.remove(v);onChanged(next);})).toList())]);
}

class FollowUpPage extends StatefulWidget{const FollowUpPage({super.key,required this.api,required this.entry});final SpineApi api;final Map<String,dynamic> entry;@override State<FollowUpPage> createState()=>_FollowUpPageState();}
class _FollowUpPageState extends State<FollowUpPage>{String? status;late final occurred=TextEditingController(text:_nowShanghai());final notes=TextEditingController();bool busy=false,loading=true;String? error;List<Map<String,dynamic>> values=[];final requestId=SpineApi.requestId();@override void initState(){super.initState();_load();}@override void dispose(){occurred.dispose();notes.dispose();super.dispose();}Future<void> _load()async{try{values=await widget.api.followUps(widget.entry['id'] as int);if(mounted)setState(()=>loading=false);}catch(_){if(mounted)setState(()=>loading=false);}}Future<void> save()async{if(status==null){setState(()=>error='请选择当前变化。');return;}setState(()=>busy=true);try{await widget.api.addFollowUp({'entry':widget.entry['id'],'status':status,'occurred_at':inputTime(occurred.text),'notes':notes.text.trim(),'request_id':requestId});notes.clear();status=null;await _load();}catch(_){setState(()=>error='保存失败，内容已保留，请重试。');}finally{if(mounted)setState(()=>busy=false);}}@override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('后续感受')),body:ListView(padding:const EdgeInsets.all(18),children:[const Text('追加记录不会覆盖之前的感受。'),DropdownButtonFormField<String>(initialValue:status,decoration:const InputDecoration(labelText:'当前变化'),items:const [DropdownMenuItem(value:'improved',child:Text('缓解')),DropdownMenuItem(value:'persisting',child:Text('仍存在')),DropdownMenuItem(value:'worsened',child:Text('加重'))],onChanged:busy?null:(v)=>setState(()=>status=v)),TextField(controller:occurred,decoration:const InputDecoration(labelText:'发生时间（上海时间 YYYY-MM-DD HH:mm）')),TextField(controller:notes,maxLines:3,decoration:const InputDecoration(labelText:'补充说明')),if(error!=null)Text(error!,style:const TextStyle(color:Colors.red)),FilledButton(onPressed:busy?null:save,child:const Text('保存后续记录')),const Divider(),if(loading)const LinearProgressIndicator(),for(final item in values)ListTile(title:Text({'improved':'缓解','persisting':'仍存在','worsened':'加重'}[item['status']]??'后续感受'),subtitle:Text('${shanghaiTime(item['occurred_at'])} · ${item['notes']}'))]));}

class WearHistoryPage extends StatefulWidget{const WearHistoryPage({super.key,required this.api,this.selectedBraceId});final SpineApi api;final int? selectedBraceId;@override State<WearHistoryPage> createState()=>_WearHistoryPageState();}
class _WearHistoryPageState extends State<WearHistoryPage>{bool loading=true;String? error;List<Map<String,dynamic>> braces=[],wears=[],feelings=[];@override void initState(){super.initState();_load();}Future<void> _load()async{setState(()=>loading=true);try{final r=await Future.wait([widget.api.list('braces'),widget.api.list('wear-sessions'),widget.api.list('comfort-entries')]);if(mounted)setState((){braces=r[0] as List<Map<String,dynamic>>;wears=r[1] as List<Map<String,dynamic>>;feelings=r[2] as List<Map<String,dynamic>>;loading=false;error=null;});}catch(_){if(mounted)setState(()=>{loading=false,error='读取失败，请重试。'});}}String name(int? id)=>braces.where((b)=>b['id']==id).firstOrNull?['name']?.toString()??'支具';@override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('完整历史')),body:RefreshIndicator(onRefresh:_load,child:ListView(padding:const EdgeInsets.all(16),children:[if(error!=null)_ErrorBanner(message:error!,onRetry:_load),if(loading)const LinearProgressIndicator(),Text('佩戴记录',style:Theme.of(context).textTheme.titleLarge),if(wears.isEmpty&&!loading)const Text('暂无佩戴记录。'),...wears.where((w)=>widget.selectedBraceId==null||w['brace']==widget.selectedBraceId).map((w)=>Card(elevation:0,color:Colors.white,child:ListTile(title:Text(name(w['brace'] as int?)),subtitle:Text('${shanghaiTime(w['started_at'])} → ${shanghaiTime(w['ended_at'])}\n${w['notes']} · 第 ${w['version']} 版'),isThreeLine:true,trailing:IconButton(tooltip:'修正',icon:const Icon(Icons.edit_outlined),onPressed:()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>WearFormPage(api:widget.api,braceId:w['brace'] as int,braceName:name(w['brace'] as int?),record:w))))))),const SizedBox(height:18),Text('感受记录',style:Theme.of(context).textTheme.titleLarge),if(feelings.isEmpty&&!loading)const Text('暂无感受记录。'),...feelings.where((e)=>widget.selectedBraceId==null||e['brace']==widget.selectedBraceId).map((e)=>Card(elevation:0,color:Colors.white,child:ListTile(title:Text('${name(e['brace'] as int?)} · ${shanghaiTime(e['occurred_at'])}'),subtitle:Text('舒适度：${e['comfort_level']==null?'未填写':_comfortLabel(e['comfort_level'] as int)} · 痛感：${e['pain']==null?'未填写':'${e['pain']}分'}\n${e['notes']}'),isThreeLine:true,onTap:()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>ComfortFormPage(api:widget.api,braceId:e['brace'] as int,wears:wears.where((w)=>w['brace']==e['brace']).toList(),record:e))))))])));}}

class BraceTrendsPage extends StatefulWidget{const BraceTrendsPage({super.key,required this.api,this.selectedBraceId});final SpineApi api;final int? selectedBraceId;@override State<BraceTrendsPage> createState()=>_BraceTrendsPageState();}
class _BraceTrendsPageState extends State<BraceTrendsPage>{Map<String,dynamic>? stats;String? error;bool loading=true;@override void initState(){super.initState();_load();}Future<void> _load()async{try{final s=await widget.api.statisticsForBrace(widget.selectedBraceId);if(mounted)setState(()=>{stats=s,loading=false,error=null});}catch(_){if(mounted)setState(()=>{loading=false,error='读取统计失败，请重试。'});}}@override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('趋势统计')),body:RefreshIndicator(onRefresh:_load,child:ListView(padding:const EdgeInsets.all(18),children:[if(error!=null)_ErrorBanner(message:error!,onRetry:_load),if(loading)const LinearProgressIndicator(),const Text('每日佩戴时长（上海时间）'),if((stats?['days'] as List? ?? []).isEmpty&&!loading)const Text('暂无数据；无记录不代表未佩戴。'),for(final day in (stats?['days'] as List? ?? []).take(35))ListTile(title:Text(day['date']),trailing:Text('${(day['minutes'] as num).toStringAsFixed(0)} 分钟')),const Divider(),Text('每周累计',style:Theme.of(context).textTheme.titleMedium),for(final week in (stats?['weeks'] as List? ?? []).take(12))ListTile(title:Text('周起始 ${week['week_start']}'),trailing:Text('${(week['minutes'] as num).toStringAsFixed(0)} 分钟')),const Padding(padding:EdgeInsets.only(top:12),child:Text('统计只包含当前选择的支具；佩戴要求暂未接入，不设置默认目标。',style:TextStyle(fontSize:12)))])));}}

class RequirementsPage extends StatelessWidget{const RequirementsPage({super.key});@override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('佩戴要求')),body:const Center(child:Padding(padding:EdgeInsets.all(24),child:Text('专业制定的佩戴要求尚未接入。当前不会设置默认时长或推算达标率。'))));}

class _FormScaffold extends StatelessWidget{const _FormScaffold({required this.title,required this.children,required this.onSave,this.error,this.busy=false});final String title;final List<Widget> children;final Future<void> Function() onSave;final String? error;final bool busy;@override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text(title)),body:Align(alignment:Alignment.topCenter,child:ConstrainedBox(constraints:const BoxConstraints(maxWidth:620),child:ListView(padding:const EdgeInsets.all(20),children:[...children.map((w)=>Padding(padding:const EdgeInsets.only(bottom:12),child:w)),if(error!=null)Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),if(busy)const LinearProgressIndicator(),const SizedBox(height:8),FilledButton(onPressed:busy?null:onSave,child:const Text('保存'))]))));}

class _SectionCard extends StatelessWidget{const _SectionCard({required this.title,required this.child});final String title;final Widget child;@override Widget build(BuildContext context)=>Card(elevation:0,color:Colors.white,margin:const EdgeInsets.only(bottom:14),child:Padding(padding:const EdgeInsets.all(18),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(title,style:Theme.of(context).textTheme.titleMedium),const SizedBox(height:12),child])));}
class _ErrorBanner extends StatelessWidget{const _ErrorBanner({required this.message,required this.onRetry});final String message;final VoidCallback onRetry;@override Widget build(BuildContext context)=>Card(color:const Color(0xFFFFF0ED),elevation:0,child:Padding(padding:const EdgeInsets.all(12),child:Row(children:[Expanded(child:Text(message,style:const TextStyle(color:Color(0xFF9D3423)))),TextButton(onPressed:onRetry,child:const Text('重试'))])));}
class _EmptyState extends StatelessWidget{const _EmptyState({required this.title,required this.description,this.action,this.onTap});final String title,description;final String? action;final VoidCallback? onTap;@override Widget build(BuildContext context)=>Card(elevation:0,color:Colors.white,child:Padding(padding:const EdgeInsets.all(24),child:Column(children:[const Icon(Icons.inventory_2_outlined,size:34,color:_green),const SizedBox(height:10),Text(title,style:Theme.of(context).textTheme.titleMedium),const SizedBox(height:6),Text(description,textAlign:TextAlign.center),if(action!=null)Padding(padding:const EdgeInsets.only(top:12),child:FilledButton(onPressed:onTap,child:Text(action!)))])));}
