import json,csv,collections,hashlib,pathlib,os,shutil,zipfile
root=pathlib.Path('.');work=root/'work/campaign';dest=root/'verification/new-questions-20261029'
load=lambda p:[json.loads(x) for x in p.read_text().splitlines() if x.strip()]
calls=load(work/'calls.jsonl');results=load(work/'results.jsonl');dispatch=load(work/'dispatches.jsonl')
assert len(calls)==len(results)==len(dispatch)==40,(len(calls),len(results),len(dispatch))
assert len({x['requestId'] for x in calls})==40
assert all(c['reply'].get('usage') for c in calls)
lookup={c['requestId']:c for c in calls};sent={c['requestId']:c for c in dispatch}
refs={r['path_id']:r for r in load(dest/'input-package/02_评测参考_勿传方坤.jsonl')}
keys=['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']
totals={k:sum(c['reply']['usage'].get(k,0) for c in calls) for k in keys};totals['reasoning_tokens']=sum(c['reply']['usage'].get('completion_tokens_details',{}).get('reasoning_tokens',0) for c in calls)
assert totals['prompt_tokens']+totals['completion_tokens']==totals['total_tokens']
for c in calls:
 u=c['reply']['usage'];assert u['prompt_tokens']+u['completion_tokens']==u['total_tokens']
assert len([r for r in results if r['kind']=='USER_DIALOGUE'])==34
assert len([r for r in results if r['kind']=='ISOLATED_STORED_HISTORY'])==6
for r in results:
 rid=r['path_id']+'-'+str(r['turn']);c=lookup[rid];p=sent[rid]['payload'];assert r['payloadHash']==sent[rid]['payloadHash']
 r['status']='BASELINE_INCOMPLETE' if r['mode']=='ALL_HISTORY' and r['result']['body'].get('error') else 'APP_HTTP_ACCEPTED' if r['result']['body'].get('ok') else 'APP_OUTPUT_REJECTED'
 r['providerReply']=c['reply'];r['actualProviderRequest']=p;r['providerModel']=c['reply'].get('model');r['usage']=c['reply']['usage'];r['providerLatencyMs']=c['latencyMs'];r['billedCost']='NA';r['professionalReview']='NOT_PERFORMED';r['browserValidation']='NOT_PERFORMED'
 if r['kind']=='USER_DIALOGUE':
  ref=refs[r['path_id']];r['scoringReference']=ref['expected']
  if r['path_id']=='Q08-A':
   score={'facts':2,'reasoning':2,'task':2,'communication':2,'cross_turn':'NA'};reason='工程初评：回应停止冲刺及及时线下评估，未下确定诊断；医学适用性仍待独立专业复核。';r['quality']='ENGINEERING_INITIAL_PASS_PROFESSIONAL_PENDING'
  elif r['path_id']=='Q15-A':
   score={'facts':1,'reasoning':1,'task':1,'communication':0,'cross_turn':'NA'};reason='部分解释被服务端删除后出现多处空分号，未形成清晰可审核的单次训练方案；没有宣称已写日历。';r['quality']='PARTIAL'
  else:
   score={'facts':0,'reasoning':0,'task':0,'communication':0,'cross_turn':0 if r['case_id']=='Q11' else 'NA'};reason='实际HTTP未提供题目答案，返回OUTPUT_REJECTED。此分数评价用户可得答案，不代表原始模型全部事实或安全推理均错误。';r['quality']='FAIL_NO_DELIVERED_ANSWER'
  r['scores']=score;r['scoringReason']=reason
 else:
  r['scores']={'facts':0,'reasoning':0,'task':0,'communication':0,'cross_turn':'NA'};r['quality']='FAIL_NO_COMPLETE_ANSWER';r['scoringReason']='全量模式为测试适配器直接供应商对照，非App验收；优化模式走现有HTTP控制器。均未取得可评分完整答案，配对质量效率结论为NA。'
 # Rubric remains evaluator-only; never copied into a provider request.
 if r['kind']=='ISOLATED_STORED_HISTORY':
  assert 'OTHER-1' not in json.dumps(p,ensure_ascii=False) and '发烧' not in json.dumps(p,ensure_ascii=False)
  if r['mode']=='ALL_HISTORY':
   wire=json.loads(p['messages'][1]['content']);assert len(wire['facts'])==244
   assert all(json.loads(f['detail'])['athlete']=='SYN-A' for f in wire['facts'])
with (dest/'RESULTS.jsonl').open('w') as f:
 for r in results:f.write(json.dumps(r,ensure_ascii=False)+'\n')
