# 方坤 3D 演示 · 动作规范审核（第 1 批：4 个动作）

来源（2026-10-14 已抓取原文核对）：
- [S1] ExRx Barbell Squat — https://exrx.net/WeightExercises/Quadriceps/BBSquat
- [S2] ExRx Push-up — https://exrx.net/WeightExercises/PectoralSternal/BWPushup
- [S3] ExRx Barbell Deadlift — https://exrx.net/WeightExercises/GluteusMaximus/BBDeadlift
- [S4] ExRx Pull-up — https://exrx.net/WeightExercises/LatissimusDorsi/BWPullup
- 补充（用户 / 教练方给的要求，NSCA/ACE 原文未抓到）：深蹲脚尖外展 15–30°，底部躯干前倾约 30–45°；俯卧撑肘部与躯干约 45°。这两条属于通用教学参数，ExRx 原文里没有。

证据：audit/<动作>-<start|bottom|top>-<front|side>.png，汇总图 audit/sheet-<动作>.png。悬垂和下巴过杠用骨骼坐标实测（num.js）。

| 动作 | 检查点（出处） | 结果 | 证据 / 修改 |
|---|---|---|---|
| 杠铃深蹲 | 杠铃放在肩后上部（斜方肌上部），双手握杠 [S1] | 通过 | side/front start；杠铃已下移到斜方肌上部，双手握拳包住杠，握距变宽 |
| | 站距约与肩同宽或略宽 [S1] | 通过 | front start |
| | 髋向后坐，同时膝向前 [S1] | 通过 | side bottom |
| | 背部挺直 [S1] | 通过（脊柱按中立设定） | side bottom |
| | 膝与脚尖方向一致（无内扣）[S1] | 通过 | front bottom（上一轮失败，已修：脚尖外展 26°，大腿外展 32°） |
| | 下蹲到大腿略低于平行，髋折痕低于膝盖顶部 [S1] | 通过 | side bottom（大腿 10° 低于水平） |
| | 头朝前 [S1] | 通过 | 本轮第一次检查失败（底部低头），已改成目视前方 |
| | 全脚掌着地 [S1] | 通过 | side bottom，脚跟不离地 |
| | 躯干前倾 30–45°（补充要求） | 通过 | 底部约 44° |
| 俯卧撑 | 双手比肩略宽 [S2] | 通过 | front start |
| | 用脚尖支撑 [S2] | 通过 | side start |
| | 全程身体保持一条直线 [S2] | 通过 | side start/bottom/top（按直线求解） |
| | 下放到接近地面，推起到手臂伸直 [S2] | 通过 | side bottom / top |
| | 肘部与躯干约 45°（补充要求） | 通过（约 37–45°，目测） | front bottom |
| 杠铃硬拉 | 双脚平放在杠铃下方 [S3] | 通过 | side start |
| | 握距与肩同宽或略宽，正握 [S3] | 通过 | front start |
| | 伸髋伸膝直到完全伸展 [S3] | 通过 | side top |
| | 背部和手臂伸直；髋低、肩高 [S3] | 通过 | side start（髋高于膝，肩在杠前上方） |
| | 膝与脚尖方向一致 [S3] | 通过 | 本轮第一次检查失败（起始膝略内收），已修：大腿外展 13°，脚尖外展 12° |
| | 杠铃贴近身体 [S3] | 通过 | 侧面时杠铃片透明度降到 0.12，能看到杠贴着小腿和大腿走 |
| | 下放时髋先向后，膝再弯 [S3] | 通过 | 回放顺序：锁定 → 过膝 → 底部 |
| 引体向上 | 正握，宽握 [S4] | 通过 | front start |
| | 拉到下巴高过横杠 [S4] | 通过 | 实测头部骨骼比杠高 0.17 m，下巴约高 0.14 m（上一轮只到平齐，已修） |
| | 下放到手臂和肩完全伸展 [S4] | 通过 | front start |
| | 悬垂时双脚离地 | 通过 | 实测鞋最低点离地 0.27 m（横杠升到 2.62 m） |
| | 握距不过宽（否则幅度受限）[S4] | 通过 | 握距约 1.6 倍肩宽 |

无法核实 / 已知限制：
- NSCA 和 ACE 的原文页面没有抓取核对，所以只引用 ExRx。
- 脊柱"中立"是建模时就这样设的，不能证明发力时有核心收紧。

