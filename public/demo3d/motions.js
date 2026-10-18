// 关键帧：分段方向角（度）。s: 0=竖直向下 90=向前 180=向上 负值=向后；*Ab=外展角。trunk=髋→肩方向。
// foot 63 ≈ 脚掌平放。handT = 手相对两肩中点（躯干坐标）的位置，走两段 IK。
const STAND = { trunk: 180, thigh: 0, shin: 0, foot: 63 };
const SQ_BOT = { trunk: 126, curve: 0, thigh: 100, shin: -40, thighAb: 32, shinAb: -6, neck: 160, head: 174, pelvisTilt: -6 };
const DL_BOT = { trunk: 111, thigh: 60, shin: -6, thighAb: 13, shinAb: -3, neck: 150, head: 125, uarm: -4, farm: -4, uarmAb: 6, farmAb: 4 };
const DL_KNEE = { trunk: 145, thigh: 38, shin: -2, neck: 160, head: 145, uarm: -3, farm: -3 };
const PU_HANG = { trunk: 182, thigh: 6, shin: -4, foot: 30, uarm: 180, uarmAb: 22, farm: 180, farmAb: 14, neck: 185, head: 178 };
const PU_TOP = { trunk: 170, thigh: 14, shin: -8, foot: 30, uarm: 12, uarmAb: 28, farm: 180, farmAb: -8, neck: 178, head: 172 };
const MO = {
  back_squat: {
    props: ['barbell'], barAt: 'back', view: 'three', camTarget: [0, .85, 0], camDist: 3.6,
    base: { ...STAND, handT: [0.52, -0.06, -0.15], elbowPole: [0.2, -1, -0.6], grip: 100, thighAb: 11, shinAb: -1, footAb: 26, neck: 184, head: 186 },
    frames: [
      { pose: {}, dur: .6, phase: 'hold' },
      { pose: {}, dur: 2.0, phase: 'ecc' },
      { pose: SQ_BOT, dur: .35, phase: 'hold' },
      { pose: SQ_BOT, dur: 1.3, phase: 'con' },
    ]
  },
  pushup: {
    view: 'three', camTarget: [0, .3, .7], camDist: 3.0,
    base: { plankH: .66, handFloor: [0.29, 0.035, -0.02], elbowPole: [0.75, 0.05, -1], wrist: 90, thighAb: 4, shinAb: 0, footAb: 4, grip: 10 },
    frames: [
      { pose: {}, dur: .5, phase: 'hold' },
      { pose: {}, dur: 1.8, phase: 'ecc' },
      { pose: { plankH: .28 }, dur: .25, phase: 'hold' },
      { pose: { plankH: .28 }, dur: 1.1, phase: 'con' },
    ]
  },
  deadlift: {
    props: ['barbell'], barAt: 'hands', view: 'three', camTarget: [0, .75, 0], camDist: 3.6,
    base: { ...STAND, uarm: -2, farm: -2, uarmAb: 7, farmAb: 3, grip: 85, footAb: 12, thighAb: 8.5 },
    frames: [
      { pose: DL_BOT, dur: .6, phase: 'hold' },
      { pose: DL_BOT, dur: .7, phase: 'con' },
      { pose: DL_KNEE, dur: .7, phase: 'con' },
      { pose: { pelvisTilt: 0 }, dur: .6, phase: 'hold' },
      { pose: {}, dur: .9, phase: 'ecc' },
      { pose: DL_KNEE, dur: .8, phase: 'ecc' },
    ]
  },
  pullup: {
    props: ['pullbar'], view: 'three', camTarget: [0, 1.8, 0], camDist: 5.0, barY: 2.76,
    base: { anchor: 'hands', at: [0, 2.76, 0], grip: 90, handLen: 0.06 },
    frames: [
      { pose: PU_HANG, dur: .6, phase: 'hold' },
      { pose: PU_HANG, dur: 1.2, phase: 'con' },
      { pose: PU_TOP, dur: .4, phase: 'hold' },
      { pose: PU_TOP, dur: 2.0, phase: 'ecc' },
    ]
  },
  calf: {
    props: ['block'], view: 'side', camTarget: [0, .8, 0], camDist: 3.4,
    base: { ...STAND, anchor: 'toes', at: [0, 0.12, 0], uarm: 0, farm: 0, uarmAb: 8, farmAb: 4, footAb: 6, thighAb: 4, shinAb: 0 },
    frames: [
      { pose: { foot: 82 }, dur: .5, phase: 'hold' },
      { pose: { foot: 82 }, dur: 1.0, phase: 'con' },
      { pose: { foot: 22 }, dur: .8, phase: 'hold' },
      { pose: { foot: 22 }, dur: 1.6, phase: 'ecc' },
    ]
  },
  front_squat: {
    props: ['barbell'], barAt: 'front', camTarget: [0, .85, 0], camDist: 3.6,
    base: { ...STAND, handT: [0.21, 0.01, 0.11], elbowPole: [0.05, 0.45, 1], grip: 60, thighAb: 11, shinAb: -1, footAb: 24, neck: 184, head: 186 },
    frames: [ { pose: {}, dur: .6, phase: 'hold' }, { pose: {}, dur: 2.0, phase: 'ecc' },
      { pose: { trunk: 150, thigh: 102, shin: -44, thighAb: 30, shinAb: -6, neck: 172, head: 178, pelvisTilt: -6 }, dur: .35, phase: 'hold' },
      { pose: { trunk: 150, thigh: 102, shin: -44, thighAb: 30, shinAb: -6, neck: 172, head: 178, pelvisTilt: -6 }, dur: 1.3, phase: 'con' } ]
  },
  goblet: {
    props: ['db1'], db1Off: [0, -0.07, 0.04], camTarget: [0, .85, 0], camDist: 3.4,
    base: { ...STAND, handT: [0.07, -0.18, 0.2], elbowPole: [0.2, -1, 0.3], grip: 80, thighAb: 11, shinAb: -1, footAb: 24, neck: 184, head: 186 },
    frames: [ { pose: {}, dur: .6, phase: 'hold' }, { pose: {}, dur: 2.0, phase: 'ecc' },
      { pose: { trunk: 145, thigh: 102, shin: -42, thighAb: 32, shinAb: -6, neck: 170, head: 176, pelvisTilt: -6 }, dur: .35, phase: 'hold' },
      { pose: { trunk: 145, thigh: 102, shin: -42, thighAb: 32, shinAb: -6, neck: 170, head: 176, pelvisTilt: -6 }, dur: 1.3, phase: 'con' } ]
  },
  db_squat: {
    props: ['db2'], camTarget: [0, .85, 0], camDist: 3.4,
    base: { ...STAND, uarm: 0, farm: 0, uarmAb: 9, farmAb: 2, grip: 85, thighAb: 9, shinAb: -1, footAb: 18, neck: 184, head: 186 },
    frames: [ { pose: {}, dur: .6, phase: 'hold' }, { pose: {}, dur: 2.0, phase: 'ecc' },
      { pose: { trunk: 138, thigh: 98, shin: -40, thighAb: 26, shinAb: -6, neck: 165, head: 175, pelvisTilt: -6, uarm: -2, farm: -2, uarmAb: 20 }, dur: .35, phase: 'hold' },
      { pose: { trunk: 138, thigh: 98, shin: -40, thighAb: 26, shinAb: -6, neck: 165, head: 175, pelvisTilt: -6, uarm: -2, farm: -2, uarmAb: 20 }, dur: 1.3, phase: 'con' } ]
  },
  knee_pushup: {
    camTarget: [0, .3, .5], camDist: 2.8,
    base: { knees: 1, plankH: .62, handFloor: [0.29, 0.035, -0.02], elbowPole: [0.75, 0.05, -1], wrist: 90, thighAb: 4, grip: 10 },
    frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.8, phase: 'ecc' }, { pose: { plankH: .28 }, dur: .25, phase: 'hold' }, { pose: { plankH: .28 }, dur: 1.1, phase: 'con' } ]
  },
  diamond_pushup: {
    camTarget: [0, .3, .7], camDist: 3.0,
    base: { plankH: .64, handFloor: [0.05, 0.035, 0.03], elbowPole: [0.25, 0.25, -1], wrist: 90, thighAb: 4, footAb: 4, grip: 10 },
    frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.8, phase: 'ecc' }, { pose: { plankH: .3 }, dur: .25, phase: 'hold' }, { pose: { plankH: .3 }, dur: 1.1, phase: 'con' } ]
  },
  chinup: {
    props: ['pullbar'], camTarget: [0, 1.8, 0], camDist: 5.0, barY: 2.76,
    base: { anchor: 'hands', at: [0, 2.76, 0], grip: 90, handLen: 0.06 },
    frames: [
      { pose: { ...PU_HANG, uarmAb: 8, farmAb: 4, farmTw: 170 }, dur: .6, phase: 'hold' }, { pose: { ...PU_HANG, uarmAb: 8, farmAb: 4, farmTw: 170 }, dur: 1.2, phase: 'con' },
      { pose: { ...PU_TOP, uarm: 30, uarmAb: 14, farm: 178, farmAb: -2, farmTw: 170 }, dur: .4, phase: 'hold' }, { pose: { ...PU_TOP, uarm: 30, uarmAb: 14, farm: 178, farmAb: -2, farmTw: 170 }, dur: 2.0, phase: 'ecc' } ]
  },
  rdl: {
    props: ['barbell'], barAt: 'hands', camTarget: [0, .8, 0], camDist: 3.6,
    base: { ...STAND, thigh: 4, shin: -4, uarm: -2, farm: -2, uarmAb: 7, farmAb: 3, grip: 85, footAb: 8, thighAb: 6 },
    frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 2.0, phase: 'ecc' },
      { pose: { trunk: 104, thigh: 22, shin: -12, neck: 115, head: 105, uarm: 2, farm: 2, pelvisTilt: 4 }, dur: .3, phase: 'hold' },
      { pose: { trunk: 104, thigh: 22, shin: -12, neck: 115, head: 105, uarm: 2, farm: 2, pelvisTilt: 4 }, dur: 1.3, phase: 'con' } ]
  },
  sumo: {
    props: ['barbell'], barAt: 'hands', camTarget: [0, .75, 0], camDist: 3.6,
    base: { ...STAND, thighAb: 28.5, shinAb: 0, footAb: 38, uarm: 0, farm: 0, uarmAb: 2, farmAb: 0, grip: 85 },
    frames: [ { pose: { trunk: 118, thigh: 64, shin: 0, thighAb: 30, shinAb: 0, uarm: -2, farm: -2, neck: 145, head: 125 }, dur: .6, phase: 'hold' },
      { pose: { trunk: 118, thigh: 64, shin: 0, thighAb: 30, shinAb: 0, uarm: -2, farm: -2, neck: 145, head: 125 }, dur: 1.4, phase: 'con' },
      { pose: {}, dur: .6, phase: 'hold' }, { pose: {}, dur: 1.6, phase: 'ecc' } ]
  },
  good_morning: {
    props: ['barbell'], barAt: 'back', camTarget: [0, .9, 0], camDist: 3.6,
    base: { ...STAND, thigh: 1, shin: -1, handT: [0.52, -0.06, -0.15], elbowPole: [0.2, -1, -0.6], grip: 100, thighAb: 8, footAb: 10, neck: 184, head: 186 },
    frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 2.0, phase: 'ecc' },
      { pose: { trunk: 94, thigh: 10, shin: -4, neck: 104, head: 98, pelvisTilt: 4 }, dur: .3, phase: 'hold' },
      { pose: { trunk: 94, thigh: 10, shin: -4, neck: 104, head: 98, pelvisTilt: 4 }, dur: 1.3, phase: 'con' } ]
  },
  bb_calf: {
    props: ['barbell', 'block'], barAt: 'back', camTarget: [0, .9, 0], camDist: 3.6,
    base: { ...STAND, anchor: 'toes', at: [0, 0.12, 0], handT: [0.52, -0.06, -0.15], elbowPole: [0.2, -1, -0.6], grip: 100, footAb: 6, thighAb: 4 },
    frames: [ { pose: { foot: 82 }, dur: .5, phase: 'hold' }, { pose: { foot: 82 }, dur: 1.0, phase: 'con' }, { pose: { foot: 22 }, dur: .8, phase: 'hold' }, { pose: { foot: 22 }, dur: 1.6, phase: 'ecc' } ]
  },
  plank: {
    camTarget: [0, .3, .6], camDist: 3.0,
    base: { plankH: .36, handFloor: [0.16, 0.03, 0.30], elbowPole: [0.1, -1, 0.0], wrist: 90, thighAb: 3, footAb: 4, grip: 30 },
    frames: [ { pose: {}, dur: 2, phase: 'hold' }, { pose: {}, dur: 2, phase: 'hold' } ]
  },
  knee_plank: {
    camTarget: [0, .3, .5], camDist: 2.8,
    base: { knees: 1, plankH: .36, handFloor: [0.16, 0.03, 0.30], elbowPole: [0.1, -1, 0.0], wrist: 90, thighAb: 3, grip: 30 },
    frames: [ { pose: {}, dur: 2, phase: 'hold' }, { pose: {}, dur: 2, phase: 'hold' } ]
  },
  bb_shrug: {
    props: ['barbell'], barAt: 'hands', camTarget: [0, 1.0, 0], camDist: 3.4,
    base: { ...STAND, uarm: -2, farm: -2, uarmAb: 9, farmAb: 3, grip: 85, footAb: 8, thighAb: 5, shrug: 0 },
    frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: .9, phase: 'con' }, { pose: { shrug: 1 }, dur: .8, phase: 'hold' }, { pose: { shrug: 1 }, dur: 1.4, phase: 'ecc' } ]
  },
};
MO.db_shrug = { ...MO.bb_shrug, props: ['db2'], barAt: undefined };

