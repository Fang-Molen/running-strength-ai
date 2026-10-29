from pathlib import Path
import json,csv,hashlib,shutil
from collections import Counter
p=Path(__file__).resolve().parent;root=p.parents[1]
rows=[json.loads(x) for x in (p/'injection-results.jsonl').read_text().splitlines()];gate=json.loads((p/'gate-report.json').read_text());metrics=json.loads((p/'METRICS.json').read_text());commit=rows[0]['candidate_commit'];assert all(r['candidate_commit']==commit for r in rows)
review={r['case_id']:r for r in map(json.loads,(p/'review-results.jsonl').read_text().splitlines())};statuses={r['case_id']:r['status'] for r in gate['results']}
old=[json.loads(x) for x in (p/'legacy-replay-results.jsonl').read_text().splitlines()];assert all(r['candidate_commit']==commit for r in old)
trials=[]
for f in sorted(p.glob('injection-adapter-attempt*.jsonl'))+[p/'injection-results.jsonl']:
 rs=[json.loads(x) for x in f.read_text().splitlines()];trials.append({'file':f.name,'cases':len(rs),'mock_dispatches':sum(r.get('provider_reply') is not None for r in rs),'mock_usage_unknown':sum(r.get('provider_reply') is not None and not r.get('synthetic_usage') for r in rs),'real_requests':0,'real_tokens':0})
usage=json.loads((p/'USAGE.json').read_text());usage.update(real_incremental_api_fee=0,real_currency='NA_NO_NEW_CALLS',historical_real_generation_requests=105,historical_real_total_tokens=312883,historical_real_bill_amount=None,historical_bill_note='Supplier invoice unavailable; retain historical TOKEN.csv; no fabricated price-based bill.',codex_session_cost=None,codex_cost_note='This runtime has no access to the user-facing Codex token/billing ledger.',all_recorded_injection_runs=trials,recorded_mock_dispatches_total=sum(x['mock_dispatches'] for x in trials),actual_supplier_reasoning_tokens_on_final_version='NOT_APPLICABLE_NO_REAL_GENERATION',old_paid_budget_stop_unchanged='verification/new-questions-20261029/completion-run/STOPPED.json')
(p/'USAGE.json').write_text(json.dumps(usage,ensure_ascii=False,indent=2)+'\n')
with (p/'PER-CASE-USAGE.csv').open('w') as f:
 w=csv.writer(f,lineterminator="\n");w.writerow(['case_id','mode','real_requests','real_input_tokens','real_output_tokens','real_reasoning_tokens','mock_input_tokens_NOT_REAL','mock_output_tokens_NOT_REAL','mock_usage_state'])
 for r in rows:
  u=r.get('synthetic_usage');w.writerow([r['case_id'],r['mode'],0,'NA_NOT_RUN','NA_NOT_RUN','NA_NOT_RUN',u.get('prompt_tokens') if u else '',u.get('completion_tokens') if u else '','KNOWN_MOCK_ONLY' if u else ('UNKNOWN_MOCK_USAGE' if r.get('provider_reply') else 'NOT_DISPATCHED')])
(p/'CODE-VERSION.json').write_text(json.dumps({'baseline':'0fd2e5fd21854cd6453a33db5312f47b52cdf5d4','frozen_candidate':commit,'branch':'test/load-memory-20261029','later_artifact_only_commits_may_follow':True,'production_status':'NOT_MERGED_NOT_PUBLISHED_NOT_DEPLOYED'},indent=2)+'\n')
case_lines=[]
questions={r['case_id']:r['question'] for r in map(json.loads,(p/'input-package/candidate/cases.jsonl').read_text().splitlines())}
for r in rows:
 k=r['case_id'];rr=review[k];case_lines.append('|'+ '|'.join([k,questions[k].replace('|','/'),r['decision'],str(sum(q['status']=='PASS' for q in rr['checks']))+'/3',statuses[k],('待专业审核' if rr['professional_review']['status']=='PENDING' else '不要求')])+'|')
