from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json, os, re, subprocess, sys, tempfile

root = Path(__file__).resolve().parents[2]
review = Path(tempfile.mkdtemp(prefix='fangkun-sync-validation-'))
logs = review / 'final-targeted'
logs.mkdir(exist_ok=True)
files = '''
src/lib/health/garmin-sync-runner.test.ts
src/lib/health/garmin-sync-incremental.test.ts
src/lib/health/garmin-sync-performance.test.ts
src/lib/health/garmin-intraday.test.ts
src/lib/health/garmin-progress-store.test.ts
src/lib/health/garmin-activity-conflicts.test.ts
src/lib/health/garmin-sync-status.test.ts
src/lib/health/garmin-pending-imports.test.ts
src/components/garmin-sync-persistence.test.ts
verification/u11/garmin-sync-plan-u11.test.mjs
src/lib/ui/device-store-health-result.test.ts
src/lib/ui/device-store-sync.test.ts
src/lib/ui/garmin-sync-live.test.ts
src/lib/ui/training-record-sync.test.ts
src/lib/ui/scheduled-training.test.ts
src/lib/ui/running-workouts.test.ts
src/lib/core/occurrence.test.ts
src/lib/core/execution.test.ts
src/lib/core/training-decision.test.ts
src/lib/core/training-start-alias.test.ts
src/lib/core/training-fact.test.ts
src/lib/core/training-fact-ownership.test.ts
src/lib/core/training-correction.test.ts
src/lib/core/training-correction-projection.test.ts
src/lib/core/training-import.test.ts
src/lib/core/training-import-delete.test.ts
src/lib/core/running-real-use.test.ts
src/lib/core/running-execution.test.ts
src/lib/core/running-execution-rest.test.ts
src/lib/core/coach-brief.test.ts
src/lib/core/coach-fuel.test.ts
src/lib/core/coach-fieldwork-context.test.ts
src/lib/coach/global-coach-host-v89.test.ts
src/lib/coach/online-coach.test.ts
src/lib/health/health-nutrition-sync.test.ts
src/lib/nutrition/entry-workflow.test.ts
src/lib/nutrition/food-agg.test.ts
src/lib/nutrition/vitals.test.ts
src/lib/nutrition/energy-source.test.ts
'''.split()

def run(file):
    env = dict(os.environ, FK_NO_TEST_PLAN='1')
    result = subprocess.run(['node', '--import', './scripts/test-register.mjs', file], cwd=root, env=env, capture_output=True, text=True, timeout=90)
    output = result.stdout + result.stderr
    log = logs / (file.replace('/', '_') + '.log')
    log.write_text(output)
    def count(label):
        found = re.findall(r'(?:ℹ |# )' + label + r' (\d+)', output)
        return int(found[-1]) if found else 0
    return {'file': file, 'exit_code': result.returncode or (0 if count('tests') else 1), 'tests': count('tests'), 'pass': count('pass'), 'fail': count('fail'), 'log': str(log)}

with ThreadPoolExecutor(max_workers=3) as executor:
    results = list(executor.map(run, files))
summary = {'files': len(results), 'tests': sum(r['tests'] for r in results), 'pass': sum(r['pass'] for r in results), 'fail': sum(r['fail'] for r in results), 'failed_files': [r for r in results if r['exit_code']], 'results': results}
(review / 'targeted-results.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
print(json.dumps({**{k:v for k,v in summary.items() if k != 'results'}, 'logs': str(review)}, ensure_ascii=False, indent=2), flush=True)
sys.exit(1 if summary['failed_files'] else 0)
