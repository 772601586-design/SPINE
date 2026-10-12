import 'session_storage_stub.dart'
    if (dart.library.js_interop) 'session_storage_web.dart'
    if (dart.library.io) 'session_storage_mobile.dart' as platform;

abstract interface class SessionStorage {
  Future<String?> readToken();
  Future<void> writeToken(String token);
  Future<void> clearToken();
}

SessionStorage createSessionStorage() => platform.createSessionStorage();