## Batch 1 (16 exercises) — audited 2026-10-14
Evidence: audit/sheet-<motion>.png (front/side, start · bottom/top). Sources (ExRx, all fetched HTTP 200):
B1 https://exrx.net/WeightExercises/Quadriceps/BBFrontSquat · B2 https://exrx.net/WeightExercises/Quadriceps/DBSquat · B3 https://exrx.net/WeightExercises/Triceps/BWCloseGripPushup · B4 https://exrx.net/WeightExercises/Hamstrings/BBGoodMorning · B5 https://exrx.net/WeightExercises/Gastrocnemius/BBStandingCalfRaise · B6 https://exrx.net/WeightExercises/Gastrocnemius/BWStandingCalfRaise · B7 https://exrx.net/WeightExercises/RectusAbdominis/BWFrontPlank · B8 https://exrx.net/WeightExercises/GluteusMaximus/BBStiffLegDeadlift · B9 https://exrx.net/WeightExercises/Kettlebell/KBFrontSquat · B10 https://exrx.net/WeightExercises/PectoralSternal/BWPushupKnee · B11 https://exrx.net/WeightExercises/LatissimusDorsi/BWUnderhandChinup · B12 https://exrx.net/WeightExercises/LatissimusDorsi/AsUnderhandChinup · B13 https://exrx.net/WeightExercises/TrapeziusUpper/BBShrug · B14 https://exrx.net/WeightExercises/TrapeziusUpper/DBShrug

| Exercise | Checklist point (source) | Result |
|---|---|---|
| front-squat | Upper arms ~parallel to floor, bar on front delts (B1) | FAIL→fixed (elbow pole raised), PASS |
| front-squat | Knees track over feet, thighs ≥ parallel, trunk upright (B1) | PASS |
| goblet | Weight held at chest, upright trunk, depth ≥ parallel (B9 proxy) | PASS — **flag: proxy source** |
| db-squat | Arms straight at sides, chest up, knees over toes, depth (B2) | PASS |
| knee-pushup | Straight line knees→head, hands under shoulders, chest near floor (B10) | FAIL (feet too high)→fixed, PASS |
| diamond-pushup | Hands under shoulders or narrower, body straight, elbows near sides (B3) | PASS (diamond = narrower variant) |
| chinup | Underhand shoulder-width grip, full hang, chin over bar (B11) | PASS — **flag: supination not visually obvious** |
| assist-chin | As chin-up, assisted (B12) | PASS for pattern — **flag: no machine/band shown** |
| rdl | Knees slightly bent, hip hinge, bar close, neutral back (B8 proxy) | PASS — **flag: proxy source (stiff-leg)** |
| sumo | Wide stance, toes out, vertical shins, neutral back | **UNVERIFIED — ExRx page 403; not cited** |
| good-morning | Knees straight/slight bend, torso lowered to ~parallel (B4) | FAIL (knees ~30°, torso 10° short)→fixed, PASS |
| calf / bb-calf | Forefoot on calf block, heels lowered below then raised fully, knees straight (B5,B6) | FAIL (on floor)→fixed (block added), PASS — flag: BW version shows no hand support |
| plank / knee-plank | Forearms on floor, elbows under shoulders, body straight (B7) | PASS (elbow placement checked roughly) |
| bb-shrug / db-shrug | Shoulders elevated as high as possible, arms straight (B13,B14) | FAIL (too subtle)→fixed 24°, PASS |

## Batch 1 follow-ups (2026-10-14, round 2)
| Exercise | Checklist point (source) | Result |
|---|---|---|
| all barbell/DB/bar holds | Bar sits in the closed fist, thumb wrapped (closed grip) | FAIL (bar floated below/above the hand, thumb stuck out) → fixed: bar/dumbbell placed at the finger-palm grip point, thumb now opposes and wraps. Close-ups: shots/batch2/grip-*.png |
| deadlift (bb-dl) | Bar starts on the floor over mid-foot, shins near bar, hips between knees and shoulders, shoulders slightly in front of bar (S2, existing ExRx deadlift source) | **FAIL found in re-check**: plates started 8 cm off the floor, bar 14 cm ahead of the ankle → fixed (numerically solved start: grip 0.24 m = plate radius, bar 7 cm ahead of ankle, shoulders 2 cm ahead of bar, hips 0.81 m vs knees 0.54 m / shoulders 0.97 m). Feet no longer slide (2.6 cm → 0.2 cm) |
| sumo | Source now cited: Stronger by Science, "How to Deadlift" https://www.strongerbyscience.com/how-to-deadlift/ — feet outside hands; shins ~perpendicular to floor seen from front; moderate stance ~2× shoulder width with feet turned out ~45°; knees in line with toes | FAIL (bar 15 cm off floor at start, feet slid 10 cm) → fixed: bar on floor, shins vertical from front (knee x = ankle x), toes out 38°, hands inside knees, feet fixed (≤1.2 cm drift). PASS |
| chinup | Underhand (supinated) grip visible (B11) | FAIL (looked pronated) → fixed: forearm supinated, palms face the lifter; hanging shoes 0.30 m off floor, chin 9 cm above bar at top. PASS |
| knee-pushup | Re-render verified: feet/shins on floor, straight line knees→head | PASS |
| bb/db-shrug | Re-render verified: shoulder elevation measured 8 cm (clavicle 28°) — clearly visible | PASS |

