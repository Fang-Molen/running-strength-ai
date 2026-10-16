方坤食物库完整导出：已收到源码快照，2026-10-17

范围与版本
这份导出覆盖目前已收到源码中的两套食物库，包含10034条原始记录：旧CATALOG 1901条、旧USDA扩展8100条，以及新版饮食页33条。它们不合并同名食物、不互相补齐数值，不代表线上正在使用同一个合并大库。
最新可获取的完整源码输入为2026-10-16 22:36收到的fangkun-fix2-交接包.zip。该分支保留旧食物库，但不包含新版饮食页模块。另一输入是2026-10-16 15:38收到的fk-ui-polish-01-code.zip，保留新版饮食页库及界面接入代码。两个包中的旧catalog.ts、catalog-usda.ts、lookup.ts逐字节相同。
未取得Grok此后线上工作区或真实浏览器数据，因此不声称这是线上最新全库。也不包含你在设备上新增的自定义食物、私人饮食记录或后续未同步修改。

文件
foods-normalized.json：统一字段导出，包含名称、别名、计量基准、每100g营养、默认份量及其营养、单位重量和来源。
foods-original-records.json：逐条原始字段，保留原来的缺项，没有把null补成0。
ui-foods-raw.json：新版33条食物的原样JSON和原版本号、分类、来源状态名。
legacy-search-index.json：原lookup.ts的名称/别名首命中索引，供定位搜索实际采用哪一行，不能把别名数当食品数。
source/：原始食物库、旧搜索匹配与份量换算、新营养缩放、UI搜索过滤及持久化入口代码。
export-summary.json：数量、缺失值和验证范围。
manifest.json：输入ZIP和输出文件哈希。

字段
export_id：仅用于此次导出的稳定行标识。旧库原本无food ID；不是替它伪造原始ID。
name：旧库names的第一项或新版name。aliases：旧库其余names；新版原本未设别名，保持空数组，不自动拆分中英文或品牌。
nutrient_basis：100g或来源规定的一份。新版按个的汉堡没有可靠克重，不转换成每100g数值。
nutrients_per_100g：energy_kcal、protein_g、carbohydrate_g、fat_g、dietary_fiber_g。
nutrients_per_default_serving：旧库为原每100g值乘fallback克重/100的派生值；新版为源条目100g或一份的原数值。旧库这些换算保留8位小数，不沿用旧界面热量取整规则；原lookup.ts的舍入逻辑原样附带。
default_serving：旧fallback克重或新版g/份。portions：原piece/bowl/cup/slice/scoop/root映射的估计克重。不是每种食物都有这些量具重量。
source：区分原字段与导出解释；旧库未逐条保存来源时uri为null。USDA归属来自源文件注释，不是本次对照USDA原库逐条核验。
raw_record_key：对应原始记录文件中的行。

营养与来源缺失
全部原条目均没有膳食纤维字段，统一导出为null；不能当作0g。旧1901条未提供碳水/脂肪字段；不按热量差反推。
新版中国地区品牌条目仍按原样保持PENDING_LABEL；不能拿美国汉堡数值补齐。HISTORICAL_RECHECK是旧版来源，保留原年代；官网链接及原checkedOn是原源码记录，本次没有重新联网核验。
原代码中的0值保留为0，例如水的能量；这与缺值null不同。

搜索与份量代码入口
1. source/src/lib/nutrition/lookup.ts：parseFoodLine、searchFoods、catalogSize；先旧CATALOG再USDA，同名首条优先；长名称优先匹配。portion是内部函数，克、两、斤、片、碗、杯等换算保留原样。
2. source/src/components/fangkun-ui/nutrition-panel.tsx：新版搜索在filtered表达式中，按地区和类别过滤，再在名称、品牌、规格和地区中做小写includes匹配；没有独立模糊匹配或拼音匹配引擎。
3. source/src/components/fangkun-ui/nutrition-core.mjs：scaleNutrients；每100g食物只接受g，按份食物只接受份；null保持null。
4. source/src/lib/nutrition/ui-records.ts：catalogue、customFoods、scaledFood及实际接入。自定义食物来自原App事件存储，源码ZIP没有个人记录，不能从这里导出。
5. source/保持原文件路径和内容。这是相关源码摘录，不是完整可独立启动的App；TSX、事件及存储依赖需要原工程。food-catalog.mjs和nutrition-core.mjs可独立由Node导入。

已发现的旧实现边界（本次不改产品代码）
旧lookup.ts把ml数直接当克数，等同假定密度1g/ml；量具缺克重时有通用默认值。它们是现有代码假设，不是通用于所有食物的实测事实。
旧FoodHit只返回热量与蛋白质等少量字段，不能把其返回结构当作全库营养字段。旧条目的来源、地域、品牌规格也普遍未结构化。
本次仅导出与核对，没有修改食物库数值、App、用户设置或记录，没有补数据或重新科研审核。
