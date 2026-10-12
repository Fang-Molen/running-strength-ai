import type { PoseName } from "@/lib/strength/cues";

type Pt = [number, number];

type Pose = {
  head: Pt;
  hip: Pt;
  knee: Pt;
  foot: Pt;
  knee2: Pt;
  foot2: Pt;
  hand: Pt;
  hand2: Pt;
  elbow?: Pt;
  elbow2?: Pt;
  box?: [number, number, number, number];
  arrow?: [number, number, number, number];
  weight?: Pt;
};

const POSES: Record<PoseName, Pose> = {
  "knee-pushup": {head:[26,42],hip:[74,66],knee:[110,116],foot:[140,84],knee2:[116,116],foot2:[144,90],hand:[22,116],hand2:[34,116]},
  "knee-pushup-down": {head:[26,80],hip:[74,92],knee:[110,116],foot:[140,84],knee2:[116,116],foot2:[144,90],hand:[22,116],hand2:[34,116],elbow:[10,100],elbow2:[42,103]},
  "hammer-start": {head:[78,18],hip:[78,68],knee:[76,94],foot:[68,116],knee2:[90,94],foot2:[100,116],hand:[58,86],hand2:[100,86],weight:[100,88]},
  "hammer-end": {head:[78,18],hip:[78,68],knee:[76,94],foot:[68,116],knee2:[90,94],foot2:[100,116],hand:[58,38],hand2:[100,38],elbow:[60,68],elbow2:[96,68],weight:[102,36]},
  stand: { head: [78, 22], hip: [78, 70], knee: [80, 96], foot: [74, 116], knee2: [90, 96], foot2: [98, 116], hand: [66, 46], hand2: [92, 48], weight: [96, 48] },
  squat: { head: [74, 34], hip: [62, 74], knee: [88, 100], foot: [96, 116], knee2: [98, 102], foot2: [114, 116], hand: [66, 50], hand2: [82, 50], weight: [84, 46], arrow: [42, 46, 42, 96] },
  split: { head: [96, 20], hip: [94, 64], knee: [112, 90], foot: [124, 116], knee2: [62, 86], foot2: [40, 72], hand: [108, 40], hand2: [118, 44], box: [22, 72, 32, 44] },
  "split-down": { head: [98, 40], hip: [96, 84], knee: [116, 104], foot: [126, 116], knee2: [58, 102], foot2: [40, 72], hand: [110, 62], hand2: [120, 66], box: [22, 72, 32, 44], arrow: [132, 48, 132, 78] },
  step: { head: [62, 22], hip: [60, 66], knee: [86, 78], foot: [100, 84], knee2: [58, 94], foot2: [54, 116], hand: [74, 42], hand2: [84, 46], box: [86, 84, 48, 32] },
  "step-up": { head: [108, 16], hip: [106, 52], knee: [112, 72], foot: [118, 84], knee2: [96, 70], foot2: [92, 84], hand: [118, 32], hand2: [128, 36], box: [86, 84, 48, 32], arrow: [70, 70, 70, 40] },
  calf: { head: [78, 28], hip: [78, 72], knee: [78, 94], foot: [90, 108], knee2: [90, 94], foot2: [102, 108], hand: [64, 48], hand2: [58, 64], box: [72, 108, 44, 8] },
  "calf-up": { head: [78, 12], hip: [78, 56], knee: [78, 80], foot: [92, 92], knee2: [90, 80], foot2: [104, 92], hand: [64, 32], hand2: [58, 48], box: [72, 108, 44, 8], arrow: [48, 70, 48, 36] },
  deadbug: { head: [28, 78], hip: [72, 78], knee: [96, 52], foot: [118, 52], knee2: [96, 58], foot2: [118, 44], hand: [36, 48], hand2: [48, 40] },
  "deadbug-out": { head: [28, 78], hip: [72, 80], knee: [98, 52], foot: [120, 52], knee2: [108, 80], foot2: [138, 80], hand: [12, 56], hand2: [48, 42], arrow: [112, 92, 140, 92] },
  rdl: { head: [70, 20], hip: [72, 68], knee: [76, 94], foot: [70, 116], knee2: [88, 94], foot2: [98, 116], hand: [80, 58], hand2: [88, 66], weight: [90, 68] },
  "rdl-hinge": { head: [36, 36], hip: [86, 58], knee: [92, 86], foot: [86, 116], knee2: [118, 46], foot2: [142, 34], hand: [58, 64], hand2: [66, 74], weight: [62, 76], arrow: [48, 48, 28, 58] },
  swing: { head: [58, 36], hip: [78, 72], knee: [70, 96], foot: [62, 116], knee2: [90, 96], foot2: [104, 116], hand: [74, 100], hand2: [86, 108], weight: [80, 108] },
  "swing-out": { head: [86, 16], hip: [78, 62], knee: [80, 90], foot: [74, 116], knee2: [92, 90], foot2: [104, 116], hand: [108, 28], hand2: [122, 18], weight: [124, 16], arrow: [96, 70, 124, 28] },
  bridge: { head: [26, 96], hip: [70, 100], knee: [100, 78], foot: [118, 116], knee2: [104, 84], foot2: [126, 116], hand: [34, 110], hand2: [48, 112] },
  "bridge-up": { head: [22, 70], hip: [74, 62], knee: [108, 78], foot: [124, 116], knee2: [112, 84], foot2: [134, 116], hand: [30, 84], hand2: [44, 86], arrow: [74, 96, 74, 62] },
  "side-plank": { head: [24, 46], hip: [78, 58], knee: [112, 70], foot: [140, 80], knee2: [112, 76], foot2: [140, 88], hand: [24, 90], hand2: [40, 72] },
  carry: { head: [78, 18], hip: [78, 68], knee: [76, 94], foot: [68, 116], knee2: [90, 94], foot2: [100, 116], hand: [58, 86], hand2: [100, 86], weight: [58, 90] },
  row: { head: [34, 48], hip: [100, 62], knee: [116, 88], foot: [128, 116], knee2: [48, 96], foot2: [36, 116], hand: [22, 90], hand2: [70, 92], weight: [70, 96], box: [8, 86, 22, 30] },
  "row-pull": { head: [34, 46], hip: [100, 58], knee: [116, 86], foot: [128, 116], knee2: [48, 94], foot2: [36, 116], hand: [22, 88], hand2: [64, 52], weight: [64, 50], box: [8, 86, 22, 30], arrow: [78, 88, 78, 56] },
  pushup: { head: [22, 48], hip: [78, 56], knee: [112, 64], foot: [142, 70], knee2: [112, 70], foot2: [142, 78], hand: [16, 86], hand2: [30, 86] },
  "pushup-down": { head: [22, 70], hip: [78, 74], knee: [112, 72], foot: [142, 74], knee2: [112, 78], foot2: [142, 84], hand: [16, 96], hand2: [30, 96], arrow: [22, 40, 22, 64] },
  "side-leg": { head: [22, 78], hip: [70, 86], knee: [104, 92], foot: [138, 96], knee2: [100, 102], foot2: [130, 108], hand: [16, 98], hand2: [34, 100] },
  "side-leg-up": { head: [22, 78], hip: [70, 86], knee: [102, 52], foot: [136, 40], knee2: [100, 102], foot2: [130, 108], hand: [16, 98], hand2: [34, 100], arrow: [118, 78, 118, 46] },
  plank: { head: [20, 58], hip: [74, 62], knee: [112, 66], foot: [146, 70], knee2: [112, 72], foot2: [146, 78], hand: [18, 86], hand2: [34, 80] },
};

