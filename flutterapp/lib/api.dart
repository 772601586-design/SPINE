import 'dart:convert';
import 'dart:math';
import 'package:http/http.dart' as http;

class Health {
  const Health({required this.service, required this.timestamp});
  final String service;
  final DateTime timestamp;

  factory Health.fromJson(Object? value) {
    if (value is! Map<String, dynamic> ||
        value['status'] != 'ok' ||
        value['service'] != 'spine-backend' ||
        value['api_version'] != 'v1' ||
        value['timestamp'] is! String) {
      throw const FormatException('服务返回了不符合约定的数据');
    }
    return Health(
      service: value['service'] as String,
      timestamp: DateTime.parse(value['timestamp'] as String),
    );
  }
}

class SpineApi {
  SpineApi({String? baseUrl, http.Client? client})
    : _baseUrl =
          baseUrl ??
          const String.fromEnvironment(
            'API_BASE_URL',
            defaultValue: 'http://127.0.0.1:8000',
          ),
      _client = client ?? http.Client();

  final String _baseUrl;
  final http.Client _client;
  String? _token;
  bool get loggedIn => _token != null;
  String? get tokenValue => _token;
  void Function()? onUnauthorized;
  void restoreToken(String token) => _token = token;
  void clearToken() => _token = null;

  static String requestId() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<Object?> _request(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    final uri = Uri.parse('${_baseUrl.replaceFirst(RegExp(r'/$'), '')}$path');
    final request = http.Request(method, uri);
    request.headers['Accept'] = 'application/json';
    if (_token != null) request.headers['Authorization'] = 'Token $_token';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final streamed = await _client
        .send(request)
        .timeout(const Duration(seconds: 10));
    final response = await http.Response.fromStream(
      streamed,
    ).timeout(const Duration(seconds: 10));
    Object? data;
    if (response.bodyBytes.isNotEmpty) {
      try {
        data = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        throw StateError('服务响应无法解析（HTTP ${response.statusCode}）');
      }
    }
    if (response.statusCode >= 400) {
      if (response.statusCode == 401) {
        _token = null;
        onUnauthorized?.call();
      }
      throw StateError(
        'HTTP ${response.statusCode}：${data is Map && data['detail'] != null ? data['detail'] : jsonEncode(data)}',
      );
    }
    return data;
  }

  Future<Map<String, dynamic>> login(String username, String password) async {
    final data =
        await _request('POST', '/api/v1/auth/login/', {
              'username': username,
              'password': password,
            })
            as Map<String, dynamic>;
    _token = data['token'] as String;
    return data['user'] as Map<String, dynamic>;
  }

  Future<void> logout() async {
    await _request('POST', '/api/v1/auth/logout/', {});
    _token = null;
  }

  Future<Map<String, dynamic>> me() async =>
      await _request('GET', '/api/v1/auth/me/') as Map<String, dynamic>;

  Future<List<Map<String, dynamic>>> list(String resource) async =>
      (await _request('GET', '/api/v1/$resource/') as List)
          .cast<Map<String, dynamic>>();

  Future<Map<String, dynamic>> save(
    String resource,
    Map<String, dynamic> body, {
    int? id,
  }) async =>
      await _request(
            id == null ? 'POST' : 'PATCH',
            '/api/v1/$resource/${id == null ? '' : '$id/'}',
            body,
          )
          as Map<String, dynamic>;

  Future<Map<String, dynamic>> startWear(int brace, String requestId) async =>
      await _request('POST', '/api/v1/wear-sessions/start/', {
            'brace': brace,
            'request_id': requestId,
          })
          as Map<String, dynamic>;

  Future<Map<String, dynamic>> endWear(int id) async =>
      await _request('POST', '/api/v1/wear-sessions/$id/end/', {})
          as Map<String, dynamic>;

  Future<Map<String, dynamic>> statistics() async =>
      await _request('GET', '/api/v1/wear-sessions/statistics/')
          as Map<String, dynamic>;

  Future<Map<String, dynamic>> statisticsForBrace(int? braceId) async =>
      await _request('GET', '/api/v1/wear-sessions/statistics/${braceId == null ? '' : '?brace=$braceId'}')
          as Map<String, dynamic>;

  Future<List<Map<String, dynamic>>> followUps(int entryId) async =>
      (await _request('GET', '/api/v1/comfort-follow-ups/?entry=$entryId') as List)
          .cast<Map<String, dynamic>>();

  Future<Map<String, dynamic>> addFollowUp(Map<String, dynamic> body) async =>
      await _request('POST', '/api/v1/comfort-follow-ups/', body)
          as Map<String, dynamic>;

  Future<List<Map<String, dynamic>>> revisions(int id) async =>
      (await _request('GET', '/api/v1/wear-sessions/$id/revisions/') as List)
          .cast<Map<String, dynamic>>();

  Future<Health> health() async {
    final url = Uri.parse(
      '${_baseUrl.replaceFirst(RegExp(r'/$'), '')}/api/v1/health/',
    );
    if (!['http', 'https'].contains(url.scheme) || url.host.isEmpty) {
      throw const FormatException('服务地址必须使用 HTTP 或 HTTPS');
    }
    final response = await _client
        .get(url, headers: {'Accept': 'application/json'})
        .timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) {
      throw StateError('服务返回 HTTP ${response.statusCode}');
    }
    return Health.fromJson(jsonDecode(utf8.decode(response.bodyBytes)));
  }

  void close() => _client.close();
}