MO.curl_bb = { props: ['barbell'], barAt: 'hands', camTarget: [0, 1.1, 0], camDist: 3.0,
  base: { ...STAND, uarm: 3, uarmAb: 9, farm: 3, farmAb: 9, farmTw: -90, grip: 85, footAb: 8, thighAb: 5 },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.2, phase: 'con' }, { pose: { uarm: 8, farm: 150 }, dur: .5, phase: 'hold' }, { pose: { uarm: 8, farm: 150 }, dur: 1.8, phase: 'ecc' } ] };

MO.curl_db = { ...MO.curl_bb, props: ['db2'], barAt: undefined, base: { ...MO.curl_bb.base, uarmAb: 7, farmAb: 7, farmTw: 0 },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.2, phase: 'con' }, { pose: { uarm: 8, farm: 150, farmTw: -90 }, dur: .5, phase: 'hold' }, { pose: { uarm: 8, farm: 150, farmTw: -90 }, dur: 1.8, phase: 'ecc' } ] };
MO.curl_hammer = { ...MO.curl_db, frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.2, phase: 'con' }, { pose: { uarm: 8, farm: 150 }, dur: .5, phase: 'hold' }, { pose: { uarm: 8, farm: 150 }, dur: 1.8, phase: 'ecc' } ] };
const FW = { ...STAND, uarm: 0, farm: 0, uarmAb: 9, farmAb: 7, grip: 90, footAb: 8, thighAb: 4 };
MO.farmer = { props: ['db2'], camTarget: [0, .95, 0], camDist: 3.4, base: FW,
  frames: [ { pose: { anchor: 'b:foot_r' }, dur: .25, phase: 'hold' }, { pose: { anchor: 'b:foot_r', thigh_l: 26, shin_l: -22, foot_l: 75, trunk: 182 }, dur: .35, phase: 'con' },
    { pose: { anchor: 'b:foot_r' }, dur: .05, phase: 'con' }, { pose: { anchor: 'b:foot_l' }, dur: .25, phase: 'hold' },
    { pose: { anchor: 'b:foot_l', thigh_r: 26, shin_r: -22, foot_r: 75, trunk: 182 }, dur: .35, phase: 'con' }, { pose: { anchor: 'b:foot_l' }, dur: .05, phase: 'con' } ] };
