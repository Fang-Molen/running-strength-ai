#!/usr/bin/env python3
"""Supplemental direct-file assertion coverage; does not claim canonical npm PASS."""
import concurrent.futures
import datetime
import glob
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
NODE = Path('/tmp/fangkun-r185-runtime/node-v22.22.0-linux-x64/bin/node')
EVIDENCE = Path('/workspace/fangkun/evidence/r188/domain-direct-final')
EVIDENCE.mkdir(parents=True, exist_ok=True)
PACKAGE = ROOT / 'package.json'
script = json.loads(PACKAGE.read_text())['scripts']['test:domain']
tokens = shlex.split(script)
patterns = [token for token in tokens if '*' in token and '.test.' in token]
files = sorted(set(path for pattern in patterns for path in glob.glob(pattern, root_dir=ROOT)))
if not patterns or not files:
    raise SystemExit('No exact package test:domain files found')

# Root already executed these 33 cases directly while diagnosing the runner.
# Keep it in the exact scope inventory, without re-running or adding its cases here.
reused = {'src/lib/core/coach-r188.test.ts'}
selected = [path for path in files if path not in reused]
credential = re.compile(r'^(?:OPENAI(?:_|$)|ANTHROPIC(?:_|$)|CLAUDE(?:_|$)|XAI(?:_|$)|GEMINI(?:_|$)|GOOGLE_(?:AI|GENAI|API)|GROK_API|AZURE_OPENAI|DATABASE_URL$|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SSLMODE)$|NEON(?:_|$)|SUPABASE(?:_|$)|MODEL(?:_|$)|API_(?:KEY|TOKEN|URL|BASE)|LLM(?:_|$))', re.I)
removed = sorted(key for key in os.environ if credential.match(key))
env = {key: value for key, value in os.environ.items() if key not in removed}
# NODE_OPTIONS can inject unapproved loaders/API setup. The exact command is the
# existing test register loader only; no substitute mocks or test settings.
if 'NODE_OPTIONS' in env:
    removed.append('NODE_OPTIONS')
    env.pop('NODE_OPTIONS')
env['PATH'] = str(NODE.parent) + os.pathsep + env.get('PATH', '')

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

inventory = {
    'canonicalScript': script,
    'packageSha256': sha(PACKAGE),
    'patterns': patterns,
    'exactDomainFileCount': len(files),
    'files': files,
    'selectedFileCount': len(selected),
    'notRepeated': sorted(reused.intersection(files)),
    'notRepeatedReason': 'Root already ran coach-r188.test.ts directly: 33 internal cases; excluded from this supplemental count.',
    'removedEnvironmentVariableNames': sorted(set(removed)),
    'node': str(NODE),
    'nodeSha256': sha(NODE),
    'testRegisterSha256': sha(ROOT / 'scripts/test-register.mjs'),
    'execution': 'Node22 --import ./scripts/test-register.mjs <exact test file>, no --test; concurrency 3; stdout/stderr regular files.',
    'canonicalNpmDomainPassClaimed': False,
}
(EVIDENCE / 'scope.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n')

def run(path):
    safe = path.replace('/', '__')
    stdout_path = EVIDENCE / (safe + '.stdout.log')
    stderr_path = EVIDENCE / (safe + '.stderr.log')
    before = sha(ROOT / path)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    tick = time.monotonic()
    command = [str(NODE), '--import', './scripts/test-register.mjs', path]
    error = None
    with stdout_path.open('wb') as out, stderr_path.open('wb') as err, open(os.devnull, 'rb') as stdin:
        try:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdin=stdin, stdout=out, stderr=err)
            try:
                code = process.wait(timeout=240)
            except subprocess.TimeoutExpired:
                process.kill()
                code = process.wait()
                error = 'TIMEOUT_240_SECONDS'
        except Exception as exc:
            code = None
            error = type(exc).__name__ + ': ' + str(exc)
    text = stdout_path.read_text(errors='replace')
    counts = {}
    for key in ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        hits = re.findall(r'^# ' + key + r' (\d+)\s*$', text, re.MULTILINE)
        counts[key] = int(hits[-1]) if hits else None
    unchanged = before == sha(ROOT / path)
    verdict = 'PASS' if code == 0 and counts['tests'] is not None and counts['fail'] == 0 and counts['cancelled'] == 0 and unchanged and not error else 'FAIL'
    result = {
        'file': path, 'command': command, 'startedAt': started,
        'durationSeconds': round(time.monotonic() - tick, 3), 'exitCode': code,
        'testSha256': before, 'unchangedAfterExecution': unchanged,
        'stdout': str(stdout_path), 'stderr': str(stderr_path),
        'stdoutSha256': sha(stdout_path), 'stderrSha256': sha(stderr_path),
        'tap': counts, 'status': verdict, 'error': error,
    }
    (EVIDENCE / (safe + '.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    return result

print(json.dumps({'event': 'START', 'exactDomainFiles': len(files), 'selectedFiles': len(selected), 'notRepeated': sorted(reused.intersection(files)), 'concurrency': 3}), flush=True)
results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    pending = {pool.submit(run, path): path for path in selected}
    for future in concurrent.futures.as_completed(pending):
        result = future.result()
        results.append(result)
        if result['status'] != 'PASS' or len(results) % 20 == 0 or len(results) == len(selected):
            print(json.dumps({'event': 'PROGRESS', 'completedFiles': len(results), 'totalFiles': len(selected), 'latest': result['file'], 'latestStatus': result['status'], 'latestTap': result['tap']}), flush=True)
        (EVIDENCE / 'progress.json').write_text(json.dumps({'completedFiles': len(results), 'selectedFileCount': len(selected), 'results': sorted(results, key=lambda item: item['file'])}, ensure_ascii=False, indent=2) + '\n')

totals = {key: sum(item['tap'][key] or 0 for item in results) for key in ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo')}
summary = {
    **inventory, 'results': sorted(results, key=lambda item: item['file']),
    'fileCounts': {status: sum(item['status'] == status for item in results) for status in ('PASS', 'FAIL')},
    'tapTotals': totals,
    'filesWithoutInternalTapCounts': [item['file'] for item in results if item['tap']['tests'] is None],
    'canonicalNpmDomainPassClaimed': False,
    'status': 'PASS' if all(item['status'] == 'PASS' for item in results) and len(results) == len(selected) else 'FAIL',
    'scopeNote': 'Supplemental direct-file execution of unchanged domain assertions; canonical npm test:domain remains a separate acceptance result. Previously executed R188 33 cases are not repeated or added to this count.',
}
(EVIDENCE / 'results.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'event': 'COMPLETE', 'status': summary['status'], 'fileCounts': summary['fileCounts'], 'tapTotals': totals, 'canonicalNpmDomainPassClaimed': False}), flush=True)
raise SystemExit(0 if summary['status'] == 'PASS' else 1)
