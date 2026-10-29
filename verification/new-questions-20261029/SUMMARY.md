> 后续V1软件修复与离线复验已交付：[校验V1结果](../validation-gates-v1-20261029/SUMMARY.md)。本轮没有新增真实DeepSeek调用；以下是真实生成历史结果，保持原记录，不改写为新版生成通过。

# 方坤新题与Token对照 · 最新结果

已完成34轮题目 + 6个长历史会话的真实DeepSeek测量，**未全部通过**。

本次续测54次生成/184,405 tokens，其中冒烟4次/3,723，正式回归50/50次/180,682（含排错和补测）。没有自动重试，达到上限后付费调用已锁定。此前51次/128,478 tokens独立保留；历史累计105次/312,883 tokens。

34轮工程初评：27通过、2工程通过但专业待审、4部分、1失败。三组历史对照关键事实3/3通过。Q10-B有未知覆盖误说成不完整的问题，Q12-A/B、Q14-A/B缺少安排建议，Q08专业待审。没有声称最终同一提交40次付费全跑；最终版本用保存真实回复统一离线验证。

完整报告：[completion-run/SUMMARY.md](completion-run/SUMMARY.md)。逐轮正文与评分：[RESULTS.jsonl](completion-run/RESULTS.jsonl)。逐请求用量：[TOKEN.csv](completion-run/TOKEN.csv)。缺陷：[DEFECT-CROSSWALK.md](completion-run/DEFECT-CROSSWALK.md)。

历史材料：首次40次/118,507 tokens在`baseline-before-repair/`；上次修复11次/9,971 tokens在`repair/`。不得用新报告覆盖或隐去旧失败。

仅合成数据。参考答案仅评测侧读取；密钥仅环境变量。未合并、未开PR、未发布或部署。未做独立专业审核、浏览器或完整生产导入验收。
