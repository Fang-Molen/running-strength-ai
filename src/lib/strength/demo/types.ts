// 方坤动作演示数据类型（对应 fangkun-exercises-demo.json）
export type MuscleId = 'chest'|'delt_front'|'delt_side'|'delt_rear'|'biceps'|'triceps'|'forearm'|'abs'|'obliques'|'hip_flexors'|'traps'|'lats'|'rhomboids'|'erectors'|'glutes'|'glute_med'|'quads'|'adductors'|'hamstrings'|'calves';
export type Angle = number; // 度；0=向下，90=向前(右)，180=向上，-90=向后；方向=近端→远端
export interface Pose { anchor?: 'hip'|'ankle'|'toe'|'knee'|'wrist'|'elbow'|'shoulder'; at?: [number, number]; view?: 'side'|'front';
  trunk?: Angle; neck?: Angle; thigh?: Angle; shin?: Angle; foot?: Angle; uarm?: Angle; farm?: Angle;
  thigh2?: Angle; shin2?: Angle; foot2?: Angle; uarm2?: Angle; farm2?: Angle; sh?: number /*耸肩位移px*/ }
export interface Keyframe { pose: Pose; dur: number /*秒，到下一帧的过渡时长*/; phase: 'con'|'ecc'|'hold' }
export interface Prop { type: 'bench'|'box'|'bar'|'cable'|'mat'; x?: number; y?: number; w?: number; x1?: number; x2?: number; to?: string }
export interface Held { type: 'barbell'|'dumbbell'|'kettlebell'|'handle'; at: 'wrist'|'sho'|'hip'; off?: [number, number] }
export interface Animation { base: Pose; frames: Keyframe[]; props: Prop[]; held: Held[]; heldFront: Held[] }
export interface Cues { setup: string[]; execution: string[]; breathing: string[]; mistakes: string[]; safety: string[]; regression: string[]; progression: string[] }
export interface DemoExercise { id: string; name_zh: string; name_en: string; category: '胸'|'背'|'肩'|'手臂'|'腿'|'臀'|'核心'|'全身';
  garmin_fit: { category: number; category_key: string; exercise_name: number; exercise_key: string };
  default_sets: number; default_reps_or_time: { mode: 'reps'|'seconds'; amount: number }; default_rest_sec: number;
  primary_muscles: MuscleId[]; secondary_muscles: MuscleId[]; equipment: string[]; cues: Cues; tempo: string|null; anim: string;
  muscle_mapping_status: 'proposed'; review: 'UNREVIEWED'; provenance: { author: string; license: string; third_party_assets: null } }
export interface DemoData { version: string; generated: string; exercises: DemoExercise[]; animations: Record<string, Animation> }