export function FormFigure({ pose, caption }: { pose: PoseName; caption: string }) {
  const p = POSES[pose];
  const shoulder: Pt = [p.head[0] + (p.hip[0] - p.head[0]) * 0.28, p.head[1] + 14];
  return (
    <figure className="rounded-card bg-surface-2 px-2 py-2">
      <svg viewBox="0 0 160 132" className="h-36 w-full text-fg" role="img" aria-label={caption}>
        <line x1="8" y1="118" x2="152" y2="118" className="stroke-line" strokeWidth="3" />
        {p.box ? <rect x={p.box[0]} y={p.box[1]} width={p.box[2]} height={p.box[3]} rx="4" className="fill-surface stroke-muted" strokeWidth="2" /> : null}
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d={`M ${p.hip[0]} ${p.hip[1]} L ${p.knee2[0]} ${p.knee2[1]} L ${p.foot2[0]} ${p.foot2[1]}`} strokeWidth="6" className="stroke-muted" />
          <path d={`M ${p.hand[0]} ${p.hand[1]} ${p.elbow ? `L ${p.elbow[0]} ${p.elbow[1]}` : ""} L ${shoulder[0]} ${shoulder[1]}`} strokeWidth="6" />
          <path d={`M ${p.head[0]} ${p.head[1] + 9} L ${p.hip[0]} ${p.hip[1]}`} strokeWidth="9" />
          <path d={`M ${p.hip[0]} ${p.hip[1]} L ${p.knee[0]} ${p.knee[1]} L ${p.foot[0]} ${p.foot[1]}`} strokeWidth="8" />
          <path d={`M ${shoulder[0]} ${shoulder[1]} ${p.elbow2 ? `L ${p.elbow2[0]} ${p.elbow2[1]}` : ""} L ${p.hand2[0]} ${p.hand2[1]}`} strokeWidth="6" />
        </g>
        <circle cx={p.head[0]} cy={p.head[1]} r="9" fill="currentColor" />
        {p.weight ? <rect x={p.weight[0] - 8} y={p.weight[1] - 5} width="16" height="10" rx="3" className="fill-accent" /> : null}
        {p.arrow ? (
          <g className="stroke-accent" fill="none" strokeWidth="3" strokeLinecap="round">
            <line x1={p.arrow[0]} y1={p.arrow[1]} x2={p.arrow[2]} y2={p.arrow[3]} />
            <circle cx={p.arrow[2]} cy={p.arrow[3]} r="3" className="fill-accent stroke-none" />
          </g>
        ) : null}
      </svg>
      <figcaption className="text-center text-xs font-bold text-muted">{caption}{p.arrow ? " · 箭头是用力方向" : ""}</figcaption>
    </figure>
  );
}
