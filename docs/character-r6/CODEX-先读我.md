# 方坤 R6：健康 3D 与动作演示统一人物｜Codex 直接实施交接

## 用户冻结要求

**只允许今晚确认的两个人物：女性黑色运动内衣/短裤、高马尾、白鞋；男性黑色短袖/短裤、黑发、白鞋。** 参考图见 `patch/public/fangkun-character/*`。不得回到 v74/R4 的旧人物，也不能用第三方无关人体模型冒充新版角色。形象参考不是已绑定的 3D。需要独立制作的、权属可核验的 GLB 才可在健康区正式启用。动作库演示 **优先视频**，不强制实时 3D；同角色、同动作视频未经真人审核不得显示“可播放”。

## 工程文件

- `patch/src/lib/character/identity.ts`：男女统一 ID，3D/视频同源角色定义，严格审核清单。
- `patch/public/fangkun-character/viewer.js`：复用现有 Three.js runtime 的专用 GLB 查看器（前侧背/45°，鼠标拖动，真实蒙皮，形变支持）；不引用旧人体资源。
- `patch/src/components/fangkun-unified-character.tsx`：健康区实际可接的 React 组件，无审核模型时展示同角色设计参考图、明确标注非 3D。
- `patch/src/components/fangkun-unified-video.tsx`：动作视频播放器，按动作 ID + 性别 + 角色 ID 精确匹配，支持内联静音、循环、暂停和慢放。
- `patch/public/.../manifest.json` / `manifest-r6.json`：**当前有意为空**。已审核的新角色 GLB 0 / 已审核动作视频 0；不要自行写 APPROVED。
- `tools/publish_media.py`：检查 GLB 真网格+骨骼+蒙皮+四通道体型形变；视频 H264/fps/时长；两类发布都需可追溯授权和人工 QA。默认 DRY_RUN，不会部署。
- `docs/153-动作覆盖原表.csv`：动作 ID 清单；153 项均须独立素材映射，保留既有剂量、训练历史、教学文字。
- `preview/index.html`：可操作的手机预览（两个角色、四视角、训练分类/搜索、6个示意卡）。**仅 UI 原型，不是正式动作视频或真 3D**。

## Codex 安装顺序（本包只加独立新模块，不强行覆盖旧页面）

1. 当前仓库 `git status --short`，留下安全备份，并检查 R2/R4/R5 的集成现状。不要将本包 v74 或 R4 当作比仓库更新的版本。
2. 分别核对 `src/components/shape-sim-3d.tsx`、`src/components/bodylab/bodylab-panel.tsx`、`src/components/exercise-demo.tsx`、`src/components/exercise-editor.tsx`、`src/components/warmup-player.tsx`、`src/components/exercise-library.tsx`、`public/demo3d/body3d.js`。标记仍引用旧人物的所有 UI 出口。
3. 拷贝 `patch/` 里**新命名**模块与预览素材，注意不要无条件覆盖已有清单或用户创建的素材。健康区用 `<FangkunHealthCharacter gender={...} view={...} appearance={...}/>` 替换旧人物视觉层；保留既有训练数据、身体数据存储、外形参数存储和 3D 肌肉解剖筛选。
4. 动作视频入口替换为 `<FangkunExerciseVideo exerciseId={...} title={...} gender={...}/>`；运动页面与详情页不得再调用旧角色 `mount3d`。三入口搜索/分类/点肌肉、所有 153 个动作 ID 必须保持不变。
5. 在**已授权且外观合格**男女模型上传前，健康区的可见区域显示新版外观参考图 + 3D待制作说明；**3D 功能代码与接口保留，禁止显示旧角色代替**。单独进行新模型建模、绑骨、脚部接地和四形变通道审核。
6. 完成真人/动画动作视频制作和姿势审校后，逐条发布至 manifest；严格保证每个动作视频由正确的男或女角色完成。
7. 在当前最新版运行完整 typecheck、build、R190、UI70/UI72、Safari/Android WebGL 与 MP4 测试；通过且用户批准后才能部署。

## 硬性验收

- 角色身份固定男 `fk-male-20261017`、女 `fk-female-20261017`。没有授权/没有骨骼/没有审核时 3D 不显示旧人物。
- 153 动作全部能进入详情，缺视频显示对应人物参考 + 原教学文字，不能显示错动作；视频后台/离屏暂停、0.5 倍速及拖动测试。
- 健康区 3D 对正式批准 GLB 实现旋转、正面侧面背面、体型参数；保留身体实测数据不改，**概念图中的 165/52、180/78 等只是示例，不写入账户**。
- 三入口功能与原有训练记录、营养记录、RPE、决策逻辑、安全提示保持完整。
- 当前 R6 清单实际 `0`：不能宣称 153 视频和男女 3D 已完成；静态视觉图不可充当完整动作动画。

## 运行命令

```bash
# 在解压后的 R6 文件夹核验图像、动作 ID、资源清单
python3 tools/verify_bundle.py
# 外部 Codex 仓库中做三方差异合并，切勿直接覆盖
npm run typecheck && npm run build && npm run test:r190 && npm run test:ui-v70 && npm run test:ui-v72
# 审核后发布真实模型（默认 dry run）
python3 tools/publish_media.py --repo /path/to/repo --type model --file /path/to/your-approved-female.glb --evidence /path/to/qa-female.json
```

## 当前未完成

* 新版角色可用的高保真可绑骨 GLB：**无**。用户之前的 GLB 草模外观不合格，不得拿来冒充完成。
* 正式授权/专业动作审核的视频：**无**。视觉示意图只说明页面设计方向。
* Codex 工作区中的实际合并、手机浏览器/真实 GLB 测试：**未运行**。
* Tripo 免费模型以及基于其生成的角色的商业使用权尚需核实；移除品牌 logo 不自动获得许可。
