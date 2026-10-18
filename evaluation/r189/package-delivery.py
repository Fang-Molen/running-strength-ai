#!/usr/bin/env python3
"""Prepare manifests, then package only explicit final local-test receipts.

This tool does not run program tests, contact APIs, deploy, or change training data.
"""
from __future__ import annotations

import argparse
import csv
import difflib
import hashlib
import json
import shutil
import tempfile
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2]
DOCS = SOURCE / 'docs/r189-delivery'
BASELINE = Path('/workspace/fangkun/rollback-r189/r188-source-before-r189.zip')
BASELINE_META = BASELINE.parent / 'baseline.json'
EVIDENCE = Path('/workspace/fangkun/evidence/r189')
SCREENSHOTS = Path('/workspace/screenshots/fangkun-r189')
INTAKE = Path('/workspace/fangkun/intake/codex-docs-motion-20261015/intake.json')
MAX_BYTES = 8_000_000
SKIP_DIRS = {'.git', 'node_modules', '.output', '.vercel', '.nitro', 'dist', 'coverage',
             '.cache', '.vite', 'test-results', 'playwright-report', '__pycache__',
             'private', 'private-r185', '.aws', '.codex'}
PRIVATE_SUFFIXES = {'.fit', '.tcx', '.gpx', '.har', '.zip', '.pyc'}
GENERATED = {'diff-from-R188.json', 'diff-from-R188.patch', 'modified-files.csv',
             'source-manifest.json', 'prepared-manifest.json', 'runtime-manifest.json'}
GATES = ('final_full_regression', 'canonical_domain', 'typecheck', 'build',
         'browser_offline', 'browser_motion')


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha(path: Path) -> str:
    return digest(path.read_bytes())


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def included(rel: Path, generated=True) -> bool:
    if any(part in SKIP_DIRS or part.startswith('private-') for part in rel.parts):
        return False
    if rel.name == '.env' or rel.name.startswith('.env.') or rel.suffix.lower() in PRIVATE_SUFFIXES:
        return False
    if not generated and rel.parent.as_posix() == 'docs/r189-delivery' and rel.name in GENERATED:
        return False
    return True


def files(root: Path, generated=True, evidence=False) -> dict[str, Path]:
    found = {}
    if not root.exists():
        return found
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if not path.is_file() or path.is_symlink() or not included(rel, generated):
            continue
        # Test backups can contain an entire local store; ship assertions and logs,
        # not browser storage dumps, even when the scenario is synthetic.
        if evidence and (path.name.startswith('synthetic-backup-') or path.suffix.lower() in {'.csv', '.sqlite', '.db'}):
            continue
        found[rel.as_posix()] = path
    return found


def file_record(rel: str, data: bytes) -> dict:
    return {'file': rel, 'bytes': len(data), 'sha256': digest(data),
            'crc32': f'{zlib.crc32(data) & 0xffffffff:08x}'}


def runtime_manifest() -> dict:
    records = []
    for rel, path in files(SOURCE).items():
        parts = Path(rel).parts
        if parts[0] in {'src', 'public', 'server', 'scripts', 'migrations', '.grok'} or (
            len(parts) == 1 and (rel in {'package.json', 'package-lock.json'} or rel.startswith(('tsconfig', 'vite.config')))
        ):
            records.append(file_record(rel, path.read_bytes()))
    # Includes runtime sources, tests in src/scripts, assets, dependencies and build config.
    fingerprint = digest(json.dumps(records, sort_keys=True, separators=(',', ':')).encode())
    return {'schema_version': 1, 'fingerprint_sha256': fingerprint, 'files': records,
            'note': 'docs/evaluation are excluded so final receipts and packaging documents can be added after execution.'}


