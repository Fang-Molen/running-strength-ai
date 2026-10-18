export const CHARACTER_SELECTION = Object.freeze({
 personal: {male:'fk-tonight-male',female:'fk-tonight-female',status:'DESIGN_CONFIRMED_MODEL_PENDING'},
 strength: {male:['fk-tonight-male','fk-gym-boys-a2'],female:['fk-tonight-female','fk-gym-girls-a4'],status:'DESIGN_ALLOWED_ASSETS_PENDING'},
});
export function allowedMotionCharacter(gender:'male'|'female',id:unknown){return typeof id==='string'&&CHARACTER_SELECTION.strength[gender].includes(id);}
