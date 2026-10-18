"""Fixed final verification sequence; no model endpoint, deployment or stdin commands."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

root = Path('/workspace/fangkun/evidence/r11')
arguments = argparse.ArgumentParser()
arguments.add_argument('--reuse-installed-dependencies', action='store_true', help='Reuse a successful npm ci only when the recorded dependency hashes still match.')
args = arguments.parse_args()
dependency_hashes = lambda: {name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in ('package.json', 'package-lock.json')}
env = os.environ.copy()
env['npm_config_cache'] = '/tmp/fangkun-npm-cache'
env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] = '/usr/bin/chromium'
env['BROWSER_SMOKE_TIMEOUT_MS'] = '120000'
env['BROWSER_SMOKE_ABSENT_TEXT'] = '读取中'
operations = [
    ('npm-ci', ['npm', 'ci']),
    ('strict', ['npx', '--no-install', 'tsc', '--noEmit', '--strict']),
    ('test', ['npm', 'test']),
    ('domain', ['npm', 'run', 'test:domain']),
    ('build', ['npm', 'run', 'build']),
    ('evals', ['npm', 'run', 'eval:local']),
    ('metrics', ['node', '--import', './scripts/test-register.mjs', 'evaluation/r11/metrics.ts']),
    ('browser', ['node', 'evaluation/r11/browser-e2e.mjs']),
    ('smoke-dev', ['node', 'scripts/browser-smoke.mjs', 'http://127.0.0.1:8080/', '/workspace/screenshots/fangkun-r11/dev.png']),
    ('preview', ['npm', 'run', 'preview:restart']),
    ('smoke-prod', ['node', 'scripts/browser-smoke.mjs', 'http://127.0.0.1:8081/', '/workspace/screenshots/fangkun-r11/production.png', '--baseline', '/workspace/screenshots/fangkun-r11/dev.json']),
]
if args.reuse_installed_dependencies:
    installed = json.loads((root / 'npm-ci.status.json').read_text())
    if installed.get('exitCode') != 0 or installed.get('dependencyFileSHA256') != dependency_hashes() or not Path('node_modules/.package-lock.json').is_file():
        raise SystemExit('Cannot reuse npm ci: successful installation and unchanged dependency files are required')
    operations = [operation for operation in operations if operation[0] != 'npm-ci']
    print('REUSE successful npm-ci; package and lockfile hashes match', flush=True)
def run_operation(operation):
    name, command = operation
    for suffix in ['.log', '.status.json']:
        previous = root / (name + suffix)
        if previous.exists():
            previous.rename(root / (name + '-prior-' + datetime.datetime.now().strftime('%H%M%S') + suffix))
    print('START ' + name, flush=True)
    started = datetime.datetime.now(datetime.timezone.utc)
    with (root / (name + '.log')).open('w') as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, env=env)
    status = {'command': command, 'exitCode': result.returncode, 'startedAt': started.isoformat(), 'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if name == 'npm-ci' and result.returncode == 0:
        status['dependencyFileSHA256'] = dependency_hashes()
    (root / (name + '.status.json')).write_text(json.dumps(status))
    print('FINISHED ' + name + ' ' + str(result.returncode), flush=True)
    return name if result.returncode else None

failed = []
for operation in operations:
    if operation[0] == 'domain':
        continue  # Independent suites run together; their logs/statuses remain separate.
    if operation[0] == 'test':
        suites = [operation, next(item for item in operations if item[0] == 'domain')]
        with ThreadPoolExecutor(max_workers=2) as pool:
            failed.extend(name for name in pool.map(run_operation, suites) if name)
    else:
        failure = run_operation(operation)
        if failure:
            failed.append(failure)
if failed:
    raise SystemExit('FAILED: ' + ', '.join(failed))
