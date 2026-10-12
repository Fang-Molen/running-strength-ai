export type FangFace = "happy" | "thinking" | "focus" | "guard" | "encourage" | "celebrate" | "care" | "curious"

const LABEL: Record<FangFace, string> = {
  happy: "开心",
  thinking: "思考",
  focus: "专注",
  guard: "防护",
  encourage: "鼓励",
  celebrate: "庆祝",
  care: "关怀",
  curious: "疑问",
}

const SRC: Record<FangFace, string> = {
  happy: "/fangshen/happy-bust.png",
  thinking: "/fangshen/thinking-bust.png",
  focus: "/fangshen/focus-bust.png",
  guard: "/fangshen/guard-bust.png",
  encourage: "/fangshen/encourage-bust.png",
  celebrate: "/fangshen/celebrate-bust.png",
  care: "/fangshen/care-bust.png",
  curious: "/fangshen/curious-bust.png",
}

export function FangShen({ face, motion }: { face: FangFace; motion: boolean }) {
  const moving = motion && face === "thinking"
  return (
    <img
      src={SRC[face]}
      alt={`方坤，${LABEL[face]}`}
      data-fang-face={face}
      data-fang-motion={moving ? "on" : "off"}
      className={"h-16 w-16 shrink-0 object-contain object-top " + (moving ? "fang-bob" : "")}
    />
  )
}

export function fangFaceLabel(face: FangFace): string {
  return LABEL[face]
}
