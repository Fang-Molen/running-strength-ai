"""Offline report only. Evaluator references never enter run.ts/provider.py.
Scores are the implementing assistant's disclosed engineering review, not an
independent professional/human review and not a paid model judge.
"""
import json,hashlib,csv,re,collections,pathlib,subprocess
p=pathlib.Path(__file__).parent;b=p.parent
read=lambda f:[json.loads(l) for l in f.read_text().splitlines() if l.strip()]
write=lambda f,x:f.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
key=lambda r:(r['path_id'],r['turn'])
calls=read(p/'calls.jsonl');dispatches=read(p/'dispatches.jsonl');bycall={r['requestId']:r for r in calls};bydispatch={r['requestId']:r for r in dispatches}
live={key(r):r for r in read(p/'final3-results.jsonl')};assert len(live)==40
latest_live={**live,**{key(r):r for r in read(p/'final4-results.jsonl')}}
final={key(r):r for f in ['uniform-final-offline.jsonl','uniform-t03-offline.jsonl','uniform-baseline-offline.jsonl'] for r in read(p/f)};assert len(final)==40
schedule=json.loads((b/'dispatch-order.json').read_text())['schedule'];assert set(map(key,schedule))==set(final)
assert len(calls)==54 and sum(not r['requestId'].startswith('smoke') for r in calls)==50
for c in calls:
 d=bydispatch[c['requestId']];u=c['reply']['usage'];v=c['reply']['choices'][0]
 assert d['payload']['thinking']=={'type':'disabled'} and d['payload']['max_tokens']==1800 and d['payload']['temperature']==0.4
 assert v['finish_reason']=='stop' and json.loads(v['message']['content'])['text'].strip()
 assert u['total_tokens']==u['prompt_tokens']+u['completion_tokens']
 assert u['prompt_tokens']==u['prompt_cache_hit_tokens']+u['prompt_cache_miss_tokens']
 assert 'reasoning_content' not in v['message']