def baseline_files() -> tuple[dict[str, bytes], dict]:
    meta = json.loads(BASELINE_META.read_text())
    actual = sha(BASELINE)
    if actual != meta['sha256']:
        raise SystemExit('Rollback SHA256 differs from baseline.json; packaging stopped.')
    with zipfile.ZipFile(BASELINE) as archive:
        bad = archive.testzip()
        if bad:
            raise SystemExit(f'Rollback CRC failed: {bad}')
        old = {}
        for item in archive.infolist():
            if item.is_dir():
                continue
            if not item.filename.startswith('source/'):
                raise SystemExit(f'Unexpected rollback root: {item.filename}')
            rel = Path(item.filename.removeprefix('source/'))
            if rel.is_absolute() or '..' in rel.parts:
                raise SystemExit('Unsafe rollback entry.')
            if included(rel, False):
                old[rel.as_posix()] = archive.read(item)
    return old, {'file': BASELINE.name, 'bytes': BASELINE.stat().st_size,
                 'sha256': actual, 'zip_crc': 'PASS', 'entry_count': len(old)}


def prepare() -> dict:
    DOCS.mkdir(parents=True, exist_ok=True)
    old, baseline = baseline_files()
    new = files(SOURCE, generated=False)
    changes, patch = [], []
    for rel in sorted(set(old) | set(new)):
        before = old.get(rel)
        after = new[rel].read_bytes() if rel in new else None
        old_sha = digest(before) if before is not None else None
        new_sha = digest(after) if after is not None else None
        if old_sha == new_sha:
            continue
        changes.append({'file': rel,
                        'change': 'ADDED' if before is None else 'DELETED' if after is None else 'MODIFIED',
                        'baseline_sha256': old_sha, 'candidate_sha256': new_sha})
        try:
            left = before.decode('utf-8').splitlines(keepends=True) if before is not None else []
            right = after.decode('utf-8').splitlines(keepends=True) if after is not None else []
            if b'\x00' in (before or b'') or b'\x00' in (after or b''):
                raise UnicodeError('binary')
            patch.extend(difflib.unified_diff(left, right, fromfile='R188/' + rel if before is not None else '/dev/null',
                                             tofile='R189/' + rel if after is not None else '/dev/null'))
        except UnicodeError:
            patch.append(f'Binary file {rel}: old SHA256={old_sha}; new SHA256={new_sha}\n')
    write_json(DOCS / 'diff-from-R188.json', {'baseline': baseline, 'changes': changes,
               'generated_delivery_artifacts_excluded': sorted(GENERATED)})
    (DOCS / 'diff-from-R188.patch').write_text(''.join(patch), encoding='utf-8')
    with (DOCS / 'modified-files.csv').open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=['file', 'change', 'baseline_sha256', 'candidate_sha256'])
        writer.writeheader()
        writer.writerows(changes)
    runtime = runtime_manifest()
    write_json(DOCS / 'runtime-manifest.json', runtime)
    prepared = {'mode': 'PREPARED_NOT_FINAL', 'created_at_utc': datetime.now(timezone.utc).isoformat(),
                'baseline': baseline, 'changed_file_count': len(changes),
                'runtime_fingerprint_sha256': runtime['fingerprint_sha256'],
                'intake': json.loads(INTAKE.read_text()) if INTAKE.exists() else [],
                'historical_reports': 'Reports outside docs/r189-delivery and evidence/r189 remain historical; not current PASS evidence.',
                'source_package_excludes': ['public/demo3d (separate assets package)', 'node_modules', 'build output',
                                            '.env*', 'raw FIT/TCX/GPX', 'browser storage dumps', 'private directories'],
                'final_results_not_inferred': True, 'max_independent_zip_bytes': MAX_BYTES}
    write_json(DOCS / 'prepared-manifest.json', prepared)
    inventory = files(SOURCE)
    inventory.pop('docs/r189-delivery/source-manifest.json', None)
    write_json(DOCS / 'source-manifest.json', {'schema_version': 1, 'self_manifest_excluded': True,
               'files': [file_record(rel, path.read_bytes()) for rel, path in inventory.items()]})
    return prepared


