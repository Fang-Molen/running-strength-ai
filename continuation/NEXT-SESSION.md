# 更新：本保存点已于续接后推进

当前结论请先读 `docs/implementation-20261028/DELIVERY.md`、`remaining-work.md`、`continuation/SNAPSHOT.json` 和外置交付 receipt。下文保留额度暂停时的历史清单，不应作为最新测试状态。不要覆盖当前更完整源码。下一步优先完成构建产物启动/渲染验证，再按54项矩阵补齐真实剩余需求；不付费、不部署、不改用户数据。

---

# 方坤续接保存点 — 2026-10-28

用户因每周额度仅剩6%、额外额度0，要求保留任务待额度刷新继续。本轮在此暂停新增开发。截图显示周一14:22重置；时区以用户页面为准。不得称整个任务完成。刷新后用户说“继续方坤任务”时，直接从此续接，不重新开发、不重复读全部历史包。

## 工作区及授权
- 工作区 `/workspace/fangkun-20261028`；分支 `codex/always-online-20261028`。
- Git HEAD `149c11f17ed2696ab29bf098911e3f54640f1e4d` 是交接源码导入基线。本轮实现保存在未提交工作区及同目录外的源码归档、完整差异。不要 reset/clean，不要覆盖或删除未提交文件。
- Git父基线为此前交付 `de6bc5f`。最新已读GitHub master为 `fb6d614bf2d0c196408055baa3a632d54951ac9d`，旧PR5已由外部合并；交接声称`0d4293b`没有Git元数据且远端查不到，仍未核验。若以后发布，先核对新主线并保留全部有效改动。
- 本轮批准设计：`docs/implementation-20261028/implementation-plan.md` Tasks0–10及 `full-specification.txt` 的54项。正常问题自动联网，不逐问许可；持久OFF必须尊重；正式写入仍预览/确认/版本/幂等。
- 不付费调用、不连接真实账号或生产数据库、不部署，不删除用户记录或内置个人V4。保留既有模型答卷、失败例、UI、用户计划和历史。其他环境历史费用仍待核对，不得按零。
- 用户要求工作期间每30分钟汇报。已在约04:04、04:34 UTC汇报；暂停后不承诺后台自动恢复。恢复工作重新计时。

## 已落地的主要代码（具体文件见 WORKTREE-STATUS.txt）
1. 分块备份SHA校验、范围说明、IDB事务/镜像失败回执、各导入入口统一守卫。浏览器只暂存隔离候选，因不能强制隔离冻结旧标签，未连接主动覆盖恢复。纯恢复事务/重启回退引擎有故障注入测试，不能据此宣称完整浏览器恢复已实现。
2. bulk-store：写盘失败抛错、删除广播清缓存、待写竞争保护/延迟刷新、等待动态队列尾、同一替换事务读取真正旧值备份。
3. 更正事实与复核意图同存；启动幂等重试、读时来源校验、未知待重审；VOID审计失败后同毫秒RESTORE不会恢复旧解释。新冲突来源先经已有审核投影隔离。初次来源捕获失败仍为待处理，不伪装fresh。
4. 主体/时间/否定/任务语义；旧腿部限制不吞一般知识或无关上肢问题；旧待确认卡不能清除明确医疗限制。
5. 自动在线UI，每问独立生命周期；持续许可开关同步；来源依赖复核、旧回答标过期。服务端003迁移分离持续许可/单次快照；实际schema探测、并发/费用保护。共享断言校验替代旧一概放宽；一般科普数字可通过，个人伪造数字/错误单位/诊断/越权写入/检索声称受限。输出中的活动也按限制检查。模型仍没有写正式计划权限。
6. 按问题选择本人实际资料、分段/组次、目标/计划/恢复/饮食；保留来源、时间、修订和未知，普通知识无个人数据依赖。完整记录裁减及4800引用字节预算；真实本地selector→HTTP→controller假服务测试发现并修复了旧300字符来源限制和4000/8000路由问题。
7. 周期请求明确1–52周，月歧义先澄清；取消固定每第四周减量。六专项现有熟悉课程检索排序和来源/结构完整性；阶段进入/退出条件的SATISFIED/UNKNOWN/CONTRADICTED仅表示资料状态，不证明生理达标。新阶段面板和专项实际输出已落盘。
8. 私教方案按身体/目标/餐食/训练/限制依赖复核；过期候选、拒绝、确认前重验，目标冲突不静默维持旧减脂方案。
9. 历史较早/较后可比片段的描述性方向复核，避免滚动均值掩盖变化；同设备/协议/单位分段、同日去重、更正重算，保留表现反证。不新增医疗阈值或安全放行。
10. 修复boot把已认证身份重置local；更新已过时的hydration测试首屏断言（页面当前有存储启动闸口），保留所有首屏不暴露个人记录断言。