## Batch 2 (16 exercises) — audited 2026-10-14
Sources (all fetched 200): C1 https://exrx.net/WeightExercises/DeltoidAnterior/BBMilitaryPress · C2 https://exrx.net/WeightExercises/DeltoidAnterior/DBShoulderPress · C3 https://exrx.net/WeightExercises/DeltoidAnterior/DBArnoldPress · C4 https://exrx.net/WeightExercises/DeltoidLateral/DBLateralRaise · C5 https://exrx.net/WeightExercises/Biceps/BBCurl · C6 https://exrx.net/WeightExercises/Biceps/DBCurl · C7 https://exrx.net/WeightExercises/Brachioradialis/DBHammerCurl · C8 https://www.acefitness.org/resources/everyone/exercise-library/359/farmer-s-carry/ + https://www.acefitness.org/resources/pros/expert-articles/7099/strongman-exercises-that-work-great-for-fitness-clients/ · C9 https://exrx.net/WeightExercises/Quadriceps/DBLunge · C10 https://exrx.net/WeightExercises/Quadriceps/BBRearLunge · C11 https://exrx.net/WeightExercises/Quadriceps/DBStepUp · C12 https://www.acefitness.org/resources/everyone/exercise-library/366/bulgarian-split-squat/ + https://exrx.net/WeightExercises/Quadriceps/DBSplitSquat · C13 https://exrx.net/WeightExercises/Kettlebell/KBSwing · C14 https://www.roguefitness.com/theindex/movement-library/movement-demo-low-handle-trap-bar-deadlift + https://www.muscleandstrength.com/exercises/trap-bar-deadlift

| Exercise | Checklist point (source) | Result |
|---|---|---|
| bb-ohp | Overhand grip slightly wider than shoulders; bar starts in front of neck; press until arms extended overhead (C1) | FAIL (elbows still 53° bent at top) → fixed (4.6° at lockout). PASS |
| db-press / db-ohp | DBs beside shoulders, elbows below wrists; press until arms extended (C2) | FAIL (45° bent at top) → fixed (4.5°). PASS. db-ohp = same arms, seated with backrest per app cues |
| arnold | Start in front of shoulders, palms toward body, elbows under wrists; elbows go out while pressing; arms straight at top (C3) | FAIL (68° bent at top) → fixed (5°). PASS — **flag: forearm rotation is approximated, check hand turn in motion** |
| lat-raise | Elbows slightly bent, raise to shoulder height, elbows ≥ wrist height, slight forward lean (C4) | PASS — **flag: ExRx describes standing; app asks for seated; ExRx seated page returned 403** |
| bb-curl | Shoulder-width underhand grip, elbows at sides, raise until forearms ≤ vertical, lower to full extension (C5) | PASS |
| db-curl | Start palms in at sides, supinate during curl until palm faces shoulder (C6) | PASS — note app setup text says 掌心朝前 from the start; ExRx starts neutral; both are accepted variants |
| hammer | Neutral grip throughout, thumb toward shoulder at top (C7) | PASS |
| farmer | DBs at sides, tall posture, braced trunk, short steps; marching in place acceptable when space is limited (C8) | PASS — **flag: shown marching in place; ACE text says "palms facing down", we show the usual neutral hold at the sides** |
| db-lunge | Long step forward, lower until rear knee almost touches floor, torso upright, lead knee in line with foot (C9) | PASS (rear knee 0.12 m, front knee 5 cm ahead of ankle, trunk vertical) |
| walk-lunge | As db-lunge | PASS for the bottom position — **flag: shown in place (no forward travel), with dumbbells** |
| rev-lunge | Bar on back, step back, forefoot planted far back, lower until rear knee almost on floor, torso upright (C10) | PASS |
| step-up | Whole foot on box, extend lead hip/knee to stand on box, torso upright, lead knee in line with foot (C11) | PASS (box 0.42 m) |
| bss | Rear foot top on knee-height bench, front foot well forward, back straight, lower rear knee toward floor (C12) | PASS — **flag: ACE holds one DB at chest; we follow the app cue (DB in each hand at sides)** |
| kb-swing | Feet slightly wider than shoulders, hinge with forearms on inner thighs, drive hips forward, swing to shoulder–eye height (C13) | PASS |
| trap-dl | Stand centred, handles at mid-foot, neutral grip, hips above knees and below shoulders, shoulders over/just in front of hands, flat back (C14) | PASS (hips 0.59 m, knees 0.49 m, shoulders 0.96 m) — **flag: no NSCA/ACE/ExRx page available (ExRx 403); cited Rogue + Muscle & Strength** |