def checked_receipts(path: Path) -> dict:
    receipts = json.loads(path.read_text())
    if not receipts.get('final_receipts_recorded') or not receipts.get('privacy_reviewed'):
        raise SystemExit('Final receipts and privacy review must be explicitly recorded before packaging.')
    current = runtime_manifest()['fingerprint_sha256']
    if receipts.get('runtime_fingerprint_sha256') != current:
        raise SystemExit('Runtime/test source differs from final receipt fingerprint; do not package stale results.')
    seen_nonpass = False
    for name in GATES:
        gate = receipts.get(name, {})
        status = gate.get('status')
        if status not in {'PASS', 'FAIL', 'SKIP', 'BLOCKED'}:
            raise SystemExit(f'{name} is not terminal; PENDING/RUNNING cannot become a final report.')
        seen_nonpass |= status != 'PASS'
        refs = gate.get('evidence', [])
        if isinstance(refs, str):
            refs = [refs]
        if status in {'PASS', 'FAIL'} and not refs:
            raise SystemExit(f'{name} lacks actual execution evidence.')
        if status in {'SKIP', 'BLOCKED'} and not gate.get('reason'):
            raise SystemExit(f'{name} must explain its unexecuted or blocked scope.')
        for ref in refs:
            evidence_path = Path(ref)
            if not evidence_path.is_absolute():
                evidence_path = EVIDENCE / ref
            evidence_path = evidence_path.resolve()
            if not evidence_path.is_file() or not evidence_path.is_relative_to(EVIDENCE.resolve()):
                raise SystemExit(f'{name} evidence must be an existing file inside evidence/r189: {ref}')
        counts = gate.get('counts')
        if counts is not None:
            if not all(isinstance(counts.get(k), int) and counts[k] >= 0 for k in ('pass', 'fail', 'skip')):
                raise SystemExit(f'{name} counts must use explicit nonnegative pass/fail/skip integers.')
            if status == 'PASS' and counts['fail']:
                raise SystemExit(f'{name} declares PASS with failed cases.')
    if seen_nonpass and receipts.get('overall_status') == 'PASS':
        raise SystemExit('A non-PASS required gate cannot be labelled overall PASS.')
    if not receipts.get('overall_status') or not receipts.get('report_finalized'):
        raise SystemExit('Overall outcome and finalized report must be explicit.')
    if not (DOCS / '交付报告.md').exists():
        raise SystemExit('Final Chinese delivery report is missing.')
    return receipts


def zip_once(path: Path, entries: list[tuple[str, Path]]) -> dict:
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, source in entries:
            archive.write(source, name)
    with zipfile.ZipFile(path) as archive:
        bad = archive.testzip()
        if bad:
            raise SystemExit(f'ZIP CRC failure: {path.name}/{bad}')
    return {'file': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path),
            'zip_crc': 'PASS', 'entry_count': len(entries)}


def zip_parts(output: Path, stem: str, entries: list[tuple[str, Path]]) -> list[dict]:
    """Make ordinary independent ZIPs, never fragile binary split volumes."""
    if not entries:
        return []
    with tempfile.TemporaryDirectory(prefix='r189-zip-', dir=output) as tmp:
        path = Path(tmp) / f'{stem}.zip'
        result = zip_once(path, entries)
        if result['bytes'] < MAX_BYTES:
            shutil.move(path, output / path.name)
            return [result]
        with zipfile.ZipFile(path) as archive:
            sizes = {item.filename: item.compress_size + 2 * len(item.filename.encode()) + 160
                     for item in archive.infolist()}
        bins, bucket, size = [], [], 4096
        for entry in entries:
            amount = sizes[entry[0]]
            if amount + 4096 >= MAX_BYTES:
                raise SystemExit(f'Single file cannot fit in an independent 8 MB ZIP: {entry[0]}')
            if bucket and size + amount >= MAX_BYTES:
                bins.append(bucket)
                bucket, size = [], 4096
            bucket.append(entry)
            size += amount
        if bucket:
            bins.append(bucket)
        results = []
        for index, group in enumerate(bins, 1):
            part = Path(tmp) / f'{stem}-{index:02d}.zip'
            item = zip_once(part, group)
            if item['bytes'] >= MAX_BYTES:
                raise SystemExit(f'Independent ZIP exceeds limit: {part.name}')
            shutil.move(part, output / part.name)
            results.append(item)
        return results


