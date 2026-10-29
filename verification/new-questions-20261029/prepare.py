"""Validate the supplied synthetic campaign; never calls a model or reads credentials."""
import csv
import hashlib
import json
from collections import Counter
from decimal import Decimal
from pathlib import Path

OUT = Path(__file__).resolve().parent
SOURCE = OUT / 'input-package'

def dump(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

manifest = json.loads((SOURCE / 'MANIFEST.json').read_text())
verified = []
for name, expected in manifest.items():
    data = (SOURCE / name).read_bytes()
    assert len(data) == expected['bytes'], name
    assert hashlib.sha256(data).hexdigest() == expected['sha256'], name
    verified.append(name)

def rows(name):
    return [json.loads(line) for line in (SOURCE / name).read_text().splitlines() if line.strip()]

paths = rows('01_方坤输入_32路径.jsonl')
history = rows('03_合成历史_245条.jsonl')
assert len(paths) == 32 and len({p['path_id'] for p in paths}) == 32
assert sum(len(p['messages']) for p in paths) == 34
assert all(m['role'] == 'user' and m['content'].strip() for p in paths for m in p['messages'])
assert Counter(p['case_id'] for p in paths) == Counter({f'Q{i:02d}': 2 for i in range(1, 17)})
assert all(len(p['messages']) == (2 if p['case_id'] == 'Q11' else 1) for p in paths)
assert len(history) == 245 and len({(r['athlete'], r['id']) for r in history}) == 245
assert Counter(r['athlete'] for r in history) == Counter({'SYN-A': 244, 'SYN-B': 1})
year = [r for r in history if r['athlete'] == 'SYN-A' and r['day'].startswith('2025-') and r['kind'] in ['run', 'easy_run']]
assert len(year) == 183
assert sum(Decimal(str(r['distance_km'])) for r in year) == Decimal(915)
recent = [r for r in history if r['athlete'] == 'SYN-A' and '2026-10-25' <= r['day'] <= '2026-10-29' and r['kind'] == 'run']
assert sum(Decimal(str(r['distance_km'])) for r in recent) == Decimal(10)
assert [Decimal(str(r['minutes'])) * 60 / Decimal(str(r['distance_km'])) for r in recent] == [Decimal(300), Decimal(324)]

# This file contains only authorized questions, never the scoring references.
# Messages must be sent one at a time; Q11 turn two is not visible before turn one completes.
schedule = []
for p in paths:
    for turn, message in enumerate(p['messages'], 1):
        schedule.append({'case_id': p['case_id'], 'path_id': p['path_id'], 'turn': turn,
                         'kind': 'USER_DIALOGUE', 'mode': p['path_id'][-1], 'question': message['content']})
questions = [
    ('T01', '2025年我已记录了多少公里？数据能证明全年每次训练都记录齐了吗？'),
    ('T02', '根据我最近的跑步和身体反馈，今天恢复得怎么样？给我最值得关注的一点。'),
    ('T03', '10月25日至29日我已记录了多少公里？前后两次跑步哪次更快？有没有需要留意的身体反馈？'),
]
for index, (case, question) in enumerate(questions):
    for mode in (['ALL_HISTORY', 'CURRENT_SELECTION'] if index % 2 == 0 else ['CURRENT_SELECTION', 'ALL_HISTORY']):
        schedule.append({'case_id': case, 'path_id': case + '-' + mode, 'turn': 1,
                         'kind': 'ISOLATED_STORED_HISTORY', 'mode': mode, 'question': question})
dump('dispatch-order.json', {'asOf': '2026-10-29T12:00:00Z', 'timeZone': 'Asia/Shanghai',
                            'comparison': 'TEST_MODE_COMPARISON_NOT_OLD_APP', 'schedule': schedule})
dump('package-validation.json', {'status': 'PASS', 'scope': 'PACKAGE_ONLY_NOT_APP_OR_MODEL',
                               'verifiedFiles': verified, 'manifest': manifest,
                               'paths': 32, 'dialogueTurns': 34, 'historyConversations': 6,
                               'historyRows': 245, 'ownerRows': {'SYN-A': 244, 'SYN-B': 1},
                               'year2025Runs': 183, 'year2025RecordedKm': 915,
                               'recentRecordedKm': 10, 'recentPaceSecondsPerKm': [300, 324],
                               'providerCalls': 0, 'cost': 0})
# Preserve actual campaign results if this preparation is rerun.
if not (OUT / 'RESULTS.jsonl').exists():
    with (OUT / 'RESULTS.jsonl').open('w') as f:
        for item in schedule:
            result = {**item, 'status': 'NOT_RUN', 'provider': 'NONE', 'answer': None, 'scores': None,
                      'reason': 'Awaiting API configuration and completion of isolated App test adapter',
                      'sourcePackageSha256': 'c2e48f72eb8704643be2d8a482c3b6422eb0dc30e3a40609719584da24581229'}
            f.write(json.dumps(result, ensure_ascii=False) + '\n')
if not (OUT / 'TOKEN.csv').exists():
    with (OUT / 'TOKEN.csv').open('w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['row_type', 'path_id', 'status', 'request_count', 'prompt_tokens', 'completion_tokens',
                         'total_tokens', 'cache_hit_tokens', 'cache_miss_tokens', 'reasoning_tokens', 'billed_cost'])
        for path in dict.fromkeys(item['path_id'] for item in schedule):
            writer.writerow(['conversation', path, 'NOT_RUN', 0, *(['NA'] * 7)])
print(json.dumps({'validated': True, 'paths': 32, 'dialogueTurns': 34, 'historySessions': 6,
                  'modelCalls': 0, 'resultsPreservedOnRerun': True}))