## Batch 3 (15 exercises) — audited 2026-10-14
Sources (fetched 200): D1 https://exrx.net/WeightExercises/PectoralSternal/BBBenchPress · D2 https://exrx.net/WeightExercises/PectoralSternal/DBBenchPress · D3 https://exrx.net/WeightExercises/PectoralClavicular/DBInclineBenchPress · D4 https://exrx.net/WeightExercises/PectoralClavicular/BBInclineBenchPress · D5 https://exrx.net/WeightExercises/Triceps/BBCloseGripBenchPress · D6 https://exrx.net/WeightExercises/PectoralSternal/DBFly · D7 https://exrx.net/WeightExercises/Triceps/DBLyingTriExt · D8 https://exrx.net/WeightExercises/Triceps/DBTriExt · D9 https://www.acefitness.org/resources/everyone/exercise-library/127/single-arm-single-leg-romanian-dead-lift/ · D10 https://exrx.net/WeightExercises/BackGeneral/BBUnderhandBentOverRow · D11 https://exrx.net/WeightExercises/BackGeneral/DBBentOverRow · D12 https://exrx.net/WeightExercises/BackGeneral/BWSupineRow · D13 https://exrx.net/WeightExercises/Triceps/BWTriDip · D14 https://exrx.net/WeightExercises/Triceps/BWBenchDip · lean-raise uses C4 (DBLateralRaise) as a proxy

| Exercise | Checklist point (source) | Result |
|---|---|---|
| bb-bench | Supine, feet on floor, wide overhand grip, lower to chest (nipple line, forearms ~vertical), press until arms extended over shoulders (D1 + app cues) | FAIL in first draft (pelvis tilted, feet under floor) → fixed; numerically solved bar path. PASS |
| db-bench | DBs at sides of chest, press up/inward until extended (D2) | PASS |
| inc-db-bench | Incline, DBs at sides of upper chest, press until extended (D3) | PASS (35° pad) |
| inc-bb-bench | Incline, lower to upper chest, press until extended (D4) | PASS |
| cg-bench | Shoulder-width grip, elbows close, lower to chest, press until straight (D5) | PASS |
| db-fly | Elbows slightly bent and fixed, lower to sides until chest stretch, hug together (D6) | PASS — **flag: elbow angle approximately fixed (IK)** |
| skull | Arms extended over chest, bend elbows until DBs beside head (D7) | PASS |
| oh-ext | DB overhead in both hands, elbows up, lower forearms behind upper arms (D8) | PASS — **flag: palms on handle, not the heart-shaped grip under the plate** |
| db-rdl (single leg) | One leg, DB in opposite hand, soft stance knee, flat back, free leg extends behind, DB lowers in front of stance leg (D9) | FAIL (DB in front of wrong leg) → fixed. PASS |
| lean-raise | Hold post, lean away, raise one DB to shoulder height, elbow slightly bent (C4 proxy + app cues) | PASS — **flag: proxy source only** |
| bb-row (reverse grip) | Knees slightly bent, back straight, underhand grip, pull bar to waist (D10) | PASS (trunk ~42°) |
| db-row | Knee + hand on bench, other foot on floor, pull DB to ribs, no rotation, torso close to horizontal (D11) | PASS with note — trunk ≈20° above horizontal (0.44 m bench, straight support arm) |
| inv-row | Body straight under bar, pull chest to bar, return to extended arms (D12) | PASS (heels fixed) — **flag: hands drift ~4 cm along bar mid-rep** |
| dip | Shoulders above hands, hips straight, lower to slight shoulder stretch (upper arm ≈ parallel), press until straight (D13) | PASS (feet ≥0.19 m off floor) |
| bench-dip | Hands on bench edge, slide off, lower by bending arms; feet-on-floor variant (D14) | PASS — **flag: feet slide ~3 cm** |