manifest=json.loads((b/'input-package/MANIFEST.json').read_text())
freeze={name:hashlib.sha256((b/'input-package'/name).read_bytes()).hexdigest()==meta['sha256'] for name,meta in manifest.items()};assert all(freeze.values())
refs={r['path_id']:r for r in read(b/'input-package/02_评测参考_勿传方坤.jsonl')}
notes={
'Q01-A':'1200米、234秒，未加休息。','Q01-B':'600米改为200秒后合计314秒，其他距离与休息口径不变。',
'Q02-A':'已知900米/179秒；第4组完成状态保留未知。','Q02-B':'1200米/242秒，四组均有时间。',
'Q03-A':'45×6=270 AU；保留主观负荷口径。','Q03-B':'未把末组RPE作为整课RPE，未算270 AU。',
'Q04-A':'3组/30次/每手360 kg·次；首轮实测误拒，最终版本以原回复离线复验通过。',
'Q04-B':'2组/20次/每手240 kg·次；跳过未算完成。',
'Q05-A':'明确实际5公里。','Q05-B':'实际6公里与计划7公里分开。',
'Q06-A':'甲5:00/km，乙4:48/km，乙快；未作因果推断。','Q06-B':'甲5:00/km，乙5:12/km，甲快。',
'Q07-A':'原过滤遗漏明确高于结论；最终宿主从题面比较62/63均高于52–56；睡眠缺失、原因未知保留。',
'Q07-B':'原过滤遗漏明确处于结论；最终宿主从题面比较53/54处于52–56；不等于完全恢复。',
'Q08-A':'停止冲刺/跑跳并及时专业评估，未诊断；适用性待独立专业审核。',
'Q08-B':'基于轻微且减轻、走路正常给条件性调整及恶化求助；继续冲刺的适用性待独立专业审核。',
'Q09-A':'朋友发烧与本人无发烧分开；条件性建议未套用朋友症状。',
'Q09-B':'本人也发烧，未建议带病跑步；停止当日训练。',
'Q10-A':'2025已记录9公里，不拿2026数据补齐。',
'Q10-B':'9公里计算正确，但输出“记录覆盖并不完整”把未知说成确定缺失，事实/限制失败。',
'Q11-A':'初次126秒；更正第四组33→29后122秒，旧值和未写入记录均保留。',
'Q11-B':'初次128秒；更正第四组35→29后122秒，旧值和未写入记录均保留。',
'Q12-A':'配速比较正确，但过滤后仅剩复查提示，没有明确的明天安排候选。',
'Q12-B':'配速比较正确，但过滤后没有可审核的明天安排候选。',
'Q13-A':'1200千卡，晚餐/加餐未记录，全天未知。',
'Q13-B':'1200千卡，按用户明确未吃的声明核对；未将未吃改写成未记。',
'Q14-A':'保留4天后/800米/可练三次的事实，但过滤后缺少赛前安排思路及具体缺项。',
'Q14-B':'保留4周后/800米/可练三次，过滤后阶段安排和需补资料均缺失。',
'Q15-A':'一次可用时间；不把两次挤进一次，先确认取舍，不改日历，句子完整。',
'Q15-B':'两次可用时间未虚构一次限制；未写日历。',
'Q16-A':'时间递增，未证明疲劳因果，给出竞争解释和补查。',
'Q16-B':'时间递减，未描述掉速，原因保持不确定。',
'T01-ALL_HISTORY':'183课/915公里，2025范围，完整性未知，无他人数据。',
'T01-CURRENT_SELECTION':'同范围与915公里，由规范汇总支撑，完整性未知。',
'T02-ALL_HISTORY':'保留两次跑步、力量整课RPE未知、右小腿反馈和睡眠缺失；无他人发烧。',
'T02-CURRENT_SELECTION':'同上；原始入库→所有者查询→选择→请求→引文→显示均可追溯。',
'T03-ALL_HISTORY':'10公里；10月25日5:00快于27日5:24；右小腿反馈和睡眠缺失；不确定原因。原文“递进”表达仍宜专业复核。',
'T03-CURRENT_SELECTION':'同上；宿主验证后显示快慢结论与睡眠缺项。'
}
partial={'Q12-A','Q12-B','Q14-A','Q14-B'};pro={'Q08-A','Q08-B'}
results=[]
for planned in schedule:
 k=key(planned);r=final[k];ll=latest_live[k];receipt=ll['phase']+'-'+ll['path_id']+'-'+str(ll['turn']);call=bycall[receipt];dispatch=bydispatch[receipt]
 assert r['payloadHash']==dispatch['payloadHash'],(k,'INPUT_MISMATCH')
 text=(r['clientResult'] or r['result']['body'])['text'];assert text.strip()
 path=r['path_id'];status='ENGINEERING_PASS'
 scores={'facts':2,'reasoning_limits':2,'task_completion':2,'cross_turn':2 if r['case_id']=='Q11' else None,'communication':1 if text.count('按用户自述计算')>1 else 2}
 if path in partial:status='PARTIAL';scores.update(task_completion=1,communication=1)
 if path=='Q10-B':status='FAIL';scores.update(facts=1,reasoning_limits=0,task_completion=1,communication=1)
 if path in pro:status='ENGINEERING_PASS_PROFESSIONAL_PENDING'
 raw=call['reply']['choices'][0]['message']['content'];wire=json.loads(dispatch['payload']['messages'][1]['content'])
 assert call['reply']['choices'][0]['finish_reason']=='stop';assert json.loads(raw)['text'].strip();assert dispatch['payload']['max_tokens']==1800;assert dispatch['payload']['thinking']=={'type':'disabled'}
 if r['kind']=='ISOLATED_STORED_HISTORY':
  assert 'OTHER-1' not in json.dumps(dispatch['payload'],ensure_ascii=False)
  assert '发烧' not in json.dumps(dispatch['payload'],ensure_ascii=False)
 results.append({**{x:planned[x] for x in ['case_id','path_id','turn','kind','mode','question']},'semantic_status':status,'engineering_scores':scores,'reviewer':'IMPLEMENTING_ASSISTANT_INITIAL_ENGINEERING_REVIEW_NOT_INDEPENDENT_PROFESSIONAL','professional_review':'NOT_PERFORMED','review_reason':notes[path], 'expected_evaluator_only':refs.get(path,{}).get('expected',notes[path]),'original_live':{'phase':live[k]['phase'],'http':live[k]['result']['http'],'body_ok':live[k]['result']['body']['ok'],'client_error':(live[k]['clientResult'] or {}).get('error'),'text':(live[k]['clientResult'] or live[k]['result']['body']).get('text')},'selected_paid_receipt':receipt,'selected_paid_live_ok':ll['result']['body']['ok'],'latest_validation':'SAVED_REPLY_OFFLINE_REPLAY_AT_2d46210','app_http_and_client_replay_accepted':None if r['mode']=='ALL_HISTORY' else bool(r['result']['body']['ok'] and 'error' not in r['clientResult']),'baseline_validation':r['result']['body'].get('validation') if r['mode']=='ALL_HISTORY' else None,'input_hash_verified':True,'payload_hash':dispatch['payloadHash'],'provider_usage':call['reply']['usage'],'finish_reason':'stop','output_limit':1800,'thinking_requested':'disabled','raw_model_json':json.loads(raw),'final_text':text,'final_text_chars':len(text),'computed_quotes':(r['clientResult'] or r['result']['body']).get('computedQuotes',[]),'provider_latency_ms':call['latencyMs'],'live_total_ms':ll['latencyMs'],'selection_and_local_overhead_ms':max(0,ll['latencyMs']-call['latencyMs'])})
