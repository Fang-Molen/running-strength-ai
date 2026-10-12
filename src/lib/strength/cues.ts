export type PoseName =
  | "stand"
  | "squat"
  | "split"
  | "split-down"
  | "step"
  | "step-up"
  | "calf"
  | "calf-up"
  | "deadbug"
  | "deadbug-out"
  | "rdl"
  | "rdl-hinge"
  | "swing"
  | "swing-out"
  | "bridge"
  | "bridge-up"
  | "side-plank"
  | "carry"
  | "row"
  | "row-pull"
  | "pushup"
  | "pushup-down"
  | "side-leg"
  | "side-leg-up"
  | "plank"
  | "knee-pushup"
  | "knee-pushup-down"
  | "hammer-start"
  | "hammer-end";
// New figures are project code schematics, not externally licensed teaching images.

export type FormCue = {
  setup: string;
  effort: string;
  avoid: string;
  setupPose: PoseName;
  effortPose: PoseName;
};

export const CUES: Record<string, FormCue> = {
  hammer: {
    setup: "站稳，双手持哑铃垂于身体两侧，掌心相对，手腕保持直线。",
    effort: "上臂位置保持稳定，缓慢屈肘将哑铃带向肩前；控制放回，不甩动躯干。",
    avoid: "耸肩、肘向前漂移或用腰摆动借力。",
    setupPose: "hammer-start", effortPose: "hammer-end",
  },
  goblet: {
    setup: "铃或哑铃贴在胸口，脚与肩同宽，脚尖稍外。",
    effort: "髋往后坐，膝跟脚尖走，下去时胸口仍朝前。起来时脚跟把地面蹬出去。",
    avoid: "膝往里扣，或弯腰去够地面。",
    setupPose: "stand",
    effortPose: "squat",
  },
  bss: {
    setup: "后脚脚背放在凳上，前脚在身前，能让小腿接近垂直。",
    effort: "身体直直下落，前膝不超过脚尖太多。起来只用前腿。",
    avoid: "后膝跪地砸下去，或身体往前扑。",
    setupPose: "split",
    effortPose: "split-down",
  },
  "step-up": {
    setup: "整只脚踩上台阶，台阶大约到小腿中部。",
    effort: "用上面那条腿把身体蹬上去，不要用下面的腿垫。",
    avoid: "膝盖内扣，或靠惯性蹦上去。",
    setupPose: "step",
    effortPose: "step-up",
  },
  calf: {
    setup: "前脚掌踩在台阶边缘，脚跟悬空，身体站直。",
    effort: "脚跟尽量抬高，停一下，再慢慢落到略低于台阶。",
    avoid: "靠身体晃，或落下去弹一下就起来。",
    setupPose: "calf",
    effortPose: "calf-up",
  },
  "dead-bug": {
    setup: "仰卧，腰轻贴地面，双手朝上，膝弯成直角。",
    effort: "对侧手脚慢慢伸出去，腰不能拱起来。换边。",
    avoid: "伸直时下背离地，或手忙脚乱地甩。",
    setupPose: "deadbug",
    effortPose: "deadbug-out",
  },
  "db-rdl": {
    setup: "单脚站稳，哑铃在身前，支撑腿微屈。",
    effort: "髋往后折，背打直，哑铃贴着腿下去。起来时臀部夹紧。",
    avoid: "腰弓起来，或支撑膝锁死。",
    setupPose: "rdl",
    effortPose: "rdl-hinge",
  },
  "kb-swing": {
    setup: "铃在两腿之间，背平，膝微屈，像要往后跳。",
    effort: "髋向前顶，把铃摆到胸口高度。手只是跟着，不是用手臂举。",
    avoid: "做成深蹲，或把铃拉过头顶。",
    setupPose: "swing",
    effortPose: "swing-out",
  },
  "glute-bridge": {
    setup: "仰卧，脚靠近臀部，膝弯，手臂放在身侧。",
    effort: "脚跟压地，把髋抬到肩和膝成一条线，臀部收紧。",
    avoid: "用腰硬顶，或脚放得太远。",
    setupPose: "bridge",
    effortPose: "bridge-up",
  },
  "single-hip": {
    setup: "和臀桥一样，一条腿伸直或屈在身上。",
    effort: "只用着地那只脚跟把髋抬平，骨盆不要掉向一边。",
    avoid: "靠伸直的那条腿借力，或一边髋沉下去。",
    setupPose: "bridge",
    effortPose: "bridge-up",
  },
  "side-plank": {
    setup: "侧卧，肘在肩的正下方，两脚前后叠放。",
    effort: "髋抬起来，身体从肩到脚成一条线。",
    avoid: "髋往前转，或耸肩去够耳朵。",
    setupPose: "side-plank",
    effortPose: "side-plank",
  },
  farmer: {
    setup: "双手各提一个重量，站直，肩下沉。",
    effort: "小步走，躯干不要歪。时间到再放下。",
    avoid: "弓腰，或一边肩膀高一边低。",
    setupPose: "carry",
    effortPose: "carry",
  },
  "db-row": {
    setup: "一手撑凳，背几乎与地面平行，哑铃垂下。",
    effort: "肘贴着身体往上拉到髋旁，肩胛先动。",
    avoid: "转腰甩哑铃，或只动手臂。",
    setupPose: "row",
    effortPose: "row-pull",
  },
  "knee-pushup": {
    setup: "膝跪地，手在肩下方稍宽，身体从肩到膝是一条线。",
    effort: "胸口落到接近地面，肘大约 45 度，再推起。",
    avoid: "塌腰，或肘张成一条直线。",
    setupPose: "knee-pushup",
    effortPose: "knee-pushup-down",
  },
  "side-leg": {
    setup: "侧卧，下面的腿微屈，上面的腿伸直。",
    effort: "上面的腿往天花板抬，脚尖朝前，髋不要翻到后面。",
    avoid: "把腿往前摆，或身体跟着滚。",
    setupPose: "side-leg",
    effortPose: "side-leg-up",
  },
  plank: {
    setup: "前臂撑地，肘在肩下，脚尖点地。",
    effort: "收紧肚子，肩、髋、脚跟成一条线，正常呼吸。",
    avoid: "塌腰或把屁股撅得很高。",
    setupPose: "plank",
    effortPose: "plank",
  },
};

export function cueFor(catalogId: string | null): FormCue | null {
  if (!catalogId) return null;
  return CUES[catalogId] ?? null;
}
