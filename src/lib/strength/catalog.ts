export type ExerciseGroup = "胸" | "背" | "肩" | "手臂" | "腿" | "臀" | "核心" | "全身";

export type CatalogExercise = {
  id: string;
  name: string;
  group: ExerciseGroup;
  category: number;
  categoryKey: string;
  exerciseName: number;
  exerciseKey: string;
  timed?: boolean;
};

export const GROUPS: ExerciseGroup[] = ["胸", "背", "肩", "手臂", "腿", "臀", "核心", "全身"];

export const CATALOG: CatalogExercise[] = [
  { id: "bb-bench", name: "杠铃卧推", group: "胸", category: 0, categoryKey: "BENCH_PRESS", exerciseName: 1, exerciseKey: "BARBELL_BENCH_PRESS" },
  { id: "db-bench", name: "哑铃卧推", group: "胸", category: 0, categoryKey: "BENCH_PRESS", exerciseName: 6, exerciseKey: "DUMBBELL_BENCH_PRESS" },
  { id: "inc-db-bench", name: "上斜哑铃卧推", group: "胸", category: 0, categoryKey: "BENCH_PRESS", exerciseName: 9, exerciseKey: "INCLINE_DUMBBELL_BENCH_PRESS" },
  { id: "inc-bb-bench", name: "上斜杠铃卧推", group: "胸", category: 0, categoryKey: "BENCH_PRESS", exerciseName: 8, exerciseKey: "INCLINE_BARBELL_BENCH_PRESS" },
  { id: "cg-bench", name: "窄距杠铃卧推", group: "胸", category: 0, categoryKey: "BENCH_PRESS", exerciseName: 4, exerciseKey: "CLOSE_GRIP_BARBELL_BENCH_PRESS" },
  { id: "db-fly", name: "哑铃飞鸟", group: "胸", category: 9, categoryKey: "FLYE", exerciseName: 2, exerciseKey: "DUMBBELL_FLYE" },
  { id: "cable-cross", name: "龙门架夹胸", group: "胸", category: 9, categoryKey: "FLYE", exerciseName: 0, exerciseKey: "CABLE_CROSSOVER" },
  { id: "pushup", name: "俯卧撑", group: "胸", category: 22, categoryKey: "PUSH_UP", exerciseName: 77, exerciseKey: "PUSH_UP" },
  { id: "knee-pushup", name: "跪姿俯卧撑", group: "胸", category: 22, categoryKey: "PUSH_UP", exerciseName: 33, exerciseKey: "KNEELING_PUSH_UP" },
  { id: "diamond-pushup", name: "钻石俯卧撑", group: "胸", category: 22, categoryKey: "PUSH_UP", exerciseName: 15, exerciseKey: "DIAMOND_PUSH_UP" },

  { id: "pullup", name: "引体向上", group: "背", category: 21, categoryKey: "PULL_UP", exerciseName: 38, exerciseKey: "PULL_UP" },
  { id: "chinup", name: "反手引体", group: "背", category: 21, categoryKey: "PULL_UP", exerciseName: 3, exerciseKey: "CLOSE_GRIP_CHIN_UP" },
  { id: "assist-chin", name: "弹力带辅助引体", group: "背", category: 21, categoryKey: "PULL_UP", exerciseName: 2, exerciseKey: "BAND_ASSISTED_CHIN_UP" },
  { id: "lat-pd", name: "高位下拉", group: "背", category: 21, categoryKey: "PULL_UP", exerciseName: 13, exerciseKey: "LAT_PULLDOWN" },
  { id: "close-lat", name: "窄距下拉", group: "背", category: 21, categoryKey: "PULL_UP", exerciseName: 5, exerciseKey: "CLOSE_GRIP_LAT_PULLDOWN" },
  { id: "db-row", name: "单臂哑铃划船", group: "背", category: 23, categoryKey: "ROW", exerciseName: 13, exerciseKey: "ONE_ARM_BENT_OVER_ROW" },
  { id: "bb-row", name: "反握杠铃划船", group: "背", category: 23, categoryKey: "ROW", exerciseName: 16, exerciseKey: "REVERSE_GRIP_BARBELL_ROW" },
  { id: "cable-row", name: "坐姿绳索划船", group: "背", category: 23, categoryKey: "ROW", exerciseName: 18, exerciseKey: "SEATED_CABLE_ROW" },
  { id: "face-pull", name: "面拉", group: "背", category: 23, categoryKey: "ROW", exerciseName: 5, exerciseKey: "FACE_PULL" },
  { id: "inv-row", name: "反向划船", group: "背", category: 23, categoryKey: "ROW", exerciseName: 10, exerciseKey: "MODIFIED_INVERTED_ROW" },
  { id: "bb-shrug", name: "杠铃耸肩", group: "背", category: 26, categoryKey: "SHRUG", exerciseName: 1, exerciseKey: "BARBELL_SHRUG" },
  { id: "db-shrug", name: "哑铃耸肩", group: "背", category: 26, categoryKey: "SHRUG", exerciseName: 5, exerciseKey: "DUMBBELL_SHRUG" },

  { id: "db-ohp", name: "坐姿哑铃推举", group: "肩", category: 24, categoryKey: "SHOULDER_PRESS", exerciseName: 17, exerciseKey: "SEATED_DUMBBELL_SHOULDER_PRESS" },
  { id: "bb-ohp", name: "杠铃推举", group: "肩", category: 24, categoryKey: "SHOULDER_PRESS", exerciseName: 4, exerciseKey: "BARBELL_SHOULDER_PRESS" },
  { id: "arnold", name: "阿诺德推举", group: "肩", category: 24, categoryKey: "SHOULDER_PRESS", exerciseName: 1, exerciseKey: "ARNOLD_PRESS" },
  { id: "db-press", name: "哑铃过头推举", group: "肩", category: 24, categoryKey: "SHOULDER_PRESS", exerciseName: 15, exerciseKey: "OVERHEAD_DUMBBELL_PRESS" },
  { id: "lat-raise", name: "坐姿侧平举", group: "肩", category: 14, categoryKey: "LATERAL_RAISE", exerciseName: 24, exerciseKey: "SEATED_LATERAL_RAISE" },
  { id: "lean-raise", name: "哑铃侧平举", group: "肩", category: 14, categoryKey: "LATERAL_RAISE", exerciseName: 11, exerciseKey: "LEANING_DUMBBELL_LATERAL_RAISE" },
  { id: "front-raise", name: "绳索前平举", group: "肩", category: 14, categoryKey: "LATERAL_RAISE", exerciseName: 5, exerciseKey: "CABLE_FRONT_RAISE" },

  { id: "bb-curl", name: "杠铃弯举", group: "手臂", category: 7, categoryKey: "CURL", exerciseName: 3, exerciseKey: "BARBELL_BICEPS_CURL" },
  { id: "db-curl", name: "哑铃弯举", group: "手臂", category: 7, categoryKey: "CURL", exerciseName: 37, exerciseKey: "STANDING_DUMBBELL_BICEPS_CURL" },
  { id: "hammer", name: "锤式弯举", group: "手臂", category: 7, categoryKey: "CURL", exerciseName: 16, exerciseKey: "DUMBBELL_HAMMER_CURL" },
  { id: "cable-curl", name: "绳索弯举", group: "手臂", category: 7, categoryKey: "CURL", exerciseName: 8, exerciseKey: "CABLE_BICEPS_CURL" },
  { id: "pressdown", name: "绳索下压", group: "手臂", category: 30, categoryKey: "TRICEPS_EXTENSION", exerciseName: 39, exerciseKey: "TRICEPS_PRESSDOWN" },
  { id: "oh-ext", name: "哑铃颈后臂屈伸", group: "手臂", category: 30, categoryKey: "TRICEPS_EXTENSION", exerciseName: 15, exerciseKey: "OVERHEAD_DUMBBELL_TRICEPS_EXTENSION" },
  { id: "skull", name: "仰卧臂屈伸", group: "手臂", category: 30, categoryKey: "TRICEPS_EXTENSION", exerciseName: 7, exerciseKey: "DUMBBELL_LYING_TRICEPS_EXTENSION" },
  { id: "bench-dip", name: "凳上臂屈伸", group: "手臂", category: 30, categoryKey: "TRICEPS_EXTENSION", exerciseName: 0, exerciseKey: "BENCH_DIP" },
  { id: "dip", name: "双杠臂屈伸", group: "手臂", category: 30, categoryKey: "TRICEPS_EXTENSION", exerciseName: 2, exerciseKey: "BODY_WEIGHT_DIP" },

  { id: "back-squat", name: "杠铃深蹲", group: "腿", category: 28, categoryKey: "SQUAT", exerciseName: 6, exerciseKey: "BARBELL_BACK_SQUAT" },
  { id: "front-squat", name: "前蹲", group: "腿", category: 28, categoryKey: "SQUAT", exerciseName: 8, exerciseKey: "BARBELL_FRONT_SQUAT" },
  { id: "goblet", name: "高脚杯深蹲", group: "腿", category: 28, categoryKey: "SQUAT", exerciseName: 37, exerciseKey: "GOBLET_SQUAT" },
  { id: "db-squat", name: "哑铃深蹲", group: "腿", category: 28, categoryKey: "SQUAT", exerciseName: 29, exerciseKey: "DUMBBELL_SQUAT" },
  { id: "leg-press", name: "腿举", group: "腿", category: 28, categoryKey: "SQUAT", exerciseName: 0, exerciseKey: "LEG_PRESS" },
  { id: "bb-dl", name: "杠铃硬拉", group: "腿", category: 8, categoryKey: "DEADLIFT", exerciseName: 0, exerciseKey: "BARBELL_DEADLIFT" },
  { id: "rdl", name: "罗马尼亚硬拉", group: "腿", category: 8, categoryKey: "DEADLIFT", exerciseName: 1, exerciseKey: "BARBELL_STRAIGHT_LEG_DEADLIFT" },
  { id: "db-rdl", name: "单腿哑铃硬拉", group: "腿", category: 8, categoryKey: "DEADLIFT", exerciseName: 14, exerciseKey: "SINGLE_LEG_ROMANIAN_DEADLIFT_WITH_DUMBBELL" },
  { id: "sumo", name: "相扑硬拉", group: "腿", category: 8, categoryKey: "DEADLIFT", exerciseName: 15, exerciseKey: "SUMO_DEADLIFT" },
  { id: "trap-dl", name: "六角杠硬拉", group: "腿", category: 8, categoryKey: "DEADLIFT", exerciseName: 17, exerciseKey: "TRAP_BAR_DEADLIFT" },
  { id: "db-lunge", name: "哑铃弓步", group: "腿", category: 17, categoryKey: "LUNGE", exerciseName: 21, exerciseKey: "DUMBBELL_LUNGE" },
  { id: "walk-lunge", name: "行走弓步", group: "腿", category: 17, categoryKey: "LUNGE", exerciseName: 78, exerciseKey: "WALKING_LUNGE" },
  { id: "rev-lunge", name: "杠铃后撤步弓步", group: "腿", category: 17, categoryKey: "LUNGE", exerciseName: 11, exerciseKey: "BARBELL_REVERSE_LUNGE" },
  { id: "bss", name: "保加利亚分腿蹲", group: "腿", category: 17, categoryKey: "LUNGE", exerciseName: 18, exerciseKey: "DUMBBELL_BULGARIAN_SPLIT_SQUAT" },
  { id: "leg-curl", name: "腿弯举", group: "腿", category: 15, categoryKey: "LEG_CURL", exerciseName: 0, exerciseKey: "LEG_CURL" },
  { id: "good-morning", name: "早安式", group: "腿", category: 15, categoryKey: "LEG_CURL", exerciseName: 2, exerciseKey: "GOOD_MORNING" },
  { id: "calf", name: "站姿提踵", group: "腿", category: 1, categoryKey: "CALF_RAISE", exerciseName: 18, exerciseKey: "STANDING_CALF_RAISE" },
  { id: "bb-calf", name: "杠铃提踵", group: "腿", category: 1, categoryKey: "CALF_RAISE", exerciseName: 17, exerciseKey: "STANDING_BARBELL_CALF_RAISE" },
  { id: "seat-calf", name: "坐姿提踵", group: "腿", category: 1, categoryKey: "CALF_RAISE", exerciseName: 6, exerciseKey: "SEATED_CALF_RAISE" },
  { id: "step-up", name: "登阶", group: "腿", category: 28, categoryKey: "SQUAT", exerciseName: 66, exerciseKey: "STEP_UP" },

  { id: "hip-thrust", name: "杠铃臀推", group: "臀", category: 10, categoryKey: "HIP_RAISE", exerciseName: 1, exerciseKey: "BARBELL_HIP_THRUST_WITH_BENCH" },
  { id: "glute-bridge", name: "臀桥", group: "臀", category: 10, categoryKey: "HIP_RAISE", exerciseName: 11, exerciseKey: "HIP_RAISE" },
  { id: "single-hip", name: "单腿臀桥", group: "臀", category: 10, categoryKey: "HIP_RAISE", exerciseName: 30, exerciseKey: "SINGLE_LEG_HIP_RAISE" },
  { id: "kb-swing", name: "壶铃摆荡", group: "臀", category: 10, categoryKey: "HIP_RAISE", exerciseName: 23, exerciseKey: "KETTLEBELL_SWING" },
  { id: "side-leg", name: "侧卧抬腿", group: "臀", category: 11, categoryKey: "HIP_STABILITY", exerciseName: 21, exerciseKey: "SIDE_LYING_LEG_RAISE" },
  { id: "farmer", name: "农夫行走", group: "全身", category: 3, categoryKey: "CARRY", exerciseName: 1, exerciseKey: "FARMERS_WALK" },

  { id: "plank", name: "平板支撑", group: "核心", category: 19, categoryKey: "PLANK", exerciseName: 43, exerciseKey: "PLANK", timed: true },
  { id: "side-plank", name: "侧平板", group: "核心", category: 19, categoryKey: "PLANK", exerciseName: 66, exerciseKey: "SIDE_PLANK", timed: true },
  { id: "knee-plank", name: "跪姿平板", group: "核心", category: 19, categoryKey: "PLANK", exerciseName: 22, exerciseKey: "KNEELING_PLANK", timed: true },
  { id: "climber", name: "登山者", group: "核心", category: 19, categoryKey: "PLANK", exerciseName: 34, exerciseKey: "MOUNTAIN_CLIMBER" },
  { id: "dead-bug", name: "死虫", group: "核心", category: 11, categoryKey: "HIP_STABILITY", exerciseName: 1, exerciseKey: "DEAD_BUG" },
  { id: "crunch", name: "卷腹", group: "核心", category: 6, categoryKey: "CRUNCH", exerciseName: 83, exerciseKey: "CRUNCH" },
  { id: "bicycle", name: "自行车卷腹", group: "核心", category: 6, categoryKey: "CRUNCH", exerciseName: 0, exerciseKey: "BICYCLE_CRUNCH" },
  { id: "russian", name: "俄罗斯转体", group: "核心", category: 5, categoryKey: "CORE", exerciseName: 46, exerciseKey: "RUSSIAN_TWIST" },
  { id: "situp", name: "仰卧起坐", group: "核心", category: 27, categoryKey: "SIT_UP", exerciseName: 37, exerciseKey: "SIT_UP" },
  { id: "vup", name: "两头起", group: "核心", category: 27, categoryKey: "SIT_UP", exerciseName: 31, exerciseKey: "V_UP" },
  { id: "knee-raise", name: "悬垂举膝", group: "核心", category: 16, categoryKey: "LEG_RAISE", exerciseName: 0, exerciseKey: "HANGING_KNEE_RAISE" },
  { id: "burpee", name: "波比跳", group: "全身", category: 29, categoryKey: "TOTAL_BODY", exerciseName: 0, exerciseKey: "BURPEE" },
];

const BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

export function exerciseById(id: string): CatalogExercise | undefined {
  return BY_ID.get(id);
}