MO.ohp_bb = { props: ['barbell'], barAt: 'hands', camTarget: [0, 1.35, 0], camDist: 4.3,
  base: { ...STAND, handT: [0.27, 0.03, 0.12], elbowPole: [0.3, -1, 0.9], grip: 85, footAb: 8, thighAb: 6, neck: 184, head: 186 },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: { handT: [0.27, 0.36, 0.08], elbowPole: [1, -.5, .3], head: 176, neck: 178 }, dur: .6, phase: 'con' }, { pose: { handT: [0.27, 0.74, -0.01], elbowPole: [1, 0, 0] }, dur: .5, phase: 'hold' },
    { pose: { handT: [0.27, 0.74, -0.01], elbowPole: [1, 0, 0] }, dur: .9, phase: 'ecc' }, { pose: { handT: [0.27, 0.36, 0.08], elbowPole: [1, -.5, .3], head: 176, neck: 178 }, dur: .9, phase: 'ecc' } ] };
MO.ohp_db = { props: ['db2'], camTarget: [0, 1.35, 0], camDist: 4.2,
  base: { ...STAND, handT: [0.27, 0.05, 0.03], elbowPole: [1, -1, 0], grip: 85, footAb: 8, thighAb: 6 },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.2, phase: 'con' }, { pose: { handT: [0.2, 0.76, 0.0], elbowPole: [1, 0, 0] }, dur: .5, phase: 'hold' }, { pose: { handT: [0.2, 0.76, 0.0], elbowPole: [1, 0, 0] }, dur: 1.8, phase: 'ecc' } ] };

const LB = { ...STAND, uarm: 0, farm: 0, uarmAb: 9, farmAb: 7, grip: 90, footAb: 6, thighAb: 6, thighAb_r: 4, shinAb: 0 };
const L_BOT = { thigh_l: 82, shin_l: -6, thigh_r: -24, shin_r: -94, foot_r: 35 };
const L_PLANT = { thigh_l: 41, shin_l: 21, thigh_r: -44, shin_r: -36, foot_r: 35 };
MO.lunge_db = { props: ['db2'], camTarget: [0, .8, 0], camDist: 3.8, view: 'side', base: { ...LB, anchor: 'b:ball_r', at: [-0.19, 0.0, -0.55] },
  frames: [ { pose: {}, dur: .4, phase: 'hold' }, { pose: { thigh_l: 50, shin_l: -25, foot_l: 75, foot_r: 50 }, dur: .45, phase: 'ecc' }, { pose: L_PLANT, dur: .5, phase: 'ecc' },
    { pose: L_BOT, dur: .35, phase: 'hold' }, { pose: L_BOT, dur: .8, phase: 'con' }, { pose: L_PLANT, dur: .45, phase: 'con' }, { pose: { thigh_l: 50, shin_l: -25, foot_l: 75, foot_r: 50 }, dur: .4, phase: 'con' } ] };
MO.lunge_bb_rev = { props: ['barbell'], barAt: 'back', camTarget: [0, .85, 0], camDist: 3.8, view: 'side',
  base: { ...LB, anchor: 'b:foot_l', at: [0.19, 0, 0.55], handT: [0.52, -0.06, -0.15], elbowPole: [0.2, -1, -0.6], grip: 100, neck: 184, head: 186 },
  frames: [ { pose: {}, dur: .4, phase: 'hold' }, { pose: { thigh_r: -18, shin_r: -70, foot_r: 20 }, dur: .45, phase: 'ecc' }, { pose: L_PLANT, dur: .5, phase: 'ecc' },
    { pose: L_BOT, dur: .35, phase: 'hold' }, { pose: L_BOT, dur: .8, phase: 'con' }, { pose: L_PLANT, dur: .45, phase: 'con' }, { pose: { thigh_r: -18, shin_r: -70, foot_r: 20 }, dur: .4, phase: 'con' } ] };
const BSS_TOP = { trunk: 178, thigh_l: 10, shin_l: -6, thigh_r: -40, shin_r: -75, foot_r: -66 };
const BSS_BOT = { trunk: 175, thigh_l: 76, shin_l: 6, thigh_r: -4, shin_r: -150, foot_r: -66 };
MO.bss = { props: ['db2'], boxes: [[-0.18, 0, -0.62, 0.4, 0.44, 0.5, 0x3b2a22]], camTarget: [0, .8, 0], camDist: 3.8, view: 'side',
  base: { ...LB, anchor: 'b:foot_l', at: [0.19, 0, 0.45], ...BSS_TOP },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.6, phase: 'ecc' }, { pose: BSS_BOT, dur: .35, phase: 'hold' }, { pose: BSS_BOT, dur: 1.2, phase: 'con' } ] };
const SU_START = { trunk: 165, thigh_l: 75, shin_l: -12, thigh_r: 3, shin_r: 2, foot_r: 65 };
MO.step_up = { props: ['db2'], boxes: [[0, 0, 0.6, 0.6, 0.42, 0.45, 0x3b2a22]], camTarget: [0, .95, 0.3], camDist: 4.0, view: 'side',
  base: { ...LB, anchor: 'b:foot_l', at: [0.12, 0.42, 0.62], ...SU_START },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.0, phase: 'con' }, { pose: { trunk: 180, thigh_l: 0, shin_l: 0, thigh_r: 55, shin_r: -40, foot_r: 75 }, dur: .4, phase: 'con' },
    { pose: { trunk: 180, thigh_l: 0, shin_l: 0, thigh_r: 0, shin_r: 0, foot_r: 63 }, dur: .6, phase: 'hold' }, { pose: { trunk: 180, thigh_l: 0, shin_l: 0, thigh_r: 55, shin_r: -40, foot_r: 75 }, dur: .5, phase: 'ecc' }, { pose: { trunk: 172, thigh_l: 40, shin_l: -8, thigh_r: 10, shin_r: -10, foot_r: 70 }, dur: .7, phase: 'ecc' } ] };
const TB_BOT = { trunk: 137, thigh: 80, shin: -27, uarm: -4, farm: -4, neck: 150, head: 130 };
MO.dl_trap = { props: ['trapbar'], camTarget: [0, .75, 0], camDist: 3.8,
  base: { ...STAND, uarm: -2, farm: -2, uarmAb: 10, farmAb: 8, grip: 90, footAb: 10, thighAb: 10, shinAb: -2 },
  frames: [ { pose: TB_BOT, dur: .6, phase: 'hold' }, { pose: TB_BOT, dur: 1.3, phase: 'con' }, { pose: {}, dur: .6, phase: 'hold' }, { pose: {}, dur: 1.7, phase: 'ecc' } ] };
const KB_BACK = { trunk: 112, thigh: 40, shin: -14, uarm: -22, farm: -22, neck: 140, head: 120 };
MO.kb_swing = { props: ['kb'], camTarget: [0, .9, .2], camDist: 3.8, view: 'side',
  base: { ...STAND, uarm: 0, farm: 0, uarmAb: 3, farmAb: 2, grip: 90, footAb: 14, thighAb: 13, shinAb: -2, handT: undefined },
  frames: [ { pose: KB_BACK, dur: .25, phase: 'hold' }, { pose: KB_BACK, dur: .45, phase: 'con' }, { pose: { uarm: 92, farm: 92 }, dur: .2, phase: 'hold' }, { pose: { uarm: 92, farm: 92 }, dur: .5, phase: 'ecc' } ] };
const SEAT = [[0, 0, -0.55, 0.38, 0.45, 0.6, 0x3b2a22]], BACKREST = [0, 0.45, -0.8, 0.38, 0.78, 0.07, 0x3b2a22];
const SIT = { trunk: 180, thigh: 90, shin: 0, foot: 63, thighAb: 10, footAb: 10 };
MO.ohp_db_seated = { ...MO.ohp_db, boxes: [...SEAT, BACKREST], camTarget: [0, 1.0, -.3], base: { ...MO.ohp_db.base, ...SIT } };
MO.ohp_arnold = { props: ['db2'], boxes: [...SEAT, BACKREST], camTarget: [0, 1.0, -.3], camDist: 3.6,
  base: { ...SIT, handT: [0.13, 0.0, 0.13], elbowPole: [0.1, -1, 0.4], ikTw: 70, grip: 85 },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: { handT: [0.27, 0.12, 0.05], elbowPole: [1, -1, 0], ikTw: 0 }, dur: .7, phase: 'con' }, { pose: { handT: [0.2, 0.76, 0.0], elbowPole: [1, 0, 0], ikTw: 0 }, dur: .6, phase: 'con' },
    { pose: { handT: [0.2, 0.76, 0.0], elbowPole: [1, 0, 0], ikTw: 0 }, dur: .4, phase: 'hold' }, { pose: { handT: [0.27, 0.12, 0.05], elbowPole: [1, -1, 0], ikTw: 0 }, dur: .8, phase: 'ecc' }, { pose: {}, dur: .7, phase: 'ecc' } ] };