## Round 4 fixes to batch 3 (2026-10-15)
| Exercise | Fault reported | Fix | Result |
|---|---|---|---|
| inv-row | Hands drift ~4 cm along the bar | Hands now driven by world-space IK on the bar (gripIK, 4 iterations); heels anchored | Drift ≤5 mm, PASS |
| bench-dip | Feet slide ~3 cm | Foot bone anchored on the floor; hands IK-locked to the bench edge; frames change only arms/trunk | Slide ≤5 mm, PASS |
| db-row | Torso ≈20° above horizontal | Support arm angled 25° forward (D11 allows hand on bench ahead of shoulder), trunk 100 → torso ≈10° above horizontal | PASS |
| db-fly | Elbow angle not clearly fixed | FK arms: elbow bend fixed at ~20–25° through the arc, handles turned to neutral (palms facing) | PASS |
| arnold | Rotation check | Palms facing body at the bottom, rotating to forward at lockout (re-checked frames) | PASS |
| walk-lunge | Stepped in place | Now actually travels: 2 steps per cycle (≈1.25 m each), alternating legs, the camera, floor and light follow the pelvis; the loop wraps seamlessly | PASS |

## Batch 4 — cables and machines (11 exercises) — audited 2026-10-15
Sources (HTTP 200 checked): E1 https://exrx.net/WeightExercises/PectoralSternal/CBStandingFly · E2 https://exrx.net/WeightExercises/LatissimusDorsi/CBFrontPulldown · E3 https://exrx.net/WeightExercises/LatissimusDorsi/CBCloseGripPulldown · E4 https://exrx.net/WeightExercises/BackGeneral/CBSeatedRow · E5 https://exrx.net/WeightExercises/DeltoidPosterior/CBStandingRearDeltRowRope · E6 https://exrx.net/WeightExercises/DeltoidAnterior/CBFrontRaise · E7 https://exrx.net/WeightExercises/Biceps/CBCurl · E8 https://exrx.net/WeightExercises/Triceps/CBPushdown · E9 https://exrx.net/WeightExercises/Quadriceps/SL45LegPress · E10 https://exrx.net/WeightExercises/Hamstrings/LVLyingLegCurl · E11 https://exrx.net/WeightExercises/Soleus/LVSeatedCalfRaise

New self-made equipment (MIT): cable tower and pulley, a live cable line from the pulley to the grip point, straight bar, V-handle and rope handle, pulldown seat with thigh pad, seated-row bench with footplate, 45° leg-press seat and sled plate, leg-curl bench with ankle roller, seated-calf seat, knee pad and step, exercise mat.

| Exercise | Checklist point (source) | Result |
|---|---|---|
| cable-cross | High pulleys, slight forward lean, elbows slightly bent and fixed, hands arc down and in to meet in front of the abdomen (E1 + app cues) | PASS |
| lat-pd | Seated under thigh pad, wide overhand grip, arms extended at the top, pull the bar to the upper chest with elbows down and back, slight lean back (E2) | PASS |
| close-lat | V-handle, neutral grip, elbows close to the body, pull to the upper sternum (E3) | PASS |
| cable-row | Seated, feet on footplate, knees slightly bent, upright torso, pull handle to the abdomen, elbows close (E4) | PASS. **Flag: the torso rocks ~9° (forward at the stretch, upright at the pull). E4 allows a small lean, but there is no pause at full scapular protraction.** |
| face-pull | Rope at upper-chest/face height, pull toward forehead, elbows high and out, hands end beside the ears (E5 + app cues) | PASS |
| front-raise (cable) | Low pulley behind, cable between legs, straight-ish arms raised forward to shoulder height, controlled lowering (E6) | PASS |
| cable-curl | Low pulley in front, elbows at sides, curl to the chest, slow return (E7) | PASS |
| pressdown | High pulley, elbows pinned at sides, slight forward lean, extend until arms straight, return to ~90° (E8) | PASS |
| leg-press | Back on pad, feet on platform, lower until knees ≈90° (app cue; E9 permits deeper), heels stay on the platform, knees track the feet, no lockout at the top | PASS. **Flag: the plate path deviates from a perfectly straight 45° rail by ≈7° because the plate follows the feet rather than a rail. Ankle dorsiflexion is ≈35° at the bottom.** |
| leg-curl | Prone, roller on the back of the ankles, curl knees to ≈80–90°, slow lowering, hips stay on the bench (E10) | PASS |
| seat-calf | Seated, pad on the knees, balls of the feet on the step, heel lowers below the step then rises fully, 1 s pause (E11) | PASS |

