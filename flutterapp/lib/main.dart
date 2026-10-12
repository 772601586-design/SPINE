import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'api.dart';
import 'brace_panel.dart';
import 'session_storage.dart';

void main() => runApp(const SpineApp());

enum SessionState { checking, signedOut, signedIn, unavailable }

class SpineSession extends ChangeNotifier {
  SpineSession() {
    api.onUnauthorized = _expired;
  }

  final api = SpineApi();
  final _storage = createSessionStorage();
  SessionState state = SessionState.checking;
  Map<String, dynamic>? user;
  String? restoreError;

  Future<void> restore() async {
    try {
      final token = await _storage.readToken();
      if (token == null || token.isEmpty) {
        state = SessionState.signedOut;
        notifyListeners();
        return;
      }
      api.restoreToken(token);
      user = await api.me();
      state = SessionState.signedIn;
      restoreError = null;
    } catch (_) {
      if (!api.loggedIn) {
        await _storage.clearToken();
        user = null;
        state = SessionState.signedOut;
      } else {
        state = SessionState.unavailable;
        restoreError = '暂时无法验证登录状态，请检查网络后重试。';
      }
    }
    notifyListeners();
  }

  Future<void> login(String username, String password) async {
    final account = await api.login(username, password);
    await _storage.writeToken(api.tokenValue!);
    user = account;
    state = SessionState.signedIn;
    notifyListeners();
  }

  Future<void> logout() async {
    Object? failure;
    try {
      if (api.loggedIn) await api.logout();
    } catch (error) {
      failure = error;
    } finally {
      api.clearToken();
      await _storage.clearToken();
      user = null;
      state = SessionState.signedOut;
      notifyListeners();
    }
    if (failure != null) throw StateError('本机凭据已清除，但服务器暂时未确认撤销。请联网后重新登录并退出。');
  }

  void _expired() {
    api.clearToken();
    user = null;
    state = SessionState.signedOut;
    _storage.clearToken();
    notifyListeners();
  }

  @override
  void dispose() {
    api.onUnauthorized = null;
    api.close();
    super.dispose();
  }
}

class SpineApp extends StatefulWidget {
  const SpineApp({super.key});
  @override
  State<SpineApp> createState() => _SpineAppState();
}

class _SpineAppState extends State<SpineApp> {
  late final SpineSession session = SpineSession()..restore();
  @override
  void dispose() {
    session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'SPINE',
    debugShowCheckedModeBanner: false,
    locale: const Locale('zh', 'CN'),
    supportedLocales: const [Locale('zh', 'CN')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF246B57)),
      scaffoldBackgroundColor: const Color(0xFFF5F7F5),
      appBarTheme: const AppBarTheme(backgroundColor: Color(0xFFF5F7F5)),
      inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
    ),
    home: AnimatedBuilder(
      animation: session,
      builder: (context, _) => switch (session.state) {
        SessionState.checking => const _SessionLoading(),
        SessionState.signedOut => LoginPage(session: session),
        SessionState.unavailable => _RestoreFailure(session: session),
        SessionState.signedIn => HomeShell(session: session, key: const ValueKey('home')),
      },
    ),
  );
}

class _SessionLoading extends StatelessWidget {
  const _SessionLoading();
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: CircularProgressIndicator()));
}

