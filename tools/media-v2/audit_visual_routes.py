"""Read-only source reference inventory. Matches require human route review."""
import argparse
import hashlib
import json
from pathlib import Path
import re

PATTERN = re.compile(r'mount2d|mount3d|ExerciseDemo|DemoSheet|demoIdFor|FormFigure|buildAvatarSvg|createMuscleExplorer|athlete(?:-male|-female)?\.glb|human\.glb|ecorche|stage-fallback|ShapeSim3D|createFigureViewer')
EXCLUDE = {'node_modules', '.git', '.output', '.nitro', '.tanstack'}

def audit(root):
    result = []
    for folder in ('src', 'public'):
        for path in sorted((root / folder).rglob('*')):
            if not path.is_file() or path.is_symlink() or EXCLUDE.intersection(path.parts):
                continue
            if path.suffix not in ('.ts', '.tsx', '.js', '.mjs', '.css', '.html') or path.stat().st_size > 1_000_000:
                continue
            if 'vendor' in path.parts or '.test.' in path.name:
                continue
            text = path.read_text(encoding='utf-8', errors='replace')
            matches = [{'line': i, 'tokens': sorted(set(PATTERN.findall(line)))} for i, line in enumerate(text.splitlines(), 1) if PATTERN.search(line)]
            if matches:
                result.append({'file': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'matches': matches})
    return {'status': 'REVIEW_REQUIRED', 'scope': 'source references; not browser reachability or runtime proof', 'files': result}

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('source_root', type=Path)
    args = p.parse_args()
    if not (args.source_root / 'src').is_dir():
        p.error('source_root must contain src/')
    print(json.dumps(audit(args.source_root), ensure_ascii=False, indent=2))
