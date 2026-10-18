#!/usr/bin/env python3
"""Generate review manifests; create small, independent ZIPs only after final receipts."""
from __future__ import annotations
import argparse
import csv
import difflib
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

SOURCE = Path('/workspace/fangkun/r188-candidate/source')
BASELINE = Path('/workspace/fangkun/r185-candidate/source')
INTAKE = Path('/workspace/fangkun/intake/r188-audit')
EVIDENCE = Path('/workspace/fangkun/evidence/r188')
ROLLBACK = Path('/workspace/fangkun/rollback/r185-before-r188.zip')
DOCS = SOURCE / 'docs/r188-repair'
SKIP_DIRS = {'.git', 'node_modules', '.output', '.vercel', '.nitro', 'dist', 'coverage', '.cache', '.vite', 'test-results', 'playwright-report', '__pycache__'}
GENERATED = {'diff-from-R185.json', 'diff-from-R185.patch', 'modified-files.csv', 'source-manifest.json', 'delta-provenance.json', 'R185-preservation.json'}
MAX_BYTES = 8_000_000

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def files(root: Path, exclude_generated=False):
    found = {}
    for p in sorted(root.rglob('*')):
        rel = p.relative_to(root)
        if not p.is_file() or p.is_symlink() or any(part in SKIP_DIRS for part in rel.parts):
            continue
        if p.name == '.env' or p.name.startswith('.env.') or p.suffix in {'.zip', '.pyc'}:
            continue
        if exclude_generated and rel.parent.as_posix() == 'docs/r188-repair' and p.name in GENERATED:
            continue
        found[rel.as_posix()] = p
    return found

def refresh_manifests():
    old, new = files(BASELINE, True), files(SOURCE, True)
    rows, patches = [], []
    for rel in sorted(set(old) | set(new)):
        a, b = old.get(rel), new.get(rel)
        old_sha, new_sha = sha(a) if a else None, sha(b) if b else None
        if old_sha == new_sha:
            continue
        rows.append({'file': rel, 'change': 'ADDED' if a is None else 'DELETED' if b is None else 'MODIFIED', 'baseline_sha256': old_sha, 'candidate_sha256': new_sha})
        try:
            left = a.read_text(encoding='utf-8').splitlines(keepends=True) if a else []
            right = b.read_text(encoding='utf-8').splitlines(keepends=True) if b else []
            patches.extend(difflib.unified_diff(left, right, fromfile='R185/' + rel if a else '/dev/null', tofile='R188/' + rel if b else '/dev/null'))
        except UnicodeDecodeError:
            patches.append(f'Binary file: {rel}; old SHA256={old_sha}; new SHA256={new_sha}\n')
    write_json(DOCS / 'diff-from-R185.json', rows)
    (DOCS / 'diff-from-R185.patch').write_text(''.join(patches), encoding='utf-8')
    with (DOCS / 'modified-files.csv').open('w', encoding='utf-8-sig', newline='') as out:
        writer = csv.DictWriter(out, fieldnames=['file', 'change', 'baseline_sha256', 'candidate_sha256'])
        writer.writeheader()
        writer.writerows(rows)
    manifest = json.loads((INTAKE / 'audit/MERGE_MANIFEST.json').read_text())
    provenance = []
    for rel, original in sorted(manifest['added_code_and_test_files'].items()):
        src, final = INTAKE / 'delta' / rel, SOURCE / rel
        provenance.append({'file': rel, 'intake_sha256': sha(src), 'intake_matches_declared_sha256': sha(src) == original['sha256'], 'R185_file_existed': (BASELINE / rel).exists(), 'final_sha256': sha(final) if final.exists() else None, 'integration_action': 'COPIED_UNCHANGED' if final.exists() and sha(src) == sha(final) else 'ADAPTED_ON_R185' if final.exists() else 'MISSING'})
    write_json(DOCS / 'delta-provenance.json', {'source_archive_sha256': json.loads((INTAKE / 'intake-manifest.json').read_text())['sha256'], 'audit_archive_baseline': 'R184 phase2; not used as source overwrite', 'delta_count': len(provenance), 'files': provenance})
    critical = ['src/lib/core/coach-periodic-observations.ts', 'src/lib/core/coach-quantitative-adapter.ts', 'src/lib/core/coach-r185-p0.test.ts', 'src/lib/core/coach-quantitative.ts']
    preserved = [{'file': rel, 'preserved': (SOURCE / rel).exists() and sha(BASELINE / rel) == sha(SOURCE / rel), 'baseline_sha256': sha(BASELINE / rel), 'candidate_sha256': sha(SOURCE / rel) if (SOURCE / rel).exists() else None} for rel in critical]
    write_json(DOCS / 'R185-preservation.json', preserved)
    if not all(r['preserved'] for r in preserved):
        raise SystemExit('R185 critical file differs; review required before packaging.')
    inventory = files(SOURCE)
    inventory.pop('docs/r188-repair/source-manifest.json', None)
    write_json(DOCS / 'source-manifest.json', {'schemaVersion': 1, 'self_manifest_excluded': True, 'files': [{'file': rel, 'bytes': p.stat().st_size, 'sha256': sha(p)} for rel, p in inventory.items()]})
    return rows