(p/'PER-CASE.md').write_text('# 逐题结果（离线注入，不是真实模型生成）\n\n冻结提交 `'+commit+'`。每题原始输入/规范证据、供应商模拟输入输出、最终正文、过滤原因和hash见 `injection-results.jsonl`；每个criterion的初核身份/证据见 `review-results.jsonl`。PASS是本工程初核范围内符合，PENDING不是通过。专业审核不由代码或模型代签。\n\n|题号|问题|控制器最终决策|工程criteria通过|记录门槛|专业审核|\n|---|---|---|---|---|---|\n'+'\n'.join(case_lines)+'\n')
legacy_notes={'Q10-B':'已记录9公里与全年覆盖未知分开；旧虚假不完整断言去除。','Q12-A':'配速比较和原计划30分钟条件建议保留。专业适用性未签审。','Q12-B':'慢速比较与原计划条件建议保留。专业适用性未签审。','Q14-A':'保留有用安排框架/缺项；没有足够能力资料形成完整个人计划，仍PARTIAL。','Q14-B':'目标/赛期/可用时间保留，补框架与缺项；仍PARTIAL。','Q15-A':'识别“分析安排”，不放行两次硬塞一次；补重建框架/优先级/恢复间隔和确认点，未替用户选课或改日历。','Q15-B':'容量与计划保留，不把计划当实绩；没有完成个人课表设计。','T02-CURRENT_SELECTION':'近期3课、10公里、力量、右小腿反馈、睡眠缺项及覆盖未知保留；医嘱/许可不虚构。','T02-ALL_HISTORY':'同轮近期关键事实保留；用human投影替代内部UNKNOWN/PAIN。不证明新模型理解长历史。'}
(p/'LEGACY-REPLAY.md').write_text('# 9条保存真实回复的下游复验\n\n没有新增模型调用；保留原始真实请求/usage回执引用，旧答→新答和原始JSON在 `legacy-replay-results.jsonl`。原模型当时所见证据不被改写。新版请求语义已变，重放不能当作新版本真实生成通过。\n\n|路径|新决策|初核与限制|\n|---|---|---|\n'+'\n'.join('|'+r['path_id']+'|'+r['answerGate']['decision']+'|'+legacy_notes[r['path_id']]+'|' for r in old)+'\n')
related=json.loads((p/'related-tests.json').read_text());assert related['candidate_commit']==commit
summary=f'''# 方坤回答校验 V1：修复与验收结果

冻结代码：`{commit}`；基线：`0fd2e5fd21854cd6453a33db5312f47b52cdf5d4`；分支：`test/load-memory-20261029`。这是测试分支交付，没有合并、PR、发布或生产部署，全部使用合成数据。

本轮软件修复和已授权离线验收已执行。**没有达到整体放行条件**：50条注入全部执行，最终决策50/50在冻结rubric允许范围；逐项工程初核140/150符合、10项尚未证实，记录门槛33通过、17待完成、0失败。7条专业必审均未签审。上述“通过”仅限初核证据范围，不能等同独立语义、专业或真实生成通过。

## 用量

本轮新增真实 DeepSeek **0请求、0 tokens，增量API费用0**。最新包默认离线，建议的24次真实抽样不是新费用授权；此前正式回归50次预算仍封存，没有修改 `STOPPED.json`。历史真实生成105次、312,883 tokens单独保留，实际账单金额NA，推理tokens未返回的历史请求仍记NA。Codex会话费用本环境不可读取，未以0冒充。

最终50题实际模拟派发49次（撤权题未派发），其中1次模拟usage缺失，控制器以 `PROVIDER_USAGE_UNKNOWN` 失败并保留未知状态，不计成供应商0用量。所有已保存开发尝试另列 `USAGE.json`，不把mock tokens算作真实供应商用量。逐题新用量见 `PER-CASE-USAGE.csv`；旧逐请求真用量保留原 `TOKEN.csv`。

## 验证结果

|检查|结果及边界|
|---|---|
|相关确定性/服务端/客户端/UI单元回归|{related['pass']}/{related['tests']}，{related['files']}个文件；最终提交同版。早先一次V8/PGlite JIT进程崩溃和单独重跑日志均保留。|
|测试包自检|23/23；题包50题/150标准/7专业必审；原MANIFEST哈希全部一致。|
|50题离线真实控制器注入|HTTP 200为46条，502为3条，撤权503为1条；这是状态/协议结果，不是46条语义通过。|
|最终决策|{json.dumps(metrics['controller_decisions'],ensure_ascii=False)}|
|空正文/截断或歧义JSON误判成功|本固定注入集0/50空正文成功；length和重复键两例0/2被当成功；不是现实风险为零。|
|9条旧真实回复重放|逐条旧/新正文及原paid receipt保留；见 `LEGACY-REPLAY.md`。没有新模型生成。|
|类型检查/构建|`npm run typecheck`通过；`build:dev`通过。未运行包含数据库迁移的生产build。|
|实际浏览器|真实App+HTTP+隔离SQL+模拟供应商：并发两问、OFF/重载、症状下科普、选中40/50排除90kg、更正45kg使旧答过期、取消A/B保留和重连不自动重试；320/390/430×100%/200%共6组可见性/无横向溢出。|
|界面实见修复|校验后的完整正文不再被旧摘要折叠；320/200%时快捷记录浮钮遮挡输入已修复；最终源码/静态构建预览均检查。|
|全仓npm test|修改前的90c1129运行中，脚本237/237、基础63/63、第三段602/605；`makeup.test.ts`3项失败，在0fd2e5f基线隔离重放同样3项失败，后续链条未运行。最终增加安排识别后只重跑上述相关回归，不能声称全仓全绿。|
|全仓lint|已有记录5259 errors/535 warnings，未完成全仓格式清理；不声称lint通过。|

浏览器没有连接真实DeepSeek、真实食品登记、真实网页搜索或真实手表；服务工作线程被测试夹具禁用，开发热重载事件被记录并屏蔽，不代表生产离线缓存验收。真实手机键盘/输入法和设备导入不在已验证范围。模拟控制器延迟p50/p95见 `METRICS.json`，不能当API延迟。

## 已修复的问题

- DS-01/协议：逐次finish_reason、输出上限、usage记录；禁止空正文、length、半截/重复键JSON成功，保留输入，无自动重试或无限修复。真实供应商新版生成仍待预算。
- DS-02：四个原算术错误复现后修复：并列、秒舍入、连续更正、完成但未计时；保留题目和答案版本，来源校验没有放宽。米/公里等价、9公里覆盖未知、原始精度差异均有确定性检查。
- DS-03：近期反馈、关键课、疼痛与反证进入证据/请求/最终答，未知不再变成医学限制或漏记事实；Q10-B/T02重放可追溯。完整真实设备导入链未验收。
- DS-04：旧长历史请求/输出原始材料保留，本轮选定T02双路径下游复验；历史三组关键事实3/3是旧真实测试结论，不能改称最终版本三组新生成全过。
- DS-05：Q15不再裁半截句；无依据合并负荷整组移除并重建有用安排框架；补“分析安排”任务识别。Q08专业复核未签审。
- DS-06：逐题/逐请求输入输出、计算来源、hash、finish、token字段、旧receipt与失败尝试可查；缺失推理usage不补0。
- V1：来源/类型标签不授予事实权限，计划/实绩/剂量分离，条件行动停止组原子处理与循环检测，所有宿主追加统一回门，客户端对当前资料/授权/hash/任务复核，检索状态与偏好分离、只读回执核对、持久部分/待审提示。
- 独立AI代码审查7个反例已RED→GREEN；不是人类专业审查。详见 `review_protocol.md` 与原日志。

## 尚未放行的项目

{', '.join(x['case_id'] for x in gate['results'] if x['status']=='PENDING')}。

7条专业审核：G004/G010/G035/G036/G040/G043/G046。其余未证实内容包括真实网页来源、实际登记持久幂等与超时对账、旧账号真实写入隔离、设备卡片/详情口径联通、睡眠重同步入口、摘要占位题的实际知识正文以及缓存专项证明。逐项身份/证据/状态见 `review-results.jsonl`。新实现的是可信只读工具端口及校验，不是接入了不存在的外部服务。

缺少独立盲审的候选误损率、漏放率、任务保留率、修复有效率、逐声明准确率一律为null；没有用同一实现自证100%。最终版本34轮+6会话真实生成未重跑，不能给整体能力通过率或发布许可。

## 文件与复验

`PER-CASE.md`为50题逐题表；`injection-results.jsonl`含实际模拟请求输入、规范上下文、原输出、最终正文、原因、trace/hash；`review-results.jsonl`逐criterion；`legacy-replay-results.jsonl`含9条原始/旧/新答；`USAGE.json`和CSV区分真实/模拟；`browser/`为脚本、请求日志与截图；`logs/`保留包括失败的尝试。

复验：`python verification/validation-gates-v1-20261029/run-related.py`；离线注入和旧答重放以`FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs`分别运行`run-injection.ts`和`replay-legacy.ts`。参考与rubric只在评测侧使用，不能拼入真实模型提示。

打包提供基线到冻结提交的补丁、所有变更源码及测试材料；在已有仓库/依赖上应用，不包含node_modules或全部未改动大资源。监控与安全回退见 `OPERATIONS.md`。没有密钥值、用户数据或付费重试配置。
'''
(p/'SUMMARY.md').write_text(summary)
print({'frozen':commit,'review_counts':gate['counts'],'related':related['tests']})
