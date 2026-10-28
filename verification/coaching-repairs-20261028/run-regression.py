"""One concentrated offline regression; subprocess failures do not hide later groups."""
import glob,json,os,pathlib,shlex,subprocess,time
root=pathlib.Path(__file__).resolve().parents[2]
out=pathlib.Path(__file__).resolve().parent
scripts=json.loads((root/'package.json').read_text())['scripts']
commands=scripts['test'].split(' && ')
covered=set()
def inspect(command):
    if command.startswith('npm run '):
        for part in scripts[command.split()[2]].split(' && '): inspect(part)
    else:
        for arg in shlex.split(command):
            if '.test.' in arg: covered.update(glob.glob(arg,root_dir=root,recursive=True))
for command in commands: inspect(command)
all_tests=set()
for folder in ['src','server']:
    for extension in ['ts','tsx','mjs','js']: all_tests.update(glob.glob(f'{folder}/**/*.test.{extension}',root_dir=root,recursive=True))
extra=sorted(all_tests-covered)
(out/'extra-test-files.json').write_text(json.dumps(extra,indent=2)+'\n')
commands.append('node --import ./scripts/test-register.mjs --test --test-concurrency=3 '+' '.join(shlex.quote(p) for p in extra))
env=os.environ.copy()
for key in ['DATABASE_URL','DEEPSEEK_API_KEY','XAI_API_KEY']: env.pop(key,None)
env['FANGKUN_DEEPSEEK_ENABLED']='false'
env['NODE_OPTIONS']='--import '+str(root/'evaluation/deepseek-development/no-network.mjs')
results=[]
for i,command in enumerate(commands):
    name=f'regression-{i+1:02}.log';started=time.time()
    with (out/name).open('w') as log:
        result=subprocess.run(command,shell=True,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
    results.append({'command':command,'exit':result.returncode,'seconds':round(time.time()-started,2),'log':name})
    (out/'regression-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    print(f'{i+1}/{len(commands)} exit={result.returncode} {name}',flush=True)
raise SystemExit(any(r['exit'] for r in results))
