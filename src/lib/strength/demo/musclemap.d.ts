import type {MuscleId} from './types';
export const MUSCLES: Record<MuscleId, string>;
export function muscleMapSVG(view: 'front'|'back', primary?: MuscleId[], secondary?: MuscleId[], opt?: { selected?: MuscleId[]; colors?: Record<string, string> }): string;