MO.lat_raise = { props: ['db2'], boxes: SEAT, camTarget: [0, 1.0, -.3], camDist: 3.6,
  base: { ...SIT, trunk: 176, uarm: 4, farm: 10, uarmAb: 10, farmAb: 10, grip: 85 },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.1, phase: 'con' }, { pose: { uarm: 22, farm: 30, uarmAb: 86, farmAb: 72 }, dur: .4, phase: 'hold' }, { pose: { uarm: 22, farm: 30, uarmAb: 86, farmAb: 72 }, dur: 1.8, phase: 'ecc' } ] };

const BENCH = [[0, 0, -0.35, 0.3, 0.44, 1.25, 0x3b2a22]];
const SUP = { anchor: 'hip', at: [0, 0.56, 0.05], trunk: -90, pelvisTilt: 5, neck: -92, head: -92, thigh: 90, shin: 0, foot: 65, thighAb: 18, shinAb: 0, footAb: 14, grip: 92, elbowPole: [0, -1, 0] };
const fr4 = (A, B, d = [.5, 1.8, .3, 1.2]) => [ { pose: A, dur: d[0], phase: 'hold' }, { pose: A, dur: d[1], phase: 'ecc' }, { pose: B, dur: d[2], phase: 'hold' }, { pose: B, dur: d[3], phase: 'con' } ];
MO.bench_bb = { props: ['barbell'], barAt: 'hands', boxes: BENCH, camTarget: [0, .75, -.2], camDist: 3.4, view: 'three',
  base: { ...SUP, handT: [0.33, -0.14, 0.76] }, frames: fr4({}, { handT: [0.33, -0.11, 0.07] }) };
MO.bench_cg = { ...MO.bench_bb, base: { ...SUP, handT: [0.22, -0.16, 0.76], elbowPole: [0, -1, 0.3] }, frames: fr4({}, { handT: [0.22, -0.17, 0.06] }) };
MO.bench_db = { props: ['db2'], boxes: BENCH, camTarget: [0, .75, -.2], camDist: 3.4, view: 'three',
  base: { ...SUP, handT: [0.2, -0.13, 0.76], ikTw: 0 }, frames: fr4({}, { handT: [0.34, -0.11, 0.1] }) };
MO.fly_db = { props: ['db2'], boxes: BENCH, camTarget: [0, .75, -.2], camDist: 3.4, view: 'three',
  base: { ...SUP, handT: undefined, elbowPole: undefined, uarm: 180, uarmAb: 10, farm: 180, farmAb: -12, farmTw: 90 }, frames: fr4({}, { uarmAb: 84, farmAb: 62 }, [.5, 1.8, .3, 1.4]) };
MO.skull = { props: ['db2'], boxes: BENCH, camTarget: [0, .75, -.2], camDist: 3.4, view: 'side',
  base: { ...SUP, uarm: -172, uarmAb: 6, farm: -172, farmAb: 4, farmTw: 0, grip: 90, elbowPole: undefined }, frames: fr4({}, { farm: -92 }, [.5, 1.6, .3, 1.2]) };
const INC = [[0, 0, 0.1, 0.32, 0.44, 0.5, 0x3b2a22], [0, 0.65, -0.46, 0.3, 0.12, 1.0, 0x3b2a22, 35]];
const ISUP = { ...SUP, at: [0, 0.58, 0.0], trunk: -125, neck: -127, head: -127 };
MO.bench_inc_bb = { props: ['barbell'], barAt: 'hands', boxes: INC, camTarget: [0, .95, -.2], camDist: 3.4, view: 'three',
  base: { ...ISUP, handT: [0.33, -0.12, 0.76] }, frames: fr4({}, { handT: [0.33, -0.06, 0.07] }) };
MO.bench_inc_db = { props: ['db2'], boxes: INC, camTarget: [0, .95, -.2], camDist: 3.4, view: 'three',
  base: { ...ISUP, handT: [0.2, -0.11, 0.76], ikTw: 0 }, frames: fr4({}, { handT: [0.34, -0.06, 0.1] }) };

MO.rdl_single = { props: ['db2'], dbHands: ['r'], camTarget: [0, .8, -.2], camDist: 3.6, view: 'side',
  base: { ...STAND, anchor: 'b:foot_l', at: [0.12, 0, 0], uarm: 0, farm: 0, uarmAb: 8, farmAb: 6, grip: 90, thigh_l: 6, shin_l: -6, thigh_r: -4, shin_r: -24, foot_r: 40, footAb: 8, thighAb: 4 },
  frames: fr4({}, { trunk: 98, neck: 104, head: 96, thigh_l: 20, shin_l: -10, thigh_r: -82, shin_r: -82, foot_r: -8, uarm: 2, farm: 2, uarmAb_r: -22, farmAb_r: -22 }, [.5, 2.0, .3, 1.4]) };
MO.oh_ext = { props: ['db1'], db1Off: [0, -0.1, 0], boxes: SEAT, camTarget: [0, 1.1, -.3], camDist: 3.6, view: 'side',
  base: { ...SIT, handT: [0.03, 0.74, -0.02], elbowPole: [0.2, 1, 0.4], grip: 70 }, frames: fr4({}, { handT: [0.03, 0.3, -0.2] }, [.5, 1.8, .3, 1.2]) };
MO.lean_raise = { props: ['db2'], dbHands: ['r'], boxes: [[0.72, 0, 0, 0.08, 1.9, 0.08, 0x777d86]], camTarget: [0.2, 1.0, 0], camDist: 3.8, view: 'front',
  base: { ...STAND, bodyRot: [0, 0, 12], uarm_l: 0, uarmAb_l: 68, farm_l: 0, farmAb_l: 68, uarm_r: 4, uarmAb_r: 8, farm_r: 8, farmAb_r: 8, grip: 90, footAb: 8, thighAb: 3 },
  frames: fr4({}, { uarm_r: 12, uarmAb_r: 88, farm_r: 20, farmAb_r: 78 }, [.5, 1.1, .4, 1.8]).map(f => ({ ...f, phase: f.phase === 'ecc' ? 'con' : f.phase === 'con' ? 'ecc' : 'hold' })) };
MO.row_bb = { props: ['barbell'], barAt: 'hands', camTarget: [0, .8, 0], camDist: 3.6, view: 'side',
  base: { ...STAND, trunk: 132, neck: 140, head: 128, thigh: 26, shin: -12, uarm: 0, farm: 0, uarmAb: 8, farmAb: 7, farmTw: -90, grip: 88, footAb: 10, thighAb: 8 },
  frames: fr4({}, { uarm: -62, farm: 28, uarmAb: 12 }, [.5, 1.0, .4, 1.6]).map(f => ({ ...f, phase: f.phase === 'ecc' ? 'con' : f.phase === 'con' ? 'ecc' : 'hold' })) };

MO.row_db = { props: ['db2'], dbHands: ['r'], boxes: [[0.2, 0, 0.17, 0.34, 0.44, 1.4, 0x3b2a22]], camTarget: [0, .75, .3], camDist: 3.6, view: 'three',
  base: { anchor: 'b:foot_r', at: [-0.2, 0, 0.2], trunk: 100, neck: 106, head: 98, foot: 63, thighAb_r: 10, thigh_r: 24, shin_r: 10, thigh_l: 14, shin_l: -90, foot_l: -80,
    uarm_l: 25, farm_l: 30, uarmAb_l: 4, farmAb_l: 4, grip_l: 0, uarm_r: 0, farm_r: 0, uarmAb_r: 6, farmAb_r: 4, grip: 90 },
  frames: fr4({}, { uarm_r: -62, farm_r: 18, uarmAb_r: 8 }, [.5, 1.0, .5, 1.6]).map(f => ({ ...f, phase: f.phase === 'ecc' ? 'con' : f.phase === 'con' ? 'ecc' : 'hold' })) };
