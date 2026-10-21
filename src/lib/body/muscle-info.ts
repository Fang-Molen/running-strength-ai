/** 肌群功能简述（解剖学通用描述）。k 对应 public/demo3d/muscles.json。 */
export const MUSCLE_FN: Record<string, string> = {
  pec_upper: "肩关节屈曲与水平内收，偏上斜推举", pec_lower: "肩关节水平内收、内收与伸展（由屈曲位）",
  delt_front: "肩关节前屈与水平内收", delt_side: "肩关节外展", delt_rear: "肩关节水平外展与伸展",
  biceps: "屈肘、前臂旋后，辅助肩前屈", triceps_long: "伸肘，并协助肩关节伸展", triceps_lat: "伸肘",
  forearm_flex: "屈腕、屈指（握力）", forearm_ext: "伸腕、伸指",
  abs: "躯干屈曲，抵抗躯干伸展", ext_oblique: "躯干旋转与侧屈，抵抗旋转", serratus: "肩胛前伸与上回旋，使肩胛贴紧胸廓",
  iliopsoas: "髋关节屈曲", trap_upper: "肩胛上提与上回旋", trap_mid: "肩胛后缩", trap_lower: "肩胛下沉与上回旋",
  lats: "肩关节伸展、内收与内旋", rhomboids: "肩胛后缩与下回旋", erectors: "脊柱伸展，维持躯干直立",
  glutes: "髋关节伸展与外旋", glute_med: "髋关节外展，单腿站立时稳定骨盆",
  rectus_fem: "伸膝，并协助屈髋", vastus_lat: "伸膝", vastus_med: "伸膝，稳定髌骨", adductors: "髋关节内收",
  biceps_fem: "屈膝，伸髋", semitend: "屈膝，伸髋，小腿内旋",
  gastroc_med: "踝跖屈（伸膝位更强），辅助屈膝", gastroc_lat: "踝跖屈（伸膝位更强），辅助屈膝",
  soleus: "踝跖屈（屈膝位仍有效），站立时维持姿势", tibialis: "踝背屈与足内翻，控制落地时前足下落",
  peroneals: "足外翻，协助跖屈，稳定踝关节外侧", plantar_fascia: "被动支撑足弓（筋膜，不是肌肉）", foot_intrinsic: "维持足弓、控制脚趾与足部细微稳定",
};
export const MUSCLE_FN_SRC = "中文名称按《人体解剖学名词》（全国科学技术名词审定委员会）写法整理；功能为教科书通用的起止点动作，参照《系统解剖学》（人民卫生出版社）与 Kenhub 肌肉解剖条目（kenhub.com/en/library/anatomy）；标“待核”的尚未逐条核对。筋膜、肌腱等结构不会主动收缩。高亮表示所选区域，不代表实测发力、疲劳或恢复。";
