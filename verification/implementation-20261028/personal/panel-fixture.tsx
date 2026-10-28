import { createRoot } from "react-dom/client";
import { PersonalCoachPanel } from "../../../src/components/personal-coach-panel";
import { setEventContext } from "../../../src/lib/core/events";
import { personalStore, defaultPersonalProfile } from "../../../src/lib/coach/personal/host";
import { recordManualFood } from "../../../src/lib/nutrition/log";
import { localDay } from "../../../src/lib/health/observation";

setEventContext({ athleteId: "SYN-PANEL" });
const store = personalStore();
store.saveProfile({ ...defaultPersonalProfile("SYN-PANEL"), goal: "FAT_LOSS", age: 30, sex: "female", heightCm: 165, weightKg: 70, activity: "LOW", screen: "CLEAR" });
const proposal = store.prepare()!;
store.confirm(proposal.token, "CONFIRM_PERSONAL_PLAN");
Object.assign(window, { personalFixture: {
  addMeal: () => recordManualFood({ date: localDay(), meal: "午餐", name: "合成餐食", kcal: 300 }),
  active: () => personalStore().read().active,
  proposal: () => personalStore().read().proposal,
} });
createRoot(document.getElementById("root")!).render(<PersonalCoachPanel />);