const IR_B = { trunk: -97, neck: -99, head: -102, thigh: 83, shin: 83, foot: 158, uarm: 180, farm: 180 };
const IR_T = { trunk: -122, neck: -124, head: -127, thigh: 58, shin: 58, foot: 133, uarm: 5, farm: 220 };
MO.inv_row = { props: ['pullbar'], barY: 1.0, camTarget: [0, .55, .6], camDist: 3.6, view: 'side', base: { anchor: 'b:foot_l', at: [0.219, 0.031, 1.523], handW: [0.43, 1.0, -0.01], gripIK: 1, elbowPole: [0.6, -1, 0.3], grip: 90, handLen: 0.06, thighAb: 4 },
  frames: fr4(IR_B, IR_T, [.5, 1.1, .5, 1.6]).map(f => ({ ...f, phase: f.phase === 'ecc' ? 'con' : f.phase === 'con' ? 'ecc' : 'hold' })) };
const BARS = [[0.27, 1.2, 0, 0.05, 0.05, 0.9, 0x777d86], [-0.27, 1.2, 0, 0.05, 0.05, 0.9, 0x777d86], [0.27, 0, 0.4, 0.05, 1.2, 0.05, 0x777d86], [-0.27, 0, 0.4, 0.05, 1.2, 0.05, 0x777d86], [0.27, 0, -0.4, 0.05, 1.2, 0.05, 0x777d86], [-0.27, 0, -0.4, 0.05, 1.2, 0.05, 0x777d86]];
MO.dip = { boxes: BARS, camTarget: [0, 1.1, 0], camDist: 4.0, view: 'side', base: { anchor: 'hands', at: [0, 1.25, 0], grip: 60, uarm: 0, farm: 0, uarmAb: 12, farmAb: 8, trunk: 176, neck: 182, head: 184, thigh: 4, shin: -40, foot: 40 },
  frames: fr4({}, { uarm: -78, farm: 6, trunk: 172 }, [.5, 1.6, .3, 1.2]) };
MO.bench_dip = { boxes: [[0, 0, -0.45, 1.0, 0.44, 0.35, 0x3b2a22]], camTarget: [0, .55, 0.2], camDist: 3.4, view: 'side',
  base: { anchor: 'b:foot_l', at: [0.206, 0.02, 0.68], handW: [0.30, 0.45, -0.27], gripIK: 1, elbowPole: [0.2, 0, -1], grip: 40, trunk: 180, neck: 184, head: 186, thigh: 60, shin: 53, foot: 150 },
  frames: fr4({}, { thigh: 99, shin: 40, trunk: 178 }, [.5, 1.6, .3, 1.2]) };

// walking lunge that actually travels: left lunge → rise onto left → right lunge → rise onto right; ~2.49 m per cycle, camera follows
const WL = { ...STAND, uarm: 0, farm: 0, uarmAb: 9, farmAb: 7, grip: 90, footAb: 6, thighAb: 5, shinAb: 0 };
const P0 = [-0.19, 0, -1.25], P1 = [P0[0] + 0.401, -0.018, P0[2] + 1.247], P2 = [P0[0], 0, P0[2] + 2.494];
const swapLR = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_l$/, '_X').replace(/_r$/, '_l').replace(/_X$/, '_r'), v]));
const LSW = { thigh_l: 50, shin_l: -25, foot_l: 75 }, LRISE = { thigh_r: -20, shin_r: -50, foot_r: 40 };
const A = (an, at, p) => ({ anchor: an, at, ...p });
MO.lunge_walk = { follow: true, travel: [0, 0, 2.494], camTarget: [0, .85, -1.25 + 0.3], camDist: 4.0, view: 'side', base: WL,
  frames: [
    { pose: A('b:ball_r', P0, LSW), dur: .45, phase: 'ecc' }, { pose: A('b:ball_r', P0, L_PLANT), dur: .5, phase: 'ecc' },
    { pose: A('b:ball_r', P0, L_BOT), dur: .3, phase: 'hold' }, { pose: A('b:ball_r', P0, L_BOT), dur: .01, phase: 'con' },
    { pose: A('b:ball_l', P1, L_BOT), dur: .7, phase: 'con' }, { pose: A('b:ball_l', P1, LRISE), dur: .4, phase: 'con' },
    { pose: A('b:ball_l', P1, swapLR(LSW)), dur: .5, phase: 'ecc' }, { pose: A('b:ball_l', P1, swapLR(L_PLANT)), dur: .5, phase: 'ecc' },
    { pose: A('b:ball_l', P1, swapLR(L_BOT)), dur: .3, phase: 'hold' }, { pose: A('b:ball_l', P1, swapLR(L_BOT)), dur: .01, phase: 'con' },
    { pose: A('b:ball_r', P2, swapLR(L_BOT)), dur: .7, phase: 'con' }, { pose: A('b:ball_r', P2, swapLR(LRISE)), dur: .4, phase: 'con' },
  ] };

// ---- Batch 4: cables & machines ----
const TOWER = (z, x = 0) => [x, 0, z, 0.5, 2.3, 0.1, 0x555a63];
const CS = { ...STAND, uarmAb: 9, farmAb: 7, grip: 88, footAb: 8, thighAb: 5 };
const rev = fr => fr.map(f => ({ ...f, phase: f.phase === 'ecc' ? 'con' : f.phase === 'con' ? 'ecc' : 'hold' }));
MO.pressdown = { hbar: [0.45], boxes: [TOWER(0.62)], cables: [[[0, 2.2, 0.55], 'mid']], camTarget: [0, 1.1, .2], camDist: 3.4, view: 'side',
  base: { ...CS, trunk: 172, neck: 178, head: 176, uarm: -6, uarmAb: 8, farm: 95, farmTw: 0 },
  frames: rev(fr4({}, { farm: -4 }, [.4, 1.0, .5, 1.6])) };
MO.cable_curl = { hbar: [0.5], boxes: [TOWER(0.62)], cables: [[[0, 0.12, 0.55], 'mid']], camTarget: [0, 1.0, .2], camDist: 3.4, view: 'side',
  base: { ...CS, uarm: 3, farm: 3, farmTw: -90, grip: 85 },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.2, phase: 'con' }, { pose: { uarm: 8, farm: 150 }, dur: .5, phase: 'hold' }, { pose: { uarm: 8, farm: 150 }, dur: 1.8, phase: 'ecc' } ] };
MO.front_raise_c = { hbar: [0.45], boxes: [TOWER(-0.62)], cables: [[[0, 0.12, -0.55], 'mid']], camTarget: [0, 1.0, 0], camDist: 3.6, view: 'side',
  base: { ...CS, thighAb: 9, uarm: 4, farm: 8, uarmAb: 6, farmAb: 4 },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.2, phase: 'con' }, { pose: { uarm: 90, farm: 95 }, dur: .4, phase: 'hold' }, { pose: { uarm: 90, farm: 95 }, dur: 1.8, phase: 'ecc' } ] };
MO.cable_cross = { props: ['db2'], dbHands: [], boxes: [TOWER(-0.3, 0.85), TOWER(-0.3, -0.85)], cables: [[[0.8, 1.95, -0.3], 'l'], [[-0.8, 1.95, -0.3], 'r']], camTarget: [0, 1.1, 0], camDist: 3.8, view: 'three',
  base: { ...CS, trunk: 168, neck: 176, head: 174, thigh_l: 12, shin_l: -4, thigh_r: -10, shin_r: -6, handT: [0.62, 0.12, 0.08], elbowPole: [0.6, 0.3, -1], grip: 90, wrist: 0 },
  frames: rev(fr4({}, { handT: [0.07, -0.36, 0.46], elbowPole: [1, 0.2, -0.5] }, [.4, 1.0, .6, 1.8])) };
MO.face_pull = { hbar: [0.22, 0x222222], boxes: [TOWER(0.95)], cables: [[[0, 1.62, 0.88], 'mid']], camTarget: [0, 1.25, .3], camDist: 3.6, view: 'three',
  base: { ...CS, trunk: 176, handT: [0.07, -0.02, 0.6], elbowPole: [1, 0.2, -0.4], grip: 90 },
  frames: rev(fr4({}, { handT: [0.24, 0.12, 0.06], elbowPole: [1, 0.5, -0.6] }, [.4, 1.0, .6, 1.6])) };
