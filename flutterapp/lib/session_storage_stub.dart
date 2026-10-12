import 'session_storage.dart';

SessionStorage createSessionStorage() => _MemorySessionStorage();

class _MemorySessionStorage implements SessionStorage {
  String? value;
  @override
  Future<String?> readToken() async => value;
  @override
  Future<void> writeToken(String token) async { value = token; }
  @override
  Future<void> clearToken() async { value = null; }
}