fields=['row_type','path_id','turn','request_count',*keys,'reasoning_tokens','provider_latency_ms','finish_reason','status','billed_cost']
with (dest/'TOKEN.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields,lineterminator='\n');w.writeheader()
 for r in results:
  u=r['usage'];w.writerow({'row_type':'request','path_id':r['path_id'],'turn':r['turn'],'request_count':1,**{k:u.get(k,'NA') for k in keys},'reasoning_tokens':u.get('completion_tokens_details',{}).get('reasoning_tokens','NA'),'provider_latency_ms':r['providerLatencyMs'],'finish_reason':r['providerReply']['choices'][0]['finish_reason'],'status':r['status'],'billed_cost':'NA'})
 for pid in dict.fromkeys(r['path_id'] for r in results):
  rr=[r for r in results if r['path_id']==pid];w.writerow({'row_type':'conversation','path_id':pid,'turn':'ALL','request_count':len(rr),**{k:sum(r['usage'][k] for r in rr) for k in keys},'reasoning_tokens':sum(r['usage'].get('completion_tokens_details',{}).get('reasoning_tokens',0) for r in rr),'provider_latency_ms':sum(r['providerLatencyMs'] for r in rr),'finish_reason':'SEE_REQUEST_ROWS','status':'SEE_RESULTS','billed_cost':'NA'})
 w.writerow({'row_type':'campaign','path_id':'ALL','turn':'ALL','request_count':len(calls),**totals,'provider_latency_ms':sum(c['latencyMs'] for c in calls),'finish_reason':'SEE_REQUEST_ROWS','status':'COMPLETED_WITH_FAILURES','billed_cost':'NA'})
# Fixed instruction and generation settings across all requests/pairs.
settings=lambda p:{k:p[k] for k in p if k!='messages'}
assert len({json.dumps(settings(d['payload']),sort_keys=True) for d in dispatch})==1
assert len({d['payload']['messages'][0]['content'] for d in dispatch})==1
checks={'generationRequests':40,'freeModelListRequests':1,'retries':0,'conversations':38,'dialogueRounds':34,'historySessions':6,'uniqueRequestIds':40,'providerUsageAvailable':40,'allUsageSumsReconciled':True,'referenceSentToModel':False,'referenceExclusionBasis':'Runner opens only dispatch-order.json and 03 synthetic history; scoring file first read in separate evaluator process. Payloads frozen before scoring.','foreignHistoryRowsSent':0,'sameSystemInstructions':True,'sameGenerationOptions':True,'options':settings(dispatch[0]['payload']),'immutableBackendVersion':'NA: API reports only deepseek-flash alias','totals':totals,'finishReasons':dict(collections.Counter(c['reply']['choices'][0]['finish_reason'] for c in calls)),'warnings':['Full-history baseline uses test-only provider transport after capturing App prompt template, bypasses App input envelope and output validation. Not old App or App E2E.','Current-selection route uses real selector + PGlite-authorized snapshot + real in-process HTTP controller; browser/App entry orchestration not tested.','Ledger price constants are test accounting from handoff, not verified current provider billing; actual monetary charge NA.','Adapter maps original rows into facts; feedback prose/sleep missingness are not fully transmitted by current selector. Results do not establish importer or scientific validity.'],'codeCommit':'ca5d7dbf76adbcb957d7c8548fa4d851056c681b'}
key=os.environ.get('DEEPSEEK_API_KEY','').encode();files=[work/'run.ts',work/'provider.py',work/'calls.jsonl',work/'dispatches.jsonl',dest/'RESULTS.jsonl',dest/'TOKEN.csv']
assert key and all(key not in p.read_bytes() for p in files);checks['secretValueFoundInArtifacts']=False
(dest/'audit.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
table=[]
for case in ['T01','T02','T03']:
 a=next(r for r in results if r['case_id']==case and r['mode']=='ALL_HISTORY');b=next(r for r in results if r['case_id']==case and r['mode']=='CURRENT_SELECTION')
 table.append(f"| {case} | {a['usage']['prompt_tokens']} / {a['usage']['completion_tokens']} / {a['usage']['total_tokens']} | {b['usage']['prompt_tokens']} / {b['usage']['completion_tokens']} / {b['usage']['total_tokens']} | 两种均未完成；有效效率比较 NA |")
summary=f'''# 新题与 Token 对照：真实运行结果

指定 commit：`{checks['codeCommit']}`。运行模型 `deepseek-flash`，temperature 0.4，max_tokens 900，JSON输出；不自动重试、不做补查。供应商仅返回模型别名，无法确认不可变后端版本。仅使用题包合成资料。

## 用量

完成34轮题目对话及6个独立历史会话，共40次真实生成请求、38个会话；另有1次免费模型列表GET。失败全部计入，无重试。

输入 {totals['prompt_tokens']:,}；输出 {totals['completion_tokens']:,}；合计 **{totals['total_tokens']:,} token**。输出内推理 {totals['reasoning_tokens']:,}，不得重复加到总量。缓存命中输入 {totals['prompt_cache_hit_tokens']:,}，未命中 {totals['prompt_cache_miss_tokens']:,}。供应商未返回货币账单，实际费用 NA；宿主测试账本价格不是当前官方计费凭据。

TOKEN.csv有40条请求、38条会话汇总和1条全局汇总；不同row_type不可叠加。所有供应商usage已逐项复算。

## 结果

34轮题目：HTTP接受2轮（Q08-A工程初评符合题意、专业项待复核；Q15-A部分完成且措辞受损），其余32轮OUTPUT_REJECTED；并非32轮都代表原始模型算错。Q11两条路径的首轮和更正轮均独立保留。模型输出finish_reason统计：{checks['finishReasons']}。

历史6会话均未产生可验收的完整答案；0个可比成功配对，3个失败配对。以下是所有尝试的实际量，不是达到质量门槛的节省比例。

| 题目 | 全量输入 / 输出 / 总token | 当前选择输入 / 输出 / 总token | 质量状态 |
|---|---:|---:|---|
'''+ '\n'.join(table)+'''

## 发现的问题

1. 推理占用900输出上限，多次finish_reason=length且正文为空或JSON残缺。Q01-A的900输出token全部为推理；不应把HTTP成功或已计费当成有回答。
2. 用户题面没有被提取成可引用来源：例如Q01-B原始回答算出1200米和314秒，但引用不存在的USER_DECLARED来源，控制器拒绝。system又禁止自行计算个人剂量，数学任务与引用/计算契约存在冲突；需结合本地确定性计算链路处理，不能靠放宽校验掩盖。
3. Q15-A删除违规片段后留下“；；。”和断句，HTTP仍接受；一次可用训练的任务未清晰完成。
4. T02含“最近”与“今天恢复”，日期解析把训练范围缩至当天；上下文未保留KEY-R1、KEY-R2和KEY-S1的训练结构。0条当日训练不代表近期没练。
5. feedback notes中的原始描述和睡眠未记录细节不能被当前factRecords完整传递；仅有结构化区域/量表不足以还原题包。适配器局限与选择器字段遗漏均记录，不将实验导入包装为正式产品导入能力。
6. T03预算选择没有完整保留两次跑步明细，不能确认模型实际收到两次配速比较所需全部证据。

## 测试边界

当前选择：隔离内存PGlite保留245条原始行，分人读取；映射后调用现有selectOnlineContext、授权快照及真实进程内HTTP控制器。不是浏览器点击验收，也未覆盖完整App用户入口/联网设置/客户端二次校验编排；不得称数据库至浏览器端到端通过。映射未制造RPE、疼痛严重度或重量口径，时区/版本/合成导入回执见import-receipt.json。

全量：测试适配器从相同存储读取SYN-A的244条原始行，以相同系统指令和生成设置发送；不含SYN-B。它绕过生产上下文大小与输出恢复约束，直接保留供应商结果，是测试模式对照，不是旧版App，也不计为App HTTP通过。因两种模式均失败，不发布有效节省率或产品提升结论。

参考答案仅在独立评估脚本中读取；被测runner只读取调度题面和合成历史，不读取评分文件。实际请求正文、哈希和回执保存在dispatches.jsonl与calls.jsonl；无密钥值。工程评分由本助手完成，未使用额外付费裁判、未获独立专业人员复核。失败回答按未完成计0分，不等于证明其全部安全推理错误。

本次离线源码快照校验通过；包校验通过；34个相关测试文件318项通过；npm run typecheck通过。没有运行生产迁移、合并、PR、发布或push；未修改产品源码。不以这些离线回归替代真实模型质量结论。未运行全仓测试或构建/浏览器验收。
'''
(dest/'SUMMARY.md').write_text(summary)
for name in ['calls.jsonl','dispatches.jsonl','import-receipt.json','run.ts','provider.py','report.py']:
 shutil.copyfile(work/name,dest/name)
print(json.dumps({'calls':40,'totals':totals,'finishReasons':checks['finishReasons'],'history':table,'scored':40},ensure_ascii=False))