const PD_SEAT = [[0, 0, -0.55, 0.38, 0.45, 0.42, 0x3b2a22], [0, 1.0, -0.65, 0.12, 1.55, 0.1, 0x555a63]];
MO.lat_pd = { hbar: [1.2], boxes: PD_SEAT, track: [{ box: [0.5, 0.08, 0.1, 0x3b2a22], at: ['thigh_l', 'thigh_r'], fix: [0, 0.68, null], off: [0, 0, 0.18] }], cables: [[[0, 2.45, -0.38], 'mid']], camTarget: [0, 1.2, -.3], camDist: 3.8, view: 'three',
  base: { ...SIT, trunk: 186, neck: 190, head: 186, handT: [0.42, 0.62, 0.06], elbowPole: [1, -1, -0.2], grip: 88 },
  frames: rev(fr4({}, { handT: [0.36, 0.04, 0.12] }, [.4, 1.2, .5, 1.8])) };
MO.close_lat = { ...MO.lat_pd, hbar: [0.14, 0x777d86],
  base: { ...MO.lat_pd.base, handT: [0.06, 0.62, 0.1], elbowPole: [0.4, -1, -0.5] },
  frames: rev(fr4({}, { handT: [0.07, -0.02, 0.2] }, [.4, 1.2, .5, 1.8])) };
const CR_SEAT = [[0, 0, -0.28, 0.36, 0.3, 0.6, 0x3b2a22], [0, 0, 0.95, 0.5, 1.0, 0.1, 0x555a63]];
MO.cable_row = { hbar: [0.14, 0x777d86], boxes: CR_SEAT, track: [{ box: [0.45, 0.32, 0.04, 0x555a63], at: ['ball_l', 'ball_r', 'foot_l', 'foot_r'], off: [0, 0, 0.06] }], cables: [[[0, 0.68, 0.9], 'mid']], camTarget: [0, .6, .2], camDist: 3.4, view: 'side',
  base: { anchor: 'hip', at: [0, 0.43, -0.3], trunk: 172, neck: 178, head: 176, thigh: 80, shin: 72, foot: 140, thighAb: 8, shinAb: 0, footAb: 6, handT: [0.07, -0.2, 0.62], elbowPole: [0.3, -1, -1], grip: 90 },
  frames: rev(fr4({}, { trunk: 181, neck: 185, head: 182, handT: [0.1, -0.36, 0.14] }, [.4, 1.2, .5, 1.8])) };

const LP_BOX = [[0, 0, -0.45, 0.5, 0.35, 0.5, 0x555a63], [0, 0.3, -0.62, 0.42, 0.08, 0.45, 0x3b2a22, 0], [0, 0.5, -0.95, 0.42, 0.08, 0.75, 0x3b2a22, 38]];
MO.leg_press = { boxes: LP_BOX, track: [{ box: [0.62, 0.03, 0.55, 0x777d86], at: ['foot_l', 'foot_r'], rel: 'foot_l', roff: [0, -0.075, 0.04], rot: -45, fix: [0, null, null] }], camTarget: [0, .75, -.3], camDist: 3.8, view: 'side',
  base: { anchor: 'hip', at: [0, 0.48, -0.62], trunk: -128, pelvisTilt: 8, neck: -125, head: -120, thigh: 137, shin: 127, foot: 196, thighAb: 14, shinAb: 0, footAb: 10, uarm: 40, farm: 70, uarmAb: 22, farmAb: 10, grip: 80 },
  frames: fr4({}, { thigh: 180, shin: 96, foot: 194 }, [.4, 1.8, .3, 1.3]) };
MO.leg_curl = { boxes: [[0, 0, 0.25, 0.42, 0.5, 1.3, 0x3b2a22], [0, 0, -0.6, 0.1, 0.5, 0.1, 0x555a63]], track: [{ cyl: [0.05, 0.4, 0x222222], at: ['foot_l', 'foot_r'], rel: 'calf_l', roff: [0, -0.05, -0.08] }], camTarget: [0, .6, -.35], camDist: 3.6, view: 'side',
  base: { anchor: 'hip', at: [0, 0.62, -0.1], trunk: 92, pelvisTilt: 0, neck: 75, head: 70, thigh: -91, shin: -95, foot: -35, thighAb: 6, shinAb: 0, uarm: 100, uarmAb: 25, farm: 60, farmAb: -10, grip: 80 },
  frames: rev(fr4({}, { shin: -172, foot: -110 }, [.4, 1.1, .6, 1.9])) };
MO.seat_calf = { boxes: [[0, 0, -0.3, 0.4, 0.5, 0.42, 0x3b2a22], [0, 0, 0.16, 0.6, 0.12, 0.16, 0x4a4f58]], track: [{ box: [0.5, 0.08, 0.16, 0x222222], at: ['calf_l', 'calf_r'], off: [0, 0.08, 0] }], camTarget: [0, .7, 0], camDist: 3.0, view: 'side',
  base: { anchor: 'toes', at: [0, 0.12, 0.13], trunk: 178, thigh: 90, shin: 0, foot: 82, thighAb: 6, shinAb: 0, footAb: 6, uarm: 30, farm: 70, uarmAb: 12, grip: 80 },
  frames: fr4({ foot: 82 }, { foot: 82 }, [.3, .01, .01, .01]).slice(0, 1).concat([ { pose: { foot: 82 }, dur: 1.0, phase: 'con' }, { pose: { foot: 22 }, dur: .8, phase: 'hold' }, { pose: { foot: 22 }, dur: 1.6, phase: 'ecc' } ]) };

// ---- Batch 5: glutes & core ----
const MAT = [[0, 0, -0.3, 0.7, 0.012, 1.9, 0x2d4a5a]];
const HT_TOP = { handW: [0.4, 0.70, 0.05], trunk: -92, pelvisTilt: 0, neck: -110, head: -122, thigh: 90, shin: 0 };
const HT_BOT = { handW: [0.4, 0.38, -0.04], trunk: -128, pelvisTilt: 0, neck: -140, head: -152, thigh: 120, shin: 24 };
MO.hip_thrust = { props: ['barbell'], barAt: 'hands', boxes: [[0, 0, -0.75, 1.1, 0.42, 0.4, 0x3b2a22]], camTarget: [0, .5, -.1], camDist: 3.6, view: 'side',
  base: { anchor: 'b:foot_l', at: [0.196, 0, 0.5], foot: 63, thighAb: 8, shinAb: 0, footAb: 8, gripIK: 1, elbowPole: [1, 0.3, -0.5], grip: 90 },
  frames: [ { pose: HT_BOT, dur: .4, phase: 'hold' }, { pose: HT_BOT, dur: 1.0, phase: 'con' }, { pose: HT_TOP, dur: .8, phase: 'hold' }, { pose: HT_TOP, dur: 1.6, phase: 'ecc' } ] };
const GB_BOT = { anchor: 'hip', at: [0, 0.11, 0], trunk: -90, pelvisTilt: 5, neck: -92, head: -92, thigh: 135, shin: 30 };
const GB_TOP = { anchor: 'b:foot_l', at: [0.196, 0, 0.627], trunk: -65, pelvisTilt: 0, neck: -90, head: -92, thigh: 112, shin: 20 };
const GB = { foot: 63, thighAb: 8, shinAb: 0, footAb: 8, uarm: -80, farm: -80, uarmAb: 14, farmAb: 10, farmTw: 90, grip: 10 };
MO.glute_bridge = { boxes: MAT, camTarget: [0, .3, 0], camDist: 3.2, view: 'side', base: GB,
  frames: [ { pose: GB_BOT, dur: .4, phase: 'hold' }, { pose: GB_BOT, dur: .01, phase: 'con' }, { pose: { ...GB_BOT, anchor: 'b:foot_l', at: [0.196, 0, 0.627] }, dur: 1.0, phase: 'con' }, { pose: GB_TOP, dur: .9, phase: 'hold' }, { pose: GB_TOP, dur: 1.6, phase: 'ecc' } ] };
