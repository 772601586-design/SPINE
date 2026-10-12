import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:spine_app/api.dart';
import 'package:spine_app/main.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('four entries and a real backend health call', (tester) async {
    final api = SpineApi();
    addTearDown(api.close);
    final health = await api.health();
    expect(health.service, 'spine-backend');
    await tester.pumpWidget(const SpineApp());
    await tester.pumpAndSettle();
    for (final label in ['今日', '社区', '专业服务', '个人']) {
      expect(find.text(label), findsWidgets);
    }
    await tester.tap(find.text('社区').last);
    await tester.pumpAndSettle();
    expect(find.text('康复日记'), findsOneWidget);
    await tester.tap(find.text('专业服务').last);
    await tester.pumpAndSettle();
    expect(find.text('已关联人员'), findsOneWidget);
    await tester.tap(find.text('个人').last);
    await tester.pumpAndSettle();
    expect(find.text('健康档案'), findsOneWidget);
  });
}