def create_zip(path: Path, entries):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, p in entries:
            z.write(p, name)
    with zipfile.ZipFile(path) as z:
        if z.testzip() is not None:
            raise SystemExit(f'ZIP CRC check failed: {path.name}')
    if path.stat().st_size >= MAX_BYTES:
        path.unlink()
        raise SystemExit(f'{path.name} exceeds the independent ZIP size limit; do not deliver a failed oversized archive.')
    return {'file': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path), 'CRC': 'PASS', 'entries': len(entries)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', action='store_true', help='Requires explicitly finalized results with actual receipts or blocker reasons; failures remain failures.')
    parser.add_argument('--output', type=Path, default=Path('/workspace/fangkun/delivery-r188'))
    args = parser.parse_args()
    if args.package:
        results = json.loads((DOCS / '验收结果.json').read_text())
        gates = ['final_full_regression', 'canonical_domain', 'typecheck', 'build', 'browser_offline']
        def terminal_receipt(gate):
            gate = results.get(gate, {})
            status = gate.get('status')
            if status in {'PASS', 'FAIL'}:
                return bool(gate.get('evidence'))
            if status in {'BLOCKED', 'SKIP'}:
                return bool(gate.get('evidence') or gate.get('reason'))
            return False
        if not results.get('final_receipts_recorded') or not all(terminal_receipt(g) for g in gates):
            raise SystemExit('Final local results lack terminal receipts or blocker reasons; PENDING/RUNNING cannot be packaged as final. FAIL/BLOCKED/SKIP remain their honest declared status.')
    rows = refresh_manifests()
    if not args.package:
        print(json.dumps({'mode': 'MANIFEST_ONLY', 'changed_files': len(rows), 'packaged': False}))
        return
    args.output.mkdir(parents=True, exist_ok=True)
    outputs = []
    inventory = files(SOURCE)
    outputs.append(create_zip(args.output / 'fangkun-r188-source.zip', [('source/' + rel, p) for rel, p in inventory.items()]))
    delta = [('source/' + r['file'], SOURCE / r['file']) for r in rows if r['change'] != 'DELETED']
    delta += [('source/docs/r188-repair/' + name, DOCS / name) for name in sorted(GENERATED) if (DOCS / name).exists()]
    outputs.append(create_zip(args.output / 'fangkun-r188-delta.zip', delta))
    evidence = [('evidence/' + rel, p) for rel, p in files(EVIDENCE).items()]
    evidence += [('docs/' + rel, p) for rel, p in files(DOCS).items()]
    for screenshots in [Path('/workspace/screenshots/fangkun-r188'), Path('/workspace/screenshots/fangkun-r188-final')]:
        if screenshots.exists():
            evidence += [('screenshots/' + screenshots.name + '/' + rel, p) for rel, p in files(screenshots).items()]
    outputs.append(create_zip(args.output / 'fangkun-r188-evidence.zip', evidence))
    rollback_dest = args.output / 'fangkun-r188-rollback-r185.zip'
    shutil.copyfile(ROLLBACK, rollback_dest)
    with zipfile.ZipFile(rollback_dest) as z:
        if z.testzip() is not None:
            raise SystemExit('Rollback CRC failed')
        rollback_entries = len(z.infolist())
    if rollback_dest.stat().st_size >= MAX_BYTES or sha(rollback_dest) != '4a7af94aae8b64793b1fd2b9504cdd8b2f53a4a3ca351f8fa32f11fb34c28c99':
        raise SystemExit('Rollback differs from the delivered R185 source or exceeds the ZIP size limit.')
    outputs.append({'file': rollback_dest.name, 'bytes': rollback_dest.stat().st_size, 'sha256': sha(rollback_dest), 'CRC': 'PASS', 'entries': rollback_entries})
    write_json(args.output / 'package-checksums.json', {'independent_zip_packages': True, 'size_limit_bytes': MAX_BYTES, 'packages': outputs})
    print(json.dumps(outputs, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
