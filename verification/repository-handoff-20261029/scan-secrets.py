"""Scan publishable files, embedded ZIPs and optional reachable Git history.

Reports locations and rule names only, never credential values. Pattern checks
cannot prove the absence of every possible secret; fixtures require review.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--history', action='store_true')
parser.add_argument('--staged', action='store_true')
parser.add_argument('--output', default=str(Path(__file__).with_name('secret-scan.json')))
args = parser.parse_args()
rules = {
    'private-key': rb'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----',
    'github-token': rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b',
    'provider-api-key': rb'\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{24,}\b',
    'google-api-key': rb'\bAIza[0-9A-Za-z_-]{35}\b',
    'aws-access-key': rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'slack-token': rb'\bxox[baprs]-[A-Za-z0-9-]{20,}\b',
    'credential-url': rb'(?i)(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|https?)://[^\s:/"\x27]+:[^\s/@"\x27]{8,}@',
    'literal-credential': rb'(?i)(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[=:]\s*["\x27]([A-Za-z0-9_./+=-]{24,})["\x27]',
}
compiled = {k: re.compile(v) for k, v in rules.items()}
known = [v.encode() for k, v in os.environ.items()
         if re.search(r'(?:API_KEY|TOKEN|SECRET|PASSWORD)$', k) and len(v) >= 16]
findings, count, archives, total = [], 0, 0, 0
reviewed_test_literals = []
seen = set()
def forbidden(path):
    p = PurePosixPath(path)
    return p.name == '.env' or p.name.startswith('.env.') or p.name in ['id_rsa', 'id_ed25519'] or p.suffix in ['.pem', '.key', '.p12', '.pfx']

def inspect(path, data, depth=0):
    global count, archives, total
    if forbidden(path):
        findings.append({'path': path, 'rule': 'forbidden-secret-filename'})
    digest = hashlib.sha256(data).hexdigest()
    if digest in seen:
        return
    seen.add(digest)
    count += 1
    total += len(data)
    for rule, pattern in compiled.items():
        for match in pattern.finditer(data):
            # Clearly named synthetic/example credentials are not real credentials.
            value = match.group(1) if rule == 'literal-credential' else match.group()
            # Historical vision unit test injects this literal into an in-memory
            # env fixture. Reviewed by exact digest, never a broad test-file skip.
            if (rule == 'literal-credential' and path.endswith('src/lib/vision/vision-v73.test.ts')
                    and hashlib.sha256(value).hexdigest() == '797125949c043e12e1071f35082f19a03003d08b7c7138ec13c9e1ceb1cab14a'):
                reviewed_test_literals.append({'path': path, 'rule': rule, 'classification': 'EXPLICIT_FIXTURE_LITERAL'})
                continue
            if re.search(rb'(?i)synthetic|placeholder|example|not[_-]a[_-]real|fake|test[_-](?:key|token|secret)', value):
                continue
            findings.append({'path': path, 'line': data[:match.start()].count(b'\n') + 1, 'rule': rule})
    for value in known:
        if value in data:
            findings.append({'path': path, 'rule': 'matches-attached-credential'})
    if data.startswith(b'PK\x03\x04'):
        if depth >= 3:
            raise RuntimeError('Archive nesting exceeds audit scope: ' + path)
        archives += 1
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            assert archive.testzip() is None, path
            for entry in archive.infolist():
                if not entry.is_dir():
                    inspect(path + '!' + entry.filename, archive.read(entry), depth + 1)

if args.staged:
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')[:-1]
    for path in paths:
        inspect(path, subprocess.check_output(['git', 'show', ':' + path], cwd=ROOT))
else:
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode().split('\0')[:-1]
    for path in sorted(set(paths)):
        p = ROOT / path
        if p.is_file():
            inspect(path, p.read_bytes())

historical_blobs = 0
if args.history:
    rows = subprocess.check_output(['git', 'rev-list', '--objects', 'HEAD'], cwd=ROOT).decode().splitlines()
    for row in rows:
        oid, _, path = row.partition(' ')
        if path and forbidden(path):
            findings.append({'path': 'history:' + oid + ':' + path, 'rule': 'forbidden-secret-filename'})
    proc = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    for row in rows:
        oid, _, path = row.partition(' ')
        proc.stdin.write((oid + '\n').encode()); proc.stdin.flush()
        header = proc.stdout.readline().decode().split()
        if len(header) != 3:
            raise RuntimeError('Cannot audit Git object ' + oid)
        data = proc.stdout.read(int(header[2])); assert proc.stdout.read(1) == b'\n'
        if header[1] == 'blob':
            historical_blobs += 1
            inspect('history:' + oid + ':' + path, data)
    proc.stdin.close(); assert proc.wait() == 0

report = {'status': 'REVIEW_REQUIRED' if findings else 'PASS', 'scope': 'staged' if args.staged else 'working-tree',
          'reachableHistoryScanned': args.history, 'historicalBlobs': historical_blobs,
          'uniqueContentsScanned': count, 'bytesScanned': total, 'archivesScanned': archives,
          'reviewedTestLiterals': reviewed_test_literals,
          'rules': list(rules), 'findings': findings, 'limitation': 'Pattern and attached-value checks; not proof against all secret formats.'}
Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'rules'}, ensure_ascii=False))
raise SystemExit(1 if findings else 0)