MO.single_hip = { ...MO.glute_bridge,
  frames: [ { pose: { ...GB_BOT, thigh_r: 132, shin_r: 132, foot_r: 160 }, dur: .4, phase: 'hold' }, { pose: { ...GB_BOT, thigh_r: 132, shin_r: 132, foot_r: 160 }, dur: .01, phase: 'con' }, { pose: { ...GB_BOT, anchor: 'b:foot_l', at: [0.196, 0, 0.627], thigh_r: 132, shin_r: 132, foot_r: 160 }, dur: 1.0, phase: 'con' }, { pose: { ...GB_TOP, thigh_r: 112, shin_r: 112, foot_r: 150 }, dur: .9, phase: 'hold' }, { pose: { ...GB_TOP, thigh_r: 112, shin_r: 112, foot_r: 150 }, dur: 1.6, phase: 'ecc' } ] };
const SL = { bodyRot: [0, 0, -90], anchor: 'hip', at: [0, 0.16, 0], trunk: 180, thigh: 0, shin: 0, foot: 40, thighAb: 2, shinAb: 0, footAb: 4, uarm_l: 180, farm_l: 150, uarmAb_l: 10, uarm_r: 30, farm_r: 60, uarmAb_r: 10, grip: 20, neck: 180, head: 180 };
MO.side_leg = { boxes: [[0, 0, 0, 1.9, 0.012, 0.7, 0x2d4a5a]], camTarget: [0.1, .35, 0], camDist: 3.4, view: 'front', base: SL,
  frames: rev(fr4({}, { thighAb_r: 40, shinAb_r: 0 }, [.4, 1.0, .5, 1.6])) };

const SP = { bodyRot: [0, 0, -75.5], anchor: 'b:lowerarm_l', at: [0.0, 0.05, 0], trunk: 180, thigh: 0, shin: 0, foot: 63, thighAb: 1, thighAb_r: -5, shinAb: 0, footAb: 2, uarm_l: 0, uarmAb_l: 75.5, farm_l: 90, farmAb_l: 0, uarm_r: 0, farm_r: 0, uarmAb_r: 12, grip_l: 20, grip_r: 10, neck: 180, head: 180 };
MO.side_plank = { boxes: [[-0.7, 0, 0.1, 2.1, 0.012, 0.8, 0x2d4a5a]], camTarget: [-0.6, .3, 0], camDist: 3.4, view: 'front', base: SP,
  frames: [ { pose: {}, dur: 1.5, phase: 'hold' }, { pose: { trunk: 181 }, dur: 1.5, phase: 'hold' } ] };
const PL = { anchor: 'hands', at: [0, 0.03, 0], uarm: 0, farm: 0, uarmAb: 4, farmAb: 4, grip: 10, thighAb: 4, shinAb: 0, trunk: 116, thigh: -64, shin: -64, foot: 34, neck: 131, head: 121 };
const KD = s => { const o = s === 'l' ? 'r' : 'l'; return { ['thigh_' + s]: 52, ['shin_' + s]: -55, ['foot_' + s]: 5, ['thigh_' + o]: -64, ['shin_' + o]: -64, ['foot_' + o]: 34 }; };
MO.climber = { camTarget: [0, .4, -.5], camDist: 3.4, view: 'side', base: PL,
  frames: [ { pose: KD('l'), dur: .12, phase: 'hold' }, { pose: KD('l'), dur: .3, phase: 'con' }, { pose: KD('r'), dur: .12, phase: 'hold' }, { pose: KD('r'), dur: .3, phase: 'con' } ] };
const SUPF = { anchor: 'hip', at: [0, 0.11, 0], trunk: -90, pelvisTilt: 8, neck: -92, head: -92, thighAb: 6, shinAb: 0, footAb: 6 };
const DB0 = { thigh: 180, shin: 90, foot: 150, uarm: 180, farm: 180, uarmAb: 6, farmAb: 4, grip: 30 };
const DB0S = { uarm_l: 180, farm_l: 180, uarm_r: 180, farm_r: 180, thigh_l: 180, thigh_r: 180, shin_l: 90, shin_r: 90, foot_l: 150, foot_r: 150 };
const DBX = s => { const o = s === 'l' ? 'r' : 'l'; return { ...DB0S, ['uarm_' + s]: -100, ['farm_' + s]: -100, ['thigh_' + o]: 100, ['shin_' + o]: 98, ['foot_' + o]: 158 }; };
MO.dead_bug = { boxes: MAT, camTarget: [0, .35, 0], camDist: 3.2, view: 'three', base: { ...SUPF, ...DB0 },
  frames: [ { pose: DB0S, dur: .4, phase: 'hold' }, { pose: DB0S, dur: 1.3, phase: 'ecc' }, { pose: DBX('l'), dur: .4, phase: 'hold' }, { pose: DBX('l'), dur: 1.0, phase: 'con' }, { pose: DB0S, dur: .4, phase: 'hold' }, { pose: DB0S, dur: 1.3, phase: 'ecc' }, { pose: DBX('r'), dur: .4, phase: 'hold' }, { pose: DBX('r'), dur: 1.0, phase: 'con' } ] };
const KB = { thigh: 135, shin: 30, foot: 63 };
const CR_UP = { trunk: -108, curve: -18, pelvisTilt: 26, neck: -125, head: -128 };
MO.crunch = { boxes: MAT, camTarget: [0, .3, 0], camDist: 3.0, view: 'side', base: { ...SUPF, ...KB, handT: [0.1, -0.2, 0.12], elbowPole: [1, -0.3, 0.5], grip: 40 },
  frames: [ { pose: {}, dur: .4, phase: 'hold' }, { pose: {}, dur: 1.0, phase: 'con' }, { pose: CR_UP, dur: .8, phase: 'hold' }, { pose: CR_UP, dur: 1.5, phase: 'ecc' } ] };
const BI = (s, tw) => { const o = s === 'l' ? 'r' : 'l'; return { ...CR_UP, trunk: -114, curve: -22, neck: -132, head: -135, trunkTw: tw, ['thigh_' + s]: 160, ['shin_' + s]: 80, ['foot_' + s]: 140, ['thigh_' + o]: 118, ['shin_' + o]: 116, ['foot_' + o]: 170 }; };
MO.bicycle = { boxes: MAT, camTarget: [0, .35, 0], camDist: 3.0, view: 'three', base: { ...SUPF, thigh: 140, shin: 100, foot: 160, handT: [0.17, 0.2, -0.04], elbowPole: [1, 0.3, 0.2], grip: 30 },
  frames: [ { pose: BI('l', 40), dur: .35, phase: 'hold' }, { pose: BI('l', 40), dur: .9, phase: 'con' }, { pose: BI('r', -40), dur: .35, phase: 'hold' }, { pose: BI('r', -40), dur: .9, phase: 'con' } ] };
const RU = { anchor: 'hip', at: [0, 0.11, 0], trunk: -137, curve: 0, pelvisTilt: 10, neck: -150, head: -158, thigh: 140, shin: 40, foot: 63, thighAb: 8, shinAb: 0, footAb: 8, handT: [0.03, -0.44, 0.26], elbowPole: [1, -1, 0.2], grip: 70 };
MO.russian = { boxes: MAT, camTarget: [0, .45, 0], camDist: 3.0, view: 'front', base: RU,
  frames: [ { pose: { trunkTw: 55 }, dur: .3, phase: 'hold' }, { pose: { trunkTw: 55 }, dur: .9, phase: 'con' }, { pose: { trunkTw: -55 }, dur: .3, phase: 'hold' }, { pose: { trunkTw: -55 }, dur: .9, phase: 'con' } ] };
const SU_MID = { trunk: -125, curve: -20, pelvisTilt: 20, neck: -140, head: -145 }, SU_TOP = { trunk: -172, curve: -6, pelvisTilt: 34, neck: -178, head: -175 };
MO.situp = { boxes: MAT, camTarget: [0, .4, 0], camDist: 3.2, view: 'side', base: { ...SUPF, ...KB, handT: [0.1, -0.2, 0.12], elbowPole: [1, -0.3, 0.5], grip: 40 },
  frames: [ { pose: {}, dur: .4, phase: 'hold' }, { pose: {}, dur: .7, phase: 'con' }, { pose: SU_MID, dur: .7, phase: 'con' }, { pose: SU_TOP, dur: .5, phase: 'hold' }, { pose: SU_TOP, dur: .9, phase: 'ecc' }, { pose: SU_MID, dur: .9, phase: 'ecc' } ] };
