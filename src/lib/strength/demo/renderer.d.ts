import type {Animation,Pose,MuscleId} from './types';
export function solve(p: Pose): Record<string, [number, number]>;
export function poseAt(a: Animation, t: number): { pose: Pose; phase: Keyframe['phase']; idx: number };
export function fitBox(a: Animation, pad?: number): string;
export function drawFrame(svg: SVGSVGElement, a: Animation, t: number, opt?: { primary?: MuscleId[]; secondary?: MuscleId[]; static?: boolean; colors?: Record<string, string> }): { phase: string };
export function createPlayer(svg: SVGSVGElement, a: Animation, opt?: { primary?: MuscleId[]; secondary?: MuscleId[]; onPhase?: (p: string) => void }): { play(): void; pause(): void; toggle(): boolean; setSpeed(s: number): void; readonly playing: boolean; destroy(): void };
