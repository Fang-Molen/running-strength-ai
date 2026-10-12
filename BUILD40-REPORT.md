# BUILD 39–40 · 方坤受控计划编辑 + 本地设备证据识别（2026-10-11）

## 实际交付

以 `running-strength-build38-controlled-plan-candidate.zip` 完整源码为基线修改，保留原有 React/TanStack PWA、localStorage 历史训练与营养记录、V3.3 安全规则、BUILD33/34 安全分类文件和原有网络开关。未部署，未覆盖线上版本。

### 1. 受控解冻：未来力量计划单动作减一组

- `coach-strength-plan-control.ts`：生成带计划原始 JSON 快照的提案；仅允许一个力量动作组数减少1，不改重量、次数、跑步课、训练事实、既往日志；已完成本周期训练、今日已开始训练、未解除的疼痛/近期 PAIN_RECORDED、安全信息缺失等情况阻断；用户逐项勾选并二次确认。
- `coach-strength-plan-storage.ts`：同一个 `fr255-strength-plan-v3` JSON 中保存新计划和完整审计，写入前核对原始原文，写入后读取校验；拒绝过期提案和审计修订不匹配；React 父组件成功保存后才更新 UI。
- `coach-strength-edit-panel.tsx`：可选课程/动作、原组数→新组数、风险说明、三项明确确认、保存与最近一次撤销。撤销生成新修订，旧审计不删。
- 仅在浏览器有 `navigator.locks` 时允许写入，避免部分多标签冲突；但**旧版手动编辑器没有加入同一互斥锁，因此不能宣称跨标签完全原子安全**。此功能仍仅供独立预览，不应在正式用户数据上直接推广。
- 新的 `coachEditHistory` 是嵌在计划 JSON 中的审计，不是防篡改服务器日志。更换计划模板时保留历史字段。旧备份可包含该字段。

### 2. 无付费模型的设备截图与训练明细

- `device-image-evidence.ts`：保守解析睡眠时长、HRV(ms)、静息/平均心率(bpm)、体重(kg)、体脂/血氧(%)、跑步每段距离/用时/恢复/心率、力量动作/组号/重量/次数；有界校验、重复值提示、来源行号、手动编辑状态；不猜缺失值、不诊断。
- `device-evidence-import.tsx`：拍照/选原图，浏览器支持 `TextDetector` 时可尝试**本地 OCR**；不支持时可直接粘贴/手动转录图片文字。所有提取值必须校对、指定设备与带时区的采集时间、勾选确认后才能保存。可添加、修改、删除条目。
- `device-evidence-idb.ts`：原始图像 Blob 与结构化证据存储在同一 IndexedDB 事务对象中；基于内容的 ID 去重，支持回看、JSON/原图单独导出。
- 在方坤聊天滚动区和训练上传页增加入口；**不向任何服务端上传图片，不调用线上模型，也不会自动写入正式身体/训练事实或改变教练决策**。
- iOS Safari 等不支持 `TextDetector` 的浏览器无法自动 OCR；手动转录可用，但**不能把它称为已实现的通用 iPhone 识图**。未接通独立联网 OCR 供应商；需要经过隐私授权、服务端代理、凭据保护及真实服务验收后再开放。
- IndexedDB 证据目前**不在现有“个人与数据”localStorage 总备份中**；提供每份 JSON/原图导出，未来需集成完整备份与恢复。

### 3. M3/M7 证据边界

- `coach-learning-readiness.ts`：M3 个人响应候选必须至少3次不同训练、相同上下文、每次有绑定的整课 RPE 和24/48小时恢复反馈；疼痛或互相矛盾则 CONFLICT。候选始终是低置信度，不赋予自动加量权限。
- M7 只读投影将用户确认的预览计划修改审计映射为推理历史，明确不是自动决策。**尚未形成完整持久化 M3/M7 自动学习链**。

## 真实测试

- Node.js 22：`node --experimental-strip-types --test` 运行8个定向测试文件：**88/88 PASS**，日志 `qa/BUILD40-TESTS.log`。包含原 BUILD38 事务、BUILD37 权限、网络开关、四种人格和本轮新解析/计划/M3边界测试。
- TypeScript transpileModule 对11个主要修改文件进行语法解析：**11/11 无语法诊断**，**不是完整类型检查**。
- `tsc --noEmit`：因本工作区未安装依赖/类型（缺 `node` 和 `vite/client`）无法执行完整 typecheck。`npm view` 因 DNS EAI_AGAIN 无法获取 npm 依赖。**Typecheck NOT TESTED / Build NOT TESTED**。
- 尝试本地 Chromium `--headless --dump-dom` 做 IndexedDB 页面冒烟测试，环境启动超时，未得到 DOM 结果。**IndexedDB 真浏览器测试 NOT TESTED**，iPhone/PWA NOT TESTED。
- 没有真实截图 OCR 识别率基准；现有 33 条解析测试针对文字输入，不是图像 OCR 测试。

## 下一阶段必须完成（给 Grok 预览环境）

1. `npm ci`，执行 `npm run typecheck`、`npm run build`、原全量回归；修复真实编译错误，不能以语法解析代替。
2. 浏览器端实际验证：上传 JPG/PNG、`TextDetector` 有无时的行为、校对、IDB 原图保存与导出、刷新、重复确认、存储失败、iPhone 390px/414px、离线。
3. 受控计划：旧标签冲突、浏览器 Web Locks 不支持、刷新、存储配额失败、疼痛、已开始训练、重复确认、撤销、模板替换审计、真实多标签测试；未验证前保持预览功能限制。
4. 在用户授权下设计独立 OCR 服务端代理（仅传本次指定图像；不开启时绝不发送；密钥只在服务端），或打包可离线运行的 OCR 引擎；需真实测试中文手写与设备截图，不可编造识别率。
5. 将 IndexedDB 纳入完整备份与恢复，必要时由用户主动确认后才将证据绑定训练 occurrenceId 或身体记录；保持 M0事实/M3个人响应/M7推理的分层。
6. 禁止未经额外部署授权覆盖正式线上 App；保留原始 ZIP 回退包。

**状态：候选源码已修改，定向测试通过；完整构建/浏览器/iPhone/网络 OCR 均未验收。**