const VU_TOP = { trunk: -140, curve: -6, pelvisTilt: 0, neck: -150, head: -150, thigh: 135, shin: 135, foot: 180, uarm: 128, farm: 128 };
MO.vup = { boxes: MAT, camTarget: [0, .4, 0], camDist: 3.4, view: 'side', base: { ...SUPF, pelvisTilt: 2, thigh: 90, shin: 90, foot: 140, uarm: -92, farm: -92, uarmAb: 8, farmAb: 4, grip: 20 },
  frames: [ { pose: {}, dur: .4, phase: 'hold' }, { pose: {}, dur: 1.0, phase: 'con' }, { pose: VU_TOP, dur: .4, phase: 'hold' }, { pose: VU_TOP, dur: 1.4, phase: 'ecc' } ] };
const KR_UP = { thigh: 108, shin: 20, foot: 80, pelvisTilt: 18, trunk: 176 };
MO.knee_raise = { props: ['pullbar'], camTarget: [0, 1.8, 0], camDist: 5.0, view: 'side', barY: 2.76,
  base: { ...PU_HANG, anchor: 'hands', at: [0, 2.76, 0], grip: 90, handLen: 0.06 },
  frames: [ { pose: {}, dur: .5, phase: 'hold' }, { pose: {}, dur: 1.0, phase: 'con' }, { pose: KR_UP, dur: .5, phase: 'hold' }, { pose: KR_UP, dur: 1.6, phase: 'ecc' } ] };

const BU_ST = { anchor: 'feet', at: [0, 0, 0], ...STAND, thighAb: 6, shinAb: 0, footAb: 8, neck: 184, head: 182, handW: [0.24, 0.86, 0.04], elbowPole: [0.6, -0.2, -1] };
const BU_SQ = { anchor: 'feet', at: [0, 0, 0], trunk: 128, thigh: 112, shin: -42, foot: 63, thighAb: 20, shinAb: -4, footAb: 12, neck: 150, head: 140, handW: [0.22, 0.03, 0.42], elbowPole: [0.3, -0.3, -1] };
const BU_SQH = { ...BU_SQ, anchor: 'hands', at: [0, 0.03, 0.42] };
const BU_PL = { ...BU_SQH, trunk: 116, thigh: -64, shin: -64, foot: 34, neck: 131, head: 121, thighAb: 4, shinAb: 0, footAb: 4, elbowPole: [0.75, 0.05, -1] };
const BU_JU = { ...BU_ST, at: [0, 0.22, 0], foot: 25, handW: [0.2, 2.45, 0.08], elbowPole: [1, 0, -0.3] };
MO.burpee = { camTarget: [0, .9, 0], camDist: 4.4, view: 'three', base: { grip: 10, wrist: 90, gripIK: 1 },
  frames: [ { pose: BU_ST, dur: .3, phase: 'hold' }, { pose: BU_ST, dur: .55, phase: 'ecc' }, { pose: BU_SQ, dur: .01, phase: 'ecc' }, { pose: BU_SQH, dur: .35, phase: 'ecc' },
    { pose: BU_PL, dur: .35, phase: 'hold' }, { pose: BU_PL, dur: .35, phase: 'con' }, { pose: BU_SQH, dur: .01, phase: 'con' }, { pose: BU_SQ, dur: .5, phase: 'con' },
    { pose: BU_ST, dur: .25, phase: 'con' }, { pose: BU_JU, dur: .3, phase: 'con' } ] };
// Optional preparation drills: unloaded, in-place demonstrations.
// Their quantities and suitability remain editable in the warm-up panel.
const WBASE = { ...STAND, foot: 62.85, footAb: 1.36, thighAb: 5, shinAb: 0, uarmAb: 8, farmAb: 5, grip: 10 };
const WF = (pose, dur = .65, phase = 'con') => ({ pose, dur, phase });
const warm = (frames, base = {}) => ({ view: 'side', camTarget: [0, .92, 0], camDist: 3.8, groundFeet: true, base: { ...WBASE, ...base }, frames });
const wm = (left, right, arms = 28) => ({
  thigh_l: left[0], shin_l: left[1], foot_l: left[2] ?? 63,
  thigh_r: right[0], shin_r: right[1], foot_r: right[2] ?? 63,
  uarm_l: -arms, farm_l: 65 - arms, uarm_r: arms, farm_r: 65 + arms,
});
MO.warmup_jog = warm([WF(wm([25,-55],[-12,-10]),.32), WF(wm([2,-5],[2,-5],0),.12), WF(wm([-12,-10],[25,-55],-28),.32), WF(wm([2,-5],[2,-5],0),.12)], { trunk: 176 });
MO.warmup_ankle = warm([WF({thigh_l:30,shin_l:-10,thigh_r:-15,shin_r:-15},1), WF({thigh_l:40,shin_l:-28,thigh_r:-12,shin_r:-10},1), WF({thigh_l:30,shin_l:-10,thigh_r:-15,shin_r:-15},.5), WF({thigh_r:30,shin_r:-10,thigh_l:-15,shin_l:-15},1), WF({thigh_r:40,shin_r:-28,thigh_l:-12,shin_l:-10},1), WF({thigh_r:30,shin_r:-10,thigh_l:-15,shin_l:-15},.5)]);
MO.warmup_leg_swing = warm([WF({thigh_l:40,shin_l:35},.8), WF({thigh_l:-28,shin_l:-25},.8), WF({},.4), WF({thigh_r:40,shin_r:35},.8), WF({thigh_r:-28,shin_r:-25},.8), WF({},.4)]);
MO.warmup_march = warm([WF(wm([82,0],[0,0]),.7), WF(wm([0,0],[0,0],0),.25), WF(wm([0,0],[82,0],-28),.7), WF(wm([0,0],[0,0],0),.25)]);
MO.warmup_skip = warm([WF({...wm([80,0],[0,-8]),hop:.06},.18), WF(wm([45,-5],[0,0]),.18), WF(wm([0,0],[0,0],0),.18), WF({...wm([0,-8],[80,0],-28),hop:.06},.18), WF(wm([0,0],[45,-5],-28),.18), WF(wm([0,0],[0,0],0),.18)]);
MO.warmup_butt_kick = warm([WF(wm([0,-120],[0,0]),.3), WF(wm([0,0],[0,0],0),.18), WF(wm([0,0],[0,-120],-28),.3), WF(wm([0,0],[0,0],0),.18)]);
MO.warmup_arm_swing = warm([WF({uarm_l:-30,farm_l:55,uarm_r:35,farm_r:115},.4), WF({uarm_l:35,farm_l:115,uarm_r:-30,farm_r:55},.4)]);
MO.warmup_squat = warm([WF({},.4,'hold'), WF({},1.4,'ecc'), WF({...SQ_BOT,thigh:85,shin:-35,thighAb:18,shinAb:-4},.4,'hold'), WF({...SQ_BOT,thigh:85,shin:-35,thighAb:18,shinAb:-4},1.1,'con')], {thighAb:10,uarm:25,farm:85});
MO.warmup_hinge = warm([WF({},.4,'hold'), WF({},1.5,'ecc'), WF({trunk:125,thigh:25,shin:0,neck:145,head:140,uarm:-5,farm:0},.4,'hold'), WF({trunk:125,thigh:25,shin:0,neck:145,head:140,uarm:-5,farm:0},1.2,'con')]);
MO.warmup_stride = warm([WF(wm([55,-20],[-22,-35],38),.23), WF(wm([0,-3],[0,-3],0),.12), WF(wm([-22,-35],[55,-20],-38),.23), WF(wm([0,-3],[0,-3],0),.12)], {trunk:173});
MO.warmup_arm_circle = warm([WF({uarm:0,farm:0,uarmAb:8,farmAb:6},.8), WF({uarm:90,farm:90,uarmAb:12,farmAb:10},.8), WF({uarm:176,farm:176,uarmAb:10,farmAb:8},.8), WF({uarm:-70,farm:-70,uarmAb:12,farmAb:10},.8)]);
MO.warmup_arm_circle.camTarget = [0, 1.1, 0]; MO.warmup_arm_circle.camDist = 4.8;
export default MO;
