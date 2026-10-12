import 'dart:io';
import 'package:spine_app/api.dart';

void check(bool condition, String message) {
  if (!condition) throw StateError(message);
}

Future<void> rejected(Future<Object?> Function() operation, int code) async {
  try {
    await operation();
  } catch (error) {
    check('$error'.contains('HTTP $code'), 'Expected HTTP $code, got $error');
    return;
  }
  throw StateError('Expected HTTP $code, request succeeded');
}

Future<void> main(List<String> args) async {
  final password = Platform.environment['SPINE_VERIFY_PASSWORD'];
  final userA = Platform.environment['SPINE_VERIFY_USER_A'];
  final userB = Platform.environment['SPINE_VERIFY_USER_B'];
  if (password == null || userA == null || userB == null) {
    throw StateError(
      'Run backend/verify_flutter_client.py to create isolated verification users.',
    );
  }
  final base = args.isEmpty ? 'http://127.0.0.1:8000' : args.first;
  final a = SpineApi(baseUrl: base), b = SpineApi(baseUrl: base);
  try {
    await a.health();
    await a.login(userA, password);
    await b.login(userB, password);
    check((await a.me())['username'] == userA, 'Current user mismatch');
    final brace = await a.save('braces', {
      'name': '真实 HTTP 验证支具',
      'brace_type': '测试档案',
    });
    final braceId = brace['id'] as int;
    final wearId = SpineApi.requestId();
    final interval = {
      'brace': braceId,
      'request_id': wearId,
      'started_at': '2026-10-01T23:30:00+08:00',
      'ended_at': '2026-10-02T01:00:00+08:00',
    };
    final wear = await a.save('wear-sessions', interval);
    final duplicate = await a.save('wear-sessions', interval);
    check(wear['id'] == duplicate['id'], 'Duplicate backfill');
    final days = (await a.statistics())['days'] as List;
    check(
      days.singleWhere((d) => d['date'] == '2026-10-01')['minutes'] == 30,
      'First day must be 30 minutes',
    );
    check(
      days.singleWhere((d) => d['date'] == '2026-10-02')['minutes'] == 60,
      'Second day must be 60 minutes',
    );
    await rejected(
      () => a.save('wear-sessions', {
        ...interval,
        'request_id': SpineApi.requestId(),
      }),
      409,
    );
    await rejected(
      () => a.save('wear-sessions', {
        ...interval,
        'request_id': SpineApi.requestId(),
        'ended_at': '2026-10-01T22:00:00+08:00',
      }),
      400,
    );
    final revised = await a.save('wear-sessions', {
      'version': wear['version'],
      'reason': '真实 HTTP 修正验证',
      'ended_at': '2026-10-02T02:00:00+08:00',
    }, id: wear['id'] as int);
    check(revised['version'] == 2, 'Correction version');
    check(
      (await a.revisions(wear['id'] as int)).length == 1,
      'Missing correction history',
    );
    check(
      ((await a.statistics())['days'] as List).singleWhere(
            (d) => d['date'] == '2026-10-02',
          )['minutes'] ==
          120,
      'Statistics not updated',
    );
    final data = {
      'brace': braceId,
      'wear_session': wear['id'],
      'positions': ['腰部'],
      'tags': ['摩擦'],
      'occurred_at': '2026-10-02T00:00:00+08:00',
      'notes': '接口测试，不是真实健康记录',
    };
    final empty = await a.save('comfort-entries', {
      ...data,
      'request_id': SpineApi.requestId(),
      'pain': null,
    });
    final zero = await a.save('comfort-entries', {
      ...data,
      'request_id': SpineApi.requestId(),
      'pain': 0,
    });
    check(
      empty['pain'] == null && zero['pain'] == 0,
      'Null pain must differ from zero',
    );
    check(
      (await b.list('braces')).isEmpty &&
          (await b.list('wear-sessions')).isEmpty &&
          (await b.list('comfort-entries')).isEmpty,
      'Private lists leaked',
    );
    await rejected(() => b.save('braces', {'name': '越权'}, id: braceId), 404);
    await rejected(
      () => b.save('wear-sessions', {
        'version': 2,
        'reason': '越权',
        'notes': '越权',
      }, id: wear['id'] as int),
      404,
    );
    await rejected(
      () => b.save('comfort-entries', {'pain': 10}, id: empty['id'] as int),
      404,
    );
    final startId = SpineApi.requestId();
    final active = await a.startWear(braceId, startId);
    check(
      (await a.startWear(braceId, startId))['id'] == active['id'],
      'Duplicate start',
    );
    check(
      (await a.list(
            'wear-sessions',
          )).where((w) => w['ended_at'] == null).length ==
          1,
      'Active status restore failed',
    );
    await rejected(() => a.startWear(braceId, SpineApi.requestId()), 409);
    final ended = await a.endWear(active['id'] as int);
    check(
      (await a.endWear(active['id'] as int))['ended_at'] == ended['ended_at'],
      'Duplicate end changed time',
    );
    await a.logout();
    await rejected(a.me, 401);
    check(!a.loggedIn, 'Client retained token after logout');
    await b.logout();
    stdout.writeln('Flutter shared SpineApi -> real HTTP -> PostgreSQL: PASS');
    stdout.writeln(
      'Login, ownership, backfill, correction, history, pain null/zero, retry, state restore, Shanghai statistics and logout verified.',
    );
  } finally {
    a.close();
    b.close();
  }
}