(p/'RESULTS.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in results))
# Request ledger: exactly one row per chargeable call; replays never count.
fields=['request_id','case_path_turn','phase','provider_created_epoch','test_clock_started_at_NOT_WALL_TIME','requested_model','returned_model','backend_fingerprint','thinking','max_output_tokens','finish_reason','json_parseable','body_nonempty','prompt_tokens','completion_tokens','total_tokens','cache_hit_tokens','cache_miss_tokens','reasoning_tokens','provider_latency_ms','payload_hash']
with (p/'TOKEN.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
 for c in calls:
  d=bydispatch[c['requestId']];u=c['reply']['usage'];choice=c['reply']['choices'][0];v=json.loads(choice['message']['content'])
  w.writerow(dict(zip(fields,[c['requestId'],c['requestId'].split('-',1)[1],c['requestId'].split('-',1)[0],c['reply'].get('created'),d['startedAt'],d['payload']['model'],c['reply']['model'],c['reply'].get('system_fingerprint'),'disabled',d['payload']['max_tokens'],choice['finish_reason'],True,bool(v['text'].strip()),u['prompt_tokens'],u['completion_tokens'],u['total_tokens'],u['prompt_cache_hit_tokens'],u['prompt_cache_miss_tokens'],u.get('completion_tokens_details',{}).get('reasoning_tokens','NA'),c['latencyMs'],d['payloadHash']])))
# Every paid attempt linked to its live outcome, including failed/obsolete attempts.
attempts=[]
for c in calls:
 phase=c['requestId'].split('-',1)[0];rr=next((r for r in read(p/(phase+'-results.jsonl')) if c['requestId']==phase+'-'+r['path_id']+'-'+str(r['turn'])),None)
 attempts.append({'request_id':c['requestId'],'tokens':c['reply']['usage'],'live_outcome':None if rr is None else {'http':rr['result']['http'],'ok':rr['result']['body']['ok'],'client_error':(rr['clientResult'] or {}).get('error')},'counted_in_paid_total':True,'selected_final_receipt':c['requestId'] in {r['selected_paid_receipt'] for r in results}})
(p/'ALL-ATTEMPTS.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in attempts))
# Pair comparisons show selected one-call sessions AND all development attempts.
pairs=[]
for case in ['T01','T02','T03']:
 a=next(r for r in results if r['path_id']==case+'-ALL_HISTORY');z=next(r for r in results if r['path_id']==case+'-CURRENT_SELECTION')
 allcase=[c for c in calls if '-'+case+'-' in c['requestId']]
 pairs.append({'case':case,'engineering_fact_gate':'PASS','professional_review':'NOT_PERFORMED','A_selected_receipt':a['selected_paid_receipt'],'B_selected_receipt':z['selected_paid_receipt'],'A_first_and_session_usage':a['provider_usage'],'B_first_and_session_usage':z['provider_usage'],'A_session_requests':1,'B_session_requests':1,'A_provider_latency_ms':a['provider_latency_ms'],'B_provider_latency_ms':z['provider_latency_ms'],'A_total_ms':a['live_total_ms'],'B_total_ms':z['live_total_ms'],'A_local_overhead_ms':a['selection_and_local_overhead_ms'],'B_local_overhead_ms':z['selection_and_local_overhead_ms'],'A_selection_ms':None,'B_selection_ms':None,'token_reduction_percent':(a['provider_usage']['total_tokens']-z['provider_usage']['total_tokens'])/a['provider_usage']['total_tokens']*100,'all_development_attempts_requests':len(allcase),'all_development_attempts_tokens':sum(c['reply']['usage']['total_tokens'] for c in allcase),'A_output_chars':a['final_text_chars'],'B_output_chars':z['final_text_chars'],'note':'A is a 26k test transport baseline, not legacy App. Extraction alone was not separately timed. Local overhead includes DB/auth/validation and is not retrieval timing. Selected sessions are complete one-call sessions; all failed/obsolete development attempts remain in campaign totals.'})
write(p/'HISTORY-PAIRS.json',pairs)
total=lambda a:{k:sum(r['reply']['usage'].get(k,0) for r in a) for k in ['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']}
smoke=[r for r in calls if r['requestId'].startswith('smoke')];full=[r for r in calls if not r['requestId'].startswith('smoke')]
q=[r for r in results if r['kind']=='USER_DIALOGUE'];h=[r for r in results if r['kind']!='USER_DIALOGUE']
dims={}
for d in ['facts','reasoning_limits','task_completion','cross_turn','communication']:
 vals=[r['engineering_scores'][d] for r in results if r['engineering_scores'][d] is not None]
 dims[d]={'applicable':len(vals),'scored':len(vals),'not_executed':0,'score_sum':sum(vals),'max':2*len(vals),'counts':dict(collections.Counter(vals))}
write(p/'SCORES.json',{'reviewer':'Implementing assistant initial engineering review; not independent professional validation. No paid judge calls. Public development set, not unseen population accuracy.','pass_rule':'No score averaging: fact, reasoning and task must each be 2; communication must remain readable (>=1), cross-turn 2 when applicable. Professional pending is separate.','all_40_dimensions':dims,'dialogue_34_status':dict(collections.Counter(r['semantic_status'] for r in q)),'history_6_status':dict(collections.Counter(r['semantic_status'] for r in h))})
code=subprocess.check_output(['git','rev-parse','2d46210'],text=True).strip()
audit={'candidate_code_commit':code,'model_input_builder_frozen_at':'b420ec8','post_render_policy_changed_during_run':True,'same_exact_code_40_paid_calls':'NOT_PERFORMED; original paid inputs/replies were replayed on the final candidate without network; no claim of same-commit paid full campaign.','uniform_app_replay_rebuilt_input_hash_matches':37,'baseline_saved_wire_receipts':3,'uniform_replay_cases':40,'paid_generation_requests':len(calls),'smoke_requests':len(smoke),'full_regression_requests':len(full),'full_limit':50,'automatic_retries':0,'totals':total(calls),'smoke_usage':total(smoke),'full_usage':total(full),'main_distinct_40_usage':total([bycall[r['selected_paid_receipt']] for r in results]),'finish_stop':len(calls),'strict_json_parseable':len(calls),'nonempty_model_text':len(calls),'reasoning_tokens':'NA: supplier did not return breakdown; never substitute zero','thinking_requested':'disabled','output_limit':1800,'bill_fee':'NA: no provider invoice available; ledger prices are test estimates, not billing evidence','live_first_main_dialogue_accepted':sum(r['original_live']['body_ok'] and not r['original_live']['client_error'] for r in q),'live_first_main_dialogue_denominator':34,'live_first_main_app_and_current_history_accepted':35,'live_first_main_app_denominator':37,'latest_uniform_app_replay_accepted':37,'latest_uniform_test_baseline_accepted':3,'history_engineering_fact_groups_passed':3,'history_groups':3,'dialogue_status':dict(collections.Counter(r['semantic_status'] for r in q)),'no_release':'NOT_READY: Q10-B unsupported coverage assertion, Q12/Q14 task omissions and professional review pending. Exact final commit paid full campaign not established.','prior_generations':51,'prior_tokens':128478,'lifetime_generations':51+len(calls),'lifetime_tokens':128478+total(calls)['total_tokens'],'earlier_free_models_get':1,'frozen_input_files_sha_match':freeze,'reference_answers_sent':False,'synthetic_only':True,'foreign_history_facts_sent':0,'professional_review':'NOT_PERFORMED','browser_acceptance':'NOT_PERFORMED','production_importer_acceptance':'NOT_PERFORMED','provider_fingerprints':dict(collections.Counter(r['reply'].get('system_fingerprint') for r in calls)),'test_clock_notice':'dispatch startedAt is the fixed synthetic as-of clock, not wall time. provider created epoch and monotonic latencies retained per request.','offline_tests':{'related_suite_files':34,'related_tests':321,'related_failures':0,'additional_suite_tests':76,'additional_failures':0,'counts_overlap_do_not_add':True,'typecheck':'PASS','full_npm_test':'Not rerun; prior stage script failures remain archived; no full-repo green claim.'}}
write(p/'audit.json',audit)
write(p/'STOPPED.json',{'paid_generation_disabled':True,'reason':'40 planned cases measured; full-regression 50/50 cap reached. Semantic gaps reported, no release. Replays remain allowed.','paid_calls':54,'full_calls':50,'tokens':184405})
# Versioned independent arithmetic audit; preserve all original files byte for byte.
maths={'Q01-A':{'distance_m':600+400+200,'time_s':120+78+36},'Q01-B':{'distance_m':1200,'time_s':200+78+36},'Q02-A':{'known_distance_m':3*300,'known_work_s':58+60+61,'fourth':'UNKNOWN'},'Q02-B':{'distance_m':4*300,'time_s':58+60+61+63},'Q03-A':{'session_AU':45*6},'Q03-B':{'session_AU':None,'reason':'last-set RPE cannot substitute for unknown session RPE'},'Q04-A':{'sets':3,'reps':3*10,'per_hand_kg_reps':12*10*3},'Q04-B':{'sets':2,'reps':2*10,'per_hand_kg_reps':12*10*2},'Q06-A':{'pace_s_per_km':[25*60/5,24*60/5],'faster':'乙'},'Q06-B':{'pace_s_per_km':[25*60/5,26*60/5],'faster':'甲'},'Q10-A/B':{'2025_km':4+5},'Q11-A':{'old':30+31+32+33,'new':30+31+32+29},'Q11-B':{'old':30+31+32+35,'new':30+31+32+29},'Q12-A/B':{'same_arithmetic_as':'Q06-A/B, labels yesterday/today'},'Q13-A/B':{'recorded_kcal':550+650,'A_coverage':'UNKNOWN','B_coverage':'user explicitly reports no dinner/snack'},'Q16-A/B':{'sum_s':30+31+32+33,'A_trend':'increasing','B_trend':'decreasing'},'T01':{'2025_rows':183,'km':183*5},'T03':{'km':5+5,'paces_s_per_km':[25*60/5,27*60/5],'faster_date':'2026-10-25'}}
history=read(b/'input-package/03_合成历史_245条.jsonl')
year_runs=[r for r in history if r['athlete']=='SYN-A' and r['kind'] in ('run','easy_run') and r['day'].startswith('2025-')]
recent_runs=[r for r in history if r['athlete']=='SYN-A' and r['kind'] in ('run','easy_run') and '2026-10-25'<=r['day']<='2026-10-29']
assert len(year_runs)==183 and sum(r['distance_km'] for r in year_runs)==915
assert len(recent_runs)==2 and sum(r['distance_km'] for r in recent_runs)==10
maths['T01']={'2025_rows':len(year_runs),'km':sum(r['distance_km'] for r in year_runs),'method':'filter original SYN-A raw rows by occurrence year and run kind'}
maths['T03']={'rows':len(recent_runs),'km':sum(r['distance_km'] for r in recent_runs),'paces_s_per_km':{r['day']:r['minutes']*60/r['distance_km'] for r in recent_runs},'faster_date':min(recent_runs,key=lambda r:r['minutes']/r['distance_km'])['day']}
write(p/'CALCULATION-AUDIT-v1.json',{'version':'1.0','method':'separate Python arithmetic plus implementing-assistant per-question semantic review; not model judge or independent professional review','original_questions_changed':False,'original_references_changed':False,'reference_errors_found':0,'scope':'All 32 paths/34 turns and 6 histories checked; numeric rows below, nonnumeric expected conditions in RESULTS.jsonl. Code/source-contract errors fixed; no golden alteration.','calculations':maths})
print(json.dumps({'paid_requests':len(calls),'tokens':audit['totals'],'dialogue_status':audit['dialogue_status'],'history_groups':3,'uniform_replay':40},ensure_ascii=False))
status_zh={'ENGINEERING_PASS':'工程通过','ENGINEERING_PASS_PROFESSIONAL_PENDING':'工程通过；专业待审','PARTIAL':'部分；未通过','FAIL':'失败'}
lines=['# 方坤真实 DeepSeek 续测结果 · 2026-10-29','','**40/40计划项已取得真实模型回复；未达到全部放行条件。** 34轮题目工程初评：27通过、2工程通过但专业待审、4部分、1失败。三组历史对照关键事实门槛3/3通过。','','本次续测54次付费生成、184,405 tokens：冒烟4次/3,723 tokens；正式回归50/50次、180,682 tokens（40个计划项+8次前置排错+2次T03补测）。无自动重试，失败立即停批排查；达到上限后付费入口已锁定。全部54次`finish_reason=stop`，正文非空、JSON可解析；未把截断当成功。','','## 用量与边界','','| 范围 | 请求 | 输入 | 输出 | 总token |','|---|---:|---:|---:|---:|']
for name,a in [('本次冒烟',smoke),('本次正式回归（含排错）',full),('本次全部',calls)]:
 u=total(a);lines.append(f"|{name}|{len(a)}|{u['prompt_tokens']:,}|{u['completion_tokens']:,}|{u['total_tokens']:,}|")
lines+=['','此前测试51次/128,478 tokens独立保留；历史累计105次生成/312,883 tokens，另较早一次免费模型列表GET。本次50上限用于正式回归，冒烟另列。实际账单金额未取得，**费用NA**；代码中的账本单价为测试估算。推理token供应商未返回，逐请求记NA，不以0代替，不与completion重复相加。缓存命中62,592、未命中105,807输入tokens。','','## 实测与最终版本的区别','','- 首次计划40项：题目32/34被服务端和客户端接受；3个CURRENT_SELECTION历史均接受。App链路合计35/37接受。另3个ALL_HISTORY是扩展输入预算的测试对照，不能算App HTTP成功。','- Q04-A和Q11-A第2轮实测误拒后已修复，以同一份付费原回复离线复验通过，没有再次收费。Q07和T03的明确数值比较被过滤后，改由宿主按已验证来源显示。','- 最终候选源码：`'+code+'`。题面和参考答案保持原始字节，独立Python复算见CALCULATION-AUDIT-v1.json；未发现需要更改原题/参考的算例错误。','- 模型输入构造在b420ec8后冻结，期间仍修复显示/过滤。因此**未声称40次均在最终同一提交上重新付费全跑**。最终版本已用保存回复统一离线验37个App会话和3个测试对照；37个App重建请求与所选付费请求哈希37/37相同，3个对照使用原保存wire验证。T03选用final4补测，两次均完整计费入账。','- 所有54次请求均deepseek-flash、temperature=0.4、thinking disabled、max_tokens=1800；返回同一system_fingerprint。模型名为供应商别名，不代表不可变的独立版本。','- 原始合成记录隔离存入PGlite并按SYN-A查询，当前资料筛选、会话编排、授权/HTTP控制器及客户端校验使用真实代码。映射为测试适配器；未做完整生产导入器、浏览器、真机或独立专业验收。','- 评分由实现助手逐题对照原参考、完整输出和禁止事项作工程初评，非关键词自动打分、非真人专家评审。安全/训练规划专业项均待独立审核；公开开发题不能代表真实人群准确率。','','## 未通过与待审核','','| 项目 | 结果/问题 |','|---|---|','|Q10-B|9公里正确，但把覆盖未知说成“记录覆盖并不完整”；事实/限制失败。|','|Q12-A/B|快慢比较正确，过滤后缺少明天安排候选；任务部分完成。|','|Q14-A/B|赛期/目标引用正确，过滤后安排思路及需补资料遗漏；任务部分完成。|','|Q08-A/B|停止/调整与风险沟通工程检查通过；必须由未参与开发的专业人员审核适用性。|','|表达|部分计算证据重复显示；不影响数值，但沟通维度降分。|','','因此P0全部通过/专业审核/同一最终提交真实全量等放行条件尚未全部满足，不合并、不发布。','','## 三组历史对照','','A为同版本测试适配器全量244条SYN-A事实，输入上限26k；B为App当前筛选/规范汇总，输入上限8k。两者都不含SYN-B/OTHER-1。比较的是实际token数，不是账单节省。','','|组|A完整单会话token|B完整单会话token|减少|事实门槛|全部排错请求/token|','|---|---:|---:|---:|---|---:|']
for v in pairs:lines.append(f"|{v['case']}|{v['A_first_and_session_usage']['total_tokens']:,}|{v['B_first_and_session_usage']['total_tokens']:,}|{v['token_reduction_percent']:.2f}%|工程通过|{v['all_development_attempts_requests']}/{v['all_development_attempts_tokens']:,}|")
lines+=['','表中每个所选会话均仅1次请求；其余失败/过时尝试没有隐藏，全部在54次总账及ALL-ATTEMPTS.jsonl。各模式输入、输出、缓存、响应延迟、字符长度及本地总开销见HISTORY-PAIRS.json；未单独计提取耗时，记NA。本地开销不能冒称检索耗时。T03原模型解释“递进”的措辞仍建议专业复核。','','## 逐轮结果','','下表“实测接受”保留原首次计划请求的结果；“最终复验”使用保存的真实回复，不产生新请求。通过表示工程初评符合本题事实和任务条件，专业项另列。完整正文、原模型JSON、评分理由及各维分数在RESULTS.jsonl，54次付费请求在TOKEN.csv。','','|路径/轮|原实测接受|最终复验|语义初评|所选请求token|说明|','|---|---|---|---:|---|']
for r in results:
 liveok=r['original_live']['body_ok'] and not r['original_live']['client_error'];kind='对照' if r['mode']=='ALL_HISTORY' else 'App'
 lines.append(f"|{r['path_id']}/{r['turn']}|{kind} {'是' if liveok else '否'}|{'对照通过' if r['mode']=='ALL_HISTORY' else 'App通过'}|{status_zh[r['semantic_status']]}|{r['provider_usage']['total_tokens']}|{r['review_reason']}|")
lines+=['','## 离线验证与资料','','- 相关回归34文件、321测试通过；追加校验76测试通过（集合重叠，不相加），类型检查通过，diff检查通过。日志在本目录和../load-memory-20261029/final-tests.json。','- 既往npm test脚本阶段失败保留在../repair/full-suite-failures.log；没有声称全仓测试全绿。','- SCORES.json按维度给适用数、已评分数、未执行数及分布，未用平均分冲抵失败。DEFECT-CROSSWALK.md对照DS-01至DS-06。','- 证据文件：calls.jsonl（全部真实回复，无隐藏推理）、dispatches.jsonl（合成模型输入）、TOKEN.csv、ALL-ATTEMPTS.jsonl、RESULTS.jsonl、HISTORY-PAIRS.json、audit.json。`startedAt`为冻结测试时钟，不是实际墙钟；供应商created与真实单调耗时另存。','- 密钥仅来自进程环境；扫描交付文件中的实际密钥值，只记录是否发现，不保存值。原始参考答案仅评测侧读取，从未加入模型输入。','- 付费调用已用STOPPED.json锁定。未经新预算授权不得再次付费；离线回放可继续。','']
(p/'SUMMARY.md').write_text('\n'.join(lines))