def package(output: Path, receipts_path: Path) -> list[dict]:
    receipts = checked_receipts(receipts_path)
    # Preserve exactly reviewed receipts beside the report in the source tree.
    if receipts_path.resolve() != (DOCS / '验收结果.json').resolve():
        shutil.copyfile(receipts_path, DOCS / '验收结果.json')
    prepare()
    if output.exists() and any(output.iterdir()):
        raise SystemExit('Output directory is not empty; use a fresh directory to avoid mixing stale packages.')
    output.mkdir(parents=True, exist_ok=True)
    inventory = files(SOURCE)
    main = [('source/' + rel, path) for rel, path in inventory.items() if not rel.startswith('public/demo3d/')]
    assets = [('source/' + rel, path) for rel, path in inventory.items() if rel.startswith('public/demo3d/')]
    evidence = [('evidence/r189/' + rel, path) for rel, path in files(EVIDENCE, evidence=True).items()]
    evidence += [('docs/r189-delivery/' + rel, path) for rel, path in files(DOCS).items()]
    shots = [('screenshots/fangkun-r189/' + rel, path) for rel, path in files(SCREENSHOTS, evidence=True).items()]
    outputs = zip_parts(output, 'fangkun-r189-source', main)
    outputs += zip_parts(output, 'fangkun-r189-demo3d', assets)
    outputs += zip_parts(output, 'fangkun-r189-evidence', evidence)
    outputs += zip_parts(output, 'fangkun-r189-screenshots', shots)
    rollback = output / 'fangkun-r189-rollback-r188.zip'
    shutil.copyfile(BASELINE, rollback)
    if sha(rollback) != json.loads(BASELINE_META.read_text())['sha256'] or rollback.stat().st_size >= MAX_BYTES:
        raise SystemExit('Copied rollback hash/size check failed.')
    with zipfile.ZipFile(rollback) as archive:
        if archive.testzip():
            raise SystemExit('Copied rollback CRC failed.')
        count = len(archive.infolist())
    outputs.append({'file': rollback.name, 'bytes': rollback.stat().st_size, 'sha256': sha(rollback),
                    'zip_crc': 'PASS', 'entry_count': count})
    # Check the delivered logical source tree against the final candidate, not just ZIP readability.
    delivered = {}
    for item in outputs:
        if item['file'].startswith(('fangkun-r189-source', 'fangkun-r189-demo3d')):
            with zipfile.ZipFile(output / item['file']) as archive:
                for info in archive.infolist():
                    if info.filename in delivered:
                        raise SystemExit(f'Duplicate logical source entry: {info.filename}')
                    delivered[info.filename] = digest(archive.read(info))
    expected = {'source/' + rel: sha(path) for rel, path in inventory.items()}
    if delivered != expected:
        raise SystemExit('Combined source/assets ZIP contents do not reconstruct the candidate.')
    for name in ['交付报告.md', '验收结果.json', '使用说明.txt', 'modified-files.csv']:
        shutil.copyfile(DOCS / name, output / name)
    write_json(output / 'package-checksums.json', {'schema_version': 1, 'independent_zip_packages': True,
               'max_zip_bytes': MAX_BYTES, 'combined_source_reconstruction': 'PASS',
               'runtime_fingerprint_sha256': receipts['runtime_fingerprint_sha256'],
               'overall_status': receipts['overall_status'], 'packages': outputs})
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--prepare', action='store_true', help='Only manifests; no program execution or final PASS claim.')
    action.add_argument('--fingerprint', action='store_true', help='Print current runtime/test source fingerprint.')
    action.add_argument('--package', action='store_true', help='Requires finalized receipts and report; FAIL/BLOCKED stay explicit.')
    parser.add_argument('--receipts', type=Path, default=DOCS / '验收结果.json')
    parser.add_argument('--output', type=Path, default=Path('/workspace/fangkun/delivery-r189'))
    args = parser.parse_args()
    if args.fingerprint:
        print(runtime_manifest()['fingerprint_sha256'])
    elif args.package:
        print(json.dumps(package(args.output, args.receipts), ensure_ascii=False, indent=2))
    else:
        result = prepare()
        print(json.dumps({'mode': result['mode'], 'changed_file_count': result['changed_file_count'],
                          'runtime_fingerprint_sha256': result['runtime_fingerprint_sha256'], 'packaged': False}))


if __name__ == '__main__':
    main()
