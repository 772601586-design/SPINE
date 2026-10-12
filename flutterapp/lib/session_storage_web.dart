import 'dart:js_interop';

import 'session_storage.dart';

@JS('window.sessionStorage')
external _SessionStore get _store;

@JS()
@staticInterop
class _SessionStore {}

extension on _SessionStore {
  external JSString? getItem(JSString key);
  external void setItem(JSString key, JSString value);
  external void removeItem(JSString key);
}

class _WebSessionStorage implements SessionStorage {
  static final _key = 'spine.session.token'.toJS;
  @override
  Future<String?> readToken() async => _store.getItem(_key)?.toDart;
  @override
  Future<void> writeToken(String token) async => _store.setItem(_key, token.toJS);
  @override
  Future<void> clearToken() async => _store.removeItem(_key);
}

SessionStorage createSessionStorage() => _WebSessionStorage();
