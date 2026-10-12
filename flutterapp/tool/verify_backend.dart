import 'package:spine_app/api.dart';

Future<void> main(List<String> arguments) async {
  final api = SpineApi(
    baseUrl: arguments.isEmpty ? 'http://127.0.0.1:8000' : arguments.first,
  );
  try {
    final health = await api.health();
    print(
      'flutterapp: ${health.service} ${health.timestamp.toIso8601String()}',
    );
  } finally {
    api.close();
  }
}