class _RestoreFailure extends StatelessWidget {
  const _RestoreFailure({required this.session});
  final SpineSession session;
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 420), child: Padding(
      padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off_outlined, size: 48), const SizedBox(height: 16),
        Text(session.restoreError ?? '暂时无法验证登录状态。'), const SizedBox(height: 16),
        FilledButton(onPressed: session.restore, child: const Text('重试')),
        TextButton(onPressed: session.logout, child: const Text('清除此设备的登录状态')),
      ]),
    ))),
  );
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.session});
  final SpineSession session;
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false, _visible = false;
  String? _error;
  @override
  void dispose() { _username.dispose(); _password.dispose(); super.dispose(); }

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      await widget.session.login(_username.text.trim(), _password.text);
      _password.clear();
    } catch (error) {
      final message = '$error';
      setState(() => _error = message.contains('HTTP 400') || message.contains('HTTP 401')
          ? '账号或密码不正确，请重试。'
          : '登录暂未完成，请检查网络后重试。');
    } finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(child: SingleChildScrollView(child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 420), child: Padding(
        padding: const EdgeInsets.all(24), child: Card(color: Colors.white, elevation: 0, child: Padding(
          padding: const EdgeInsets.all(28), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Icon(Icons.spa_outlined, size: 42, color: Color(0xFF246B57)),
            const SizedBox(height: 14), Text('欢迎回到 SPINE', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8), const Text('登录后查看你的私人记录。', textAlign: TextAlign.center), const SizedBox(height: 24),
            TextField(controller: _username, enabled: !_busy, autocorrect: false, textInputAction: TextInputAction.next, decoration: const InputDecoration(labelText: '账号')),
            const SizedBox(height: 14), TextField(controller: _password, enabled: !_busy, obscureText: !_visible, autocorrect: false, enableSuggestions: false, onSubmitted: (_) => _busy ? null : _submit(), decoration: InputDecoration(labelText: '密码', suffixIcon: IconButton(tooltip: _visible ? '隐藏密码' : '显示密码', onPressed: () => setState(() => _visible = !_visible), icon: Icon(_visible ? Icons.visibility_off : Icons.visibility)))),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
            if (_busy) const Padding(padding: EdgeInsets.only(top: 18), child: LinearProgressIndicator()),
            const SizedBox(height: 20), FilledButton(onPressed: _busy ? null : _submit, child: const Text('登录')),
          ]),
        )),
      ),
    ))),
  );
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.session});
  final SpineSession session;
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  static const _titles = ['今日', '社区', '专业服务', '个人'];
  static const _subtitles = ['每一步，照顾好自己。', '分享与交流，慢慢向前。', '让专业支持更容易找到。', '属于你的记录与成长。'];
  static const _entries = [
    [('康复任务', '未来在这里查看个人康复任务。'), ('运动养护', '独立的运动养护课程入口。')],
    [('康复日记', '记录与分享自己的经历。'), ('专业科普', '未来展示经审核的科普内容。'), ('话题交流', '话题、关注与互动入口。')],
    [('专业对话', '未来在这里与已关联人员交流。'), ('已关联人员', '服务关系与授权将在下一阶段接入。'), ('寻找机构', '机构搜索与地图服务尚未接入。')],
    [('个人资料', '个人信息与设置入口。'), ('健康档案', '私人资料与历史记录入口。'), ('我的成长', '里程碑与个人动态入口。')],
  ];

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('SPINE', style: TextStyle(letterSpacing: 3, fontWeight: FontWeight.w700))),
    body: Align(alignment: Alignment.topCenter, child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 680), child: ListView(
      key: PageStorageKey('tab-$_index'), padding: const EdgeInsets.fromLTRB(20, 16, 20, 28), children: [
        Text(_titles[_index], style: Theme.of(context).textTheme.headlineLarge?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8), Text(_subtitles[_index], style: TextStyle(color: Colors.grey.shade600)), const SizedBox(height: 20),
        if (_index == 0) TodayBracePanel(api: widget.session.api),
        if (_index == 3) _PersonalTab(session: widget.session),
        for (final entry in _entries[_index]) _FeatureCard(title: entry.$1, description: entry.$2),
        if (_index == 0) const Padding(padding: EdgeInsets.only(top: 8), child: Text('你的私人记录仅本人可见。', style: TextStyle(fontSize: 12, color: Colors.grey))),
      ],
    ))),
    bottomNavigationBar: NavigationBar(selectedIndex: _index, onDestinationSelected: (i) => setState(() => _index = i), destinations: const [
      NavigationDestination(icon: Icon(Icons.today_outlined), selectedIcon: Icon(Icons.today), label: '今日'),
      NavigationDestination(icon: Icon(Icons.forum_outlined), selectedIcon: Icon(Icons.forum), label: '社区'),
      NavigationDestination(icon: Icon(Icons.support_agent_outlined), selectedIcon: Icon(Icons.support_agent), label: '专业服务'),
      NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: '个人'),
    ]),
  );
}

class _FeatureCard extends StatelessWidget {
  const _FeatureCard({required this.title, required this.description});
  final String title, description;
  @override
  Widget build(BuildContext context) => Card(elevation: 0, color: Colors.white, margin: const EdgeInsets.only(bottom: 14), child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: 8), Text(description, style: TextStyle(color: Colors.grey.shade600)), const SizedBox(height: 12), Text('待接入业务', style: TextStyle(fontSize: 12, color: Colors.grey.shade500))])));
}

class _PersonalTab extends StatelessWidget {
  const _PersonalTab({required this.session});
  final SpineSession session;
  @override
  Widget build(BuildContext context) => Card(elevation: 0, color: Colors.white, child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text('当前账号：${session.user?['username'] ?? ''}', style: Theme.of(context).textTheme.titleMedium),
    if (kDebugMode) TextButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _DiagnosticsPage(api: session.api))), icon: const Icon(Icons.bug_report_outlined), label: const Text('开发连接诊断')),
    const SizedBox(height: 8), FilledButton.tonalIcon(onPressed: () async { try { await session.logout(); } catch (_) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('本机凭据已清除，服务器撤销未确认；请联网后重新登录并退出。'))); } }, icon: const Icon(Icons.logout), label: const Text('退出登录')),
  ])));
}

class _DiagnosticsPage extends StatefulWidget {
  const _DiagnosticsPage({required this.api});
  final SpineApi api;
  @override
  State<_DiagnosticsPage> createState() => _DiagnosticsPageState();
}
class _DiagnosticsPageState extends State<_DiagnosticsPage> {
  String message = '正在检查';
  @override
  void initState() { super.initState(); _check(); }
  Future<void> _check() async { try { final h = await widget.api.health(); if (mounted) setState(() => message = '服务正常 · ${h.timestamp.toLocal()}'); } catch (_) { if (mounted) setState(() => message = '暂时无法连接服务'); } }
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('开发连接诊断')), body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [Text(message), TextButton(onPressed: _check, child: const Text('重新检查'))]))));
}
