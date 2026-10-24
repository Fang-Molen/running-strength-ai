import {readFile} from 'node:fs/promises';
import {retrieve} from './kb.mjs';
const cards=JSON.parse(await readFile(new URL('../knowledge/retrieval-cards.json',import.meta.url),'utf8'));
console.log(JSON.stringify(retrieve(cards,{task:'strength',population:'healthy_adult',question:'如何选择力量训练？',goal:'power',experience:'beginner',equipment:['dumbbell']}),null,2));
