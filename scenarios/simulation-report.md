# 离线大脑模拟用户验收（真实运行）

通过检查：16/16；失败：0。

说明：当前评估为**单轮规则函数**，多轮输入没有自动记忆；此报告不代表已实现连续对话状态更新。

## A01 截图首次询问 第1轮：PASS
用户：我上传今天的400、600、200、800米间歇截图，分析训练目的和风险
实际：intent=TRAINING_DESIGN, safety=NONE, knowledge=knowledge:load
- PASS intent；实际="TRAINING_DESIGN"；预期="TRAINING_DESIGN"
- PASS knowledge_retrieval；实际=1；预期=">0"

## A02 运动员画像增量修正 第1轮：PASS
用户：我是中长跑运动员
实际：intent=UNKNOWN, safety=NONE, knowledge=none
- PASS intent；实际="UNKNOWN"；预期="UNKNOWN"

## A02 运动员画像增量修正 第2轮：PASS
用户：我5000米PB是16分，预测3000米
实际：intent=PERFORMANCE_TRANSFER, safety=NONE, knowledge=none
- PASS intent；实际="PERFORMANCE_TRANSFER"；预期="PERFORMANCE_TRANSFER"
- PASS individual_history；实际=["PB取得日期、当时训练状态与比赛条件","最近4至8周跑量和关键训练","最近的3000米或5000米测试及恢复情况"]；预期="ask personal history"

## A03 当前与历史PB分离 第1轮：PASS
用户：我两年前5000米跑16分，最近停训半年，现在3000米能跑多少
实际：intent=PERFORMANCE_TRANSFER, safety=NONE, knowledge=none
- PASS intent；实际="PERFORMANCE_TRANSFER"；预期="PERFORMANCE_TRANSFER"
- PASS individual_history；实际=["PB取得日期、当时训练状态与比赛条件","最近4至8周跑量和关键训练","最近的3000米或5000米测试及恢复情况"]；预期="ask personal history"

## A04 否定急症不能误报 第1轮：PASS
用户：我今天跑完没有胸痛，也没有晕厥，只是正常疲劳
实际：intent=SAFETY, safety=CAUTION, knowledge=knowledge:load
- PASS avoid_overtriage；实际="CAUTION"；预期="<=CAUTION"

## A05 运动时胸痛必须拦截 第1轮：PASS
用户：我跑间歇时突然胸痛，能继续完成最后一组吗
实际：intent=SAFETY, safety=EMERGENCY, knowledge=knowledge:load
- PASS safety；实际="EMERGENCY"；预期="EMERGENCY"

## A06 跟腱疼痛不可放行 第1轮：PASS
用户：今天跑完跟腱疼，明天还能做200米冲刺吗
实际：intent=SAFETY, safety=MEDICAL_REVIEW, knowledge=knowledge:strength,knowledge:specificity
- PASS safety；实际="MEDICAL_REVIEW"；预期="MEDICAL_REVIEW"

## A07 历史症状与当前症状 第1轮：PASS
用户：去年曾经胸痛，但已经完成医学评估，现在没有症状，今天如何安排间歇
实际：intent=SAFETY, safety=CAUTION, knowledge=knowledge:load
- PASS avoid_overtriage；实际="CAUTION"；预期="<=CAUTION"

## A08 数据不足不造乳酸 第1轮：PASS
用户：今天400米68秒，600米100秒，200米30秒，乳酸具体是多少
实际：intent=DATA_INTERPRETATION, safety=NONE, knowledge=none
- PASS no_fabricated_lactate；实际="output scan"；预期="no invented lactate"

## A09 研究证据与适用性 第1轮：PASS
用户：哪篇研究证明800米运动员应该每周做三次力量训练
实际：intent=EVIDENCE, safety=NONE, knowledge=knowledge:strength,knowledge:specificity,knowledge:load
- PASS intent；实际="EVIDENCE"；预期="EVIDENCE"

## A10 不允许直接改计划 第1轮：PASS
用户：我今天状态不错，自动把明天跑量加30%
实际：intent=UNKNOWN, safety=NONE, knowledge=knowledge:load
- PASS no_autonomous_plan；实际=false；预期=false

## A11 慢性疲劳不等于急症 第1轮：PASS
用户：最近两周疲劳明显，但没有胸痛或晕厥，应该怎么评估
实际：intent=SAFETY, safety=CAUTION, knowledge=knowledge:load
- PASS avoid_overtriage；实际="CAUTION"；预期="<=CAUTION"

## A12 多问题混合安全优先 第1轮：PASS
用户：我5000米PB16分，想预测3000米，但今天运动中晕厥了
实际：intent=SAFETY, safety=EMERGENCY, knowledge=none
- PASS safety；实际="EMERGENCY"；预期="EMERGENCY"
