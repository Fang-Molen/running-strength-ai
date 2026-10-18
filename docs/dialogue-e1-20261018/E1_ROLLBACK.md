# E1 回退

默认开关已为 OFF。关闭开关只停止 E1 内部预览，不会删除任何训练或对话记录。

本轮有完整基线 `rollback/before-dialogue-E1-20261018-source.zip`，以及文件 SHA256 清单。交付的 E1 增量回退包保存每个修改文件的旧版本和新增文件名单；仅在独立源码副本中按清单恢复，不覆盖运行中用户存储，不运行数据迁移。

若应用了之后的新修改，应先核对 afterSha256；有差异先逐文件合并，不整包强行覆盖。回退只恢复 E1 前源码，统一交接包的此前增量仍保留。回退后验证需等待用户统一测试授权。


## 2026-10-18 启用后回退点

`rollback/before-e1-activation-20261018-delta.zip` 保存启用前 5 个文件。可完整恢复此差异包；仅暂停 E1 时，将 `COACH_DIALOGUE_E1_FLAGS.coachDialogueE1` 改为 `false`，原回答路径仍可用。训练数据不需迁移。测试开始前完整源码基线为 `rollback/before-coach-capability-20261018-source.zip`。这些都是源码回退，不能用来覆盖用户数据。
