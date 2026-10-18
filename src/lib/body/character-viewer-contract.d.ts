/** Dormant replacement boundary. No fetch, no storage write, no model bundled here.
 * Reuses media-v2 CharacterAsset; exercise playback stays in approved-motion/player.js.
 */
import type {CharacterAsset} from '../strength/media-v2/registry';
import type {Appearance} from './avatar-appearance';
export type CharacterCamera='front'|'side'|'back'|'three';
export interface CharacterViewerOptions {
 signal?:AbortSignal;
 onFailure:(reason:string)=>void;
 /** Visual preferences only; never translate measured kg/body fat into these values. */
 appearance?:Partial<Appearance>;
}
export interface CharacterViewerHandle {
 setView:(view:CharacterCamera)=>void;
 /** Report only morphs actually present and reviewed in this exact model. */
 supportedMorphs:ReadonlyArray<keyof Appearance>;
 setAppearance?:(preferences:Partial<Appearance>)=>void;
 destroy:()=>void;
}
/** Future renderer must verify GLB SHA256 and provenance before mounting. */
export type MountPersonalCharacter=(canvas:HTMLCanvasElement,asset:CharacterAsset,options:CharacterViewerOptions)=>Promise<CharacterViewerHandle>;
