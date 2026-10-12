import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'session_storage.dart';

class _MobileSessionStorage implements SessionStorage {
  static const _key = 'spine.session.token';
  static const _storage = FlutterSecureStorage();
  @override
  Future<String?> readToken() => _storage.read(key: _key);
  @override
  Future<void> writeToken(String token) => _storage.write(key: _key, value: token);
  @override
  Future<void> clearToken() => _storage.delete(key: _key);
}

SessionStorage createSessionStorage() => _MobileSessionStorage();