## Batch 5 — glutes, core and full body (14 exercises) — audited 2026-10-15
Sources (HTTP 200 checked): F1 https://exrx.net/WeightExercises/GluteusMaximus/BBHipThrust · F2 https://www.acefitness.org/resources/everyone/exercise-library/49/glute-bridge/ · F3 https://exrx.net/WeightExercises/HipAbductor/DBLyingHipAbduction · F4 https://www.acefitness.org/resources/everyone/exercise-library/303/side-plank/ and https://www.acefitness.org/resources/everyone/blog/5602/10-minute-core-workout/ · F5 https://www.acefitness.org/resources/everyone/exercise-library/258/mountain-climbers/ · F6 https://www.acefitness.org/resources/everyone/exercise-library/147/supine-dead-bug/ · F7 https://exrx.net/WeightExercises/RectusAbdominis/BWCrunch · F8 https://www.acefitness.org/resources/everyone/exercise-library/241/supine-bicycle-crunches/ · F9 https://exrx.net/WeightExercises/RectusAbdominis/BWSitUp · F10 https://www.acefitness.org/resources/everyone/exercise-library/242/v-ups/ · F11 https://exrx.net/WeightExercises/HipFlexors/BWHangingLegRaise (ExRx: "also known as Hanging Knee Raise") · F12 https://www.acefitness.org/resources/pros/expert-articles/5326/6-exercise-swaps-that-will-kick-up-the-intensity-of-your-workout/ (burpee "how to") and https://www.nasm.org/resource-center/exercise-library/squat-thrust-burpees

| Exercise | Checklist point (source) | Result |
|---|---|---|
| hip-thrust | Upper back on the bench edge, feet flat with shins vertical at the top, bar over the hips, extend until shoulders–hips–knees are in line, chin tucked (F1) | PASS (the shoulder contact point stays fixed within 6 mm, solved numerically) |
| glute-bridge | Supine, knees bent, feet flat hip-width apart, hips rise until shoulders–hips–knees are in line, no over-arching (F2) | PASS (the line is ≈5° short of fully straight, in line with ACE's "avoid pushing hips too high") |
| single-hip | As F2 with one leg extended in line with the thigh, pelvis level (F2 progression) | PASS |
| side-leg | Side-lying, hips stacked, top leg straight, raised ≈35–45°, toes forward (F3 + app cues) | PASS |
| side-plank | Elbow under the shoulder, feet stacked, straight line head to heels (F4) | PASS (timed hold) |
| climber | Hands under the shoulders, alternate driving one knee toward the chest, other leg extended, hips in line with the shoulders (F5) | PASS. Front foot touches lightly, as in F5 step 1. |
| dead-bug | Arms over the shoulders, hips/knees at 90°; lower the opposite arm and leg toward the floor, low back stays down; alternate (F6) | PASS. The leg extends rather than lowering a bent-knee heel; app cue "伸展对侧手臂和腿" matches. |
| crunch | Knees bent, curl the upper trunk until the shoulder blades leave the floor, lumbar stays down (F7) | PASS |
| bicycle | Hands behind the head, opposite elbow toward the drawn-in knee, other leg extended and elevated, shoulder blade off the floor (F8) | First draft FAIL (twist toward the same-side knee) → sign fixed and checked numerically. PASS. **Flag: the elbow stops ~15 cm short of the knee.** |
| russian | Seated, lean back ≈45°, feet on the floor, chest up, rotate side to side with hands toward the floor (app cues; F12 names the exercise only) | PASS against the app cues. **Flag: uncertain source. ACE's own Russian-twist page is a stability-ball variant, so no fetched source describes this exact seated form.** |
| situp | Knees bent, roll up until the trunk is near upright, lower under control (F9) | PASS |
| vup | Supine, raise trunk and straight legs together into a V, hands reach toward the feet (app cues) | PASS against the app cues. **Flag: uncertain source. F10 (ACE) only shows a regressed, one-leg V-up.** |
| knee-raise | Hang from the bar overhand, flex hips and knees until the knees are above the hips, slight posterior pelvic tilt (F11) | PASS |
| burpee | Squat with hands on the floor, jump the feet back to plank, jump the feet back in, jump up reaching overhead (F12) | PASS. Push-up omitted; the app cue marks it optional ("可加一个俯卧撑"). |
