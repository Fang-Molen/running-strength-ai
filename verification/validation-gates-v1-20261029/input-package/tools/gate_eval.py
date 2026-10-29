#!/usr/bin/env python3
"""Offline audit-record validator. Does NOT judge natural-language correctness.
No network, paid API calls, product writes, or automatic semantic PASS.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECISIONS = {'VALIDATED','REPAIRED','PARTIAL','NEEDS_CLARIFICATION',
             'SAFE_REFUSAL','FAILED_TECHNICAL','PENDING'}

def strict_object(pairs):
    d = {}
    for k,v in pairs:
        if k in d:
            raise ValueError(f'duplicate JSON key: {k}')
        d[k] = v
    return d

def read_jsonl(path):
    return [json.loads(line, object_pairs_hook=strict_object)
            for line in Path(path).read_text(encoding='utf-8').splitlines()
            if line.strip()]

def input_hash(row):
    body = {k:v for k,v in row.items() if k!='input_hash'}
    return hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True,
                                    separators=(',',':')).encode()).hexdigest()

def unique(rows, name):
    ids = [r['case_id'] for r in rows]
    if len(set(ids)) != len(ids):
        raise ValueError(f'duplicate {name} case_id')
    return {r['case_id']:r for r in rows}

def lint(cases, rubrics):
    c = unique(cases, 'candidate')
    r = unique(rubrics, 'rubric')
    if set(c)!=set(r):
        raise ValueError('candidate/rubric IDs differ')
    if not cases:
        raise ValueError('empty suite')
    criteria_ids = []
    for id,row in c.items():
        if row.get('input_hash')!=input_hash(row):
            raise ValueError(f'{id}: input hash mismatch')
        for field in ('question','context','candidate_reply','primary_gate','family_id'):
            if not isinstance(row.get(field),str) or not row[field].strip():
                raise ValueError(f'{id}: missing {field}')
        if not r[id]['allowed_decisions'] or not set(r[id]['allowed_decisions']) <= (DECISIONS-{'PENDING'}):
            raise ValueError(f'{id}: invalid allowed decisions')
        if type(r[id].get('professional_required')) is not bool:
            raise ValueError(f'{id}: invalid professional requirement')
        if not r[id]['criteria']:
            raise ValueError(f'{id}: no criteria')
        for criterion in r[id]['criteria']:
            if not criterion.get('requirement') or type(criterion.get('critical')) is not bool:
                raise ValueError(f'{id}: invalid criterion')
            criteria_ids.append(criterion['id'])
    if len(set(criteria_ids))!=len(criteria_ids):
        raise ValueError('duplicate criterion ID')
    return {'cases':len(c),'criteria':len(criteria_ids),
            'professional_required':sum(x['professional_required'] for x in r.values())}

def template(cases, rubrics):
    lookup = {r['case_id']:r for r in rubrics}
    return [dict(case_id=c['case_id'], commit='', input_hash=c['input_hash'],
                 decision='PENDING', final_text='', trace_refs=[],
                 checks=[dict(criterion_id=q['id'], status='PENDING',
                              evidence='', reviewer='') for q in lookup[c['case_id']]['criteria']],
                 professional_review=dict(status='PENDING' if lookup[c['case_id']]['professional_required']
                                          else 'NOT_REQUIRED', reviewer='', evidence=''),
                 attempts=[], run_scope='UNRUN')
            for c in cases]

def evaluate(cases, rubrics, results):
    lint(cases, rubrics)
    ci = unique(cases, 'candidate'); ri = unique(rubrics, 'rubric')
    rs = unique(results, 'result')
    if set(rs)-set(ci):
        raise ValueError('unknown result case IDs')
    commits={r.get('commit') for r in results if r.get('commit')}
    if len(commits)>1:
        raise ValueError('mixed commits: evaluate frozen versions separately')
    output=[]; attempts=0; known_tokens=0; unknown_usage=0
    scopes=set()
    for id,c in ci.items():
        r=rs.get(id)
        errors=[]; pending=False
        if r is None:
            output.append(dict(case_id=id,status='PENDING',errors=['MISSING_RESULT']))
            continue
        if r.get('input_hash') != c['input_hash']:
            errors.append('INPUT_HASH_MISMATCH')
        if r.get('decision') not in DECISIONS:
            errors.append('UNKNOWN_DECISION')
        if r.get('decision')=='PENDING':
            pending=True
        elif r.get('decision') not in ri[id]['allowed_decisions']:
            errors.append('DECISION_OUTSIDE_RUBRIC')
        if not r.get('commit'):
            errors.append('MISSING_COMMIT')
        if not isinstance(r.get('final_text'),str) or not r['final_text'].strip():
            errors.append('EMPTY_FINAL')
        traces=r.get('trace_refs')
        if not isinstance(traces,list) or not traces or not all(isinstance(t,str) and t.strip() for t in traces):
            errors.append('MISSING_TRACE')
        checks=r.get('checks',[])
        expected={q['id'] for q in ri[id]['criteria']}
        got=[q.get('criterion_id') for q in checks]
        if len(set(got))!=len(got) or set(got)!=expected:
            errors.append('CRITERIA_MISSING_DUPLICATED_OR_UNKNOWN')
        for q in checks:
            if q.get('status')=='PENDING':
                pending=True
            elif q.get('status')=='FAIL':
                errors.append('CRITERION_FAILED:'+str(q.get('criterion_id')))
            elif q.get('status')=='PASS':
                if not str(q.get('evidence','')).strip() or not str(q.get('reviewer','')).strip():
                    errors.append('UNSUPPORTED_REVIEW_PASS')
            else:
                errors.append('INVALID_REVIEW_STATUS')
        pro=r.get('professional_review',{})
        if ri[id]['professional_required']:
            if pro.get('status')=='PENDING':
                pending=True
            elif pro.get('status')!='REVIEWED' or not pro.get('reviewer') or not pro.get('evidence'):
                errors.append('PROFESSIONAL_REVIEW_REQUIRED')
        elif pro.get('status') not in {'NOT_REQUIRED','REVIEWED'}:
            errors.append('INVALID_PROFESSIONAL_REVIEW_STATE')
        scope=r.get('run_scope')
        if scope not in {'UNRUN','SYNTHETIC_HARNESS_TEST','SAVED_REPLY_REPLAY','FROZEN_LIVE','END_TO_END'}:
            errors.append('RUN_SCOPE_REQUIRED')
        elif scope=='UNRUN':
            pending=True
        else:
            scopes.add(scope)
        call_attempts=r.get('attempts',[])
        if not isinstance(call_attempts,list):
            raise ValueError('attempts must be an array')
        if scope=='FROZEN_LIVE' and not call_attempts:
            errors.append('LIVE_RECEIPTS_REQUIRED')
        attempt_ids=[]
        for a in call_attempts:
            if scope=='FROZEN_LIVE':
                if not a.get('attempt_id') or not a.get('receipt_ref'):
                    errors.append('LIVE_RECEIPTS_REQUIRED')
                attempt_ids.append(a.get('attempt_id'))
        if len(set(attempt_ids))!=len(attempt_ids):
            errors.append('DUPLICATE_ATTEMPT')
        # All attempts, including failed retries, must be supplied by the adapter.
        # The tool cannot independently establish that unreported calls do not exist.
        for a in call_attempts:
            attempts+=1
            usage=a.get('usage')
            if usage is None:
                unknown_usage+=1
            elif not isinstance(usage,dict) or any(type(usage.get(k)) is not int or usage[k]<0 for k in ('input','output')):
                errors.append('INVALID_USAGE')
                unknown_usage+=1
            else:
                known_tokens += usage['input']+usage['output']
        # Explicit FAIL cannot be disguised as merely pending.
        failed_check=any(q.get('status')=='FAIL' for q in checks)
        hard_error=any(e in {'INPUT_HASH_MISMATCH','UNKNOWN_DECISION','INVALID_USAGE'} for e in errors)
        status='FAIL' if failed_check or hard_error else ('PENDING' if pending else ('FAIL' if errors else 'PASS'))
        output.append(dict(case_id=id,status=status,errors=sorted(set(errors))))
    counts={s:sum(x['status']==s for x in output) for s in ('PASS','FAIL','PENDING')}
    return dict(scope='REVIEW_RECORD_CONTRACT_CHECK_NOT_AUTOMATIC_SEMANTIC_JUDGMENT',
                run_scopes=sorted(scopes), counts=counts, records_complete=counts['PASS']==len(cases),
                actual_app_acceptance='NOT_ESTABLISHED_BY_THIS_TOOL',
                usage=dict(attempts=attempts, known_tokens=known_tokens,
                           unknown_attempts=unknown_usage, exact_total_known=unknown_usage==0 and attempts>0),
                results=output)

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('command',choices=['lint','template','evaluate'])
    ap.add_argument('--results'); ap.add_argument('--out')
    args=ap.parse_args()
    cases=read_jsonl(ROOT/'candidate/cases.jsonl')
    rubrics=read_jsonl(ROOT/'reviewer/rubrics.jsonl')
    if args.command=='lint':
        print(json.dumps(lint(cases,rubrics),ensure_ascii=False))
        return 0
    if not args.out:
        ap.error('--out required')
    if args.command=='template':
        Path(args.out).write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in template(cases,rubrics)),encoding='utf-8')
        print('Created UNRUN template; no product results.')
        return 0
    if not args.results:
        ap.error('--results required')
    report=evaluate(cases,rubrics,read_jsonl(args.results))
    Path(args.out).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ('counts','actual_app_acceptance','usage')},ensure_ascii=False))
    return 0 if report['records_complete'] else 2

if __name__=='__main__':
    try:
        sys.exit(main())
    except (ValueError,KeyError,TypeError) as e:
        print(f'INVALID: {e}',file=sys.stderr)
        sys.exit(2)