## 最新验证现状
局部RED/GREEN和实际合成输出集中在 `verification/implementation-20261028/`。不要累计多次运行数量作为完成率。主代理亲自运行过integration typecheck成功，但之后又有根因修复和cycle/trajectory变化，最终类型/构建/集中回归尚未完成。
- root：online-session13、online-service11、legacy sharedguard9、bulk16+额外迁移1、boot身份1、hydration1、correction conflict1局部通过；此前correction4、restore engine9、isolated candidate3通过。核对各log退出证据，不能代替最终组合运行。
- 后端：隔离PGlite、签名合成身份、实际HTTP/controller、假上游；76局部回归及后续selector/schema/输出活动限制用例有各自日志。真实模型/专家评估均未执行。
- 语义：609局部断言之后又补旧ACCEPT和纠错闭环；并非最终全回归。
- 周期：最新event-selection/stage/core/adaptive/review-findings/SSR共83局部断言，代理报告typecheck退出0；仍需看最终日志。
- trajectory：8新增+84邻近断言，实际输出在 metric-trajectory/actual-outputs.json。
- 私教：19核心/面板SSR/画像及24旧用例通过；浏览器未完成。
- baseline build:dev因沙箱拒绝本地监听EPERM失败，未作为代码失败。当前具有本地网络权限的构建还未完成。
- browser：`backup-integration/browser-scenarios.mjs`、`online-browser/browser-harness.ts`、`personal/panel-browser.mjs`已准备；权限等待/进程暂停发生在额度保存点，所有浏览器验收未收齐，不能标PASS。

## 恢复后按此顺序做
1. 读本文件、SNAPSHOT.json、WORKTREE-STATUS.txt、progress.md；核对git差异，保留工作区。不要从压缩包覆盖当前更完整文件。
2. 收尾边界：root CoachOnlineRequest prepare失败catch需核对manual retry可见性；StrictMode延后首请求和并发消息functional update刚加入，需实际浏览器确认。当前调用sharedvalidator已传question/restrictions。确认新输出活动限制和一般知识无资料读取路径。
3. 检查cycle代理最后写入的输出/54项矩阵，补规则EVENT_RETRIEVAL_1台账，更新remaining-work中已过时的bulk/构建/浏览器状态；不要删真实剩余限制。
4. 一次集中运行typecheck、受影响测试与项目回归、build:dev及build:server。生产 `npm run build`含db:migrate，禁止执行。构建清理共用输出，前端/后端构建不得并行；前端静态结果可先备份以做8081预览。
5. 实际浏览器桌面/移动：自动连问并发、OFF持久、否定/他人/旧限制与混合问题、相关更正失效而无关RPE保留；目标→候选→确认→完成/更正→过期→刷新/拒绝；备份候选暂存→重启→取回/下载、跨标签来源变化和IDB失败。真实外部请求一律拦截，使用已提供假服务，不用付费模型。
6. 对根因失败批量修复，只重测受影响部分，不无故重复全部。最终审阅实际差异、至少5组实际前后输出、54项矩阵和回滚说明；局部/合成/真实/专家评价分开。
7. 保存独立本地实现commit与最新完整源码/差异。当前用户未授权本轮新发布，不自动推送/合并/部署；有进一步明确授权再处理。

## 环境及工具
- Node24.19.0/npm11.9.0，node_modules软链到 `/workspace/fangkun-integration/node_modules`，锁文件一致。不需要重装依赖。
- 当前 `/workspace/startup.sh` 指向本工作区8080，显式unset DATABASE_URL/模型密钥、FANGKUN_DEEPSEEK_ENABLED=false；dev log `/tmp/fangkun-20261028-dev.log`。暂停后服务可能退出，恢复时先核对再启动。
- 默认shell沙箱隔离网络，Chromium/本地监听需exec_command `with_additional_permissions` + network.enabled=true；这仅用于本地运行。Chromium在 `/usr/bin/chromium`，参数`--no-sandbox --disable-dev-shm-usage`。避免权限工具长等待卡住沟通；functions.exec yield1000可保留cell再继续独立工作。
- 已暂停代理，不要同时让代理和root改同一文件。相关代理：coverage_audit_28、online_audit_28、storage_audit_28、online_backend_28、online_context_28。代理并行原由适用parallel技能与任务书明确允许；无需为例行实现再次问设计许可。
- 根基线和之前所有源码保留；生成的本轮checkpoint archive外置于 `/workspace/fangkun-checkpoints/`，不会递归打包自身。归档仅含Git跟踪及未忽略文件，不含node_modules、.git或.env等忽略项；详见SHA清单。
