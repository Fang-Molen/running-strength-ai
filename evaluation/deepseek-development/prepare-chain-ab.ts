/** Existing campaigns retain their immutable wire inputs. V3 is an explicit, separate protocol. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {prepareAB as prepareDynamicLegacy,type ABFixture} from './prepare-chain-ab.legacy-v2'
import {prepareAB as prepareV3,commonSource} from './prepare-chain-ab.v3'
import {modelFixtures} from './model-fixtures'
export type {ABFixture}
export {commonSource}
export function prepareAB(fixtures:ABFixture[],model:string,options:{routeAware?:boolean;caseIds?:readonly string[];inputTokenLimit?:number;outputTokenLimit?:number;protocolVersion?:'v3'|'legacy-v2'}={}){
 if(options.protocolVersion==='v3')return prepareV3(fixtures,model,options)
 const inputLimit=options.inputTokenLimit===undefined?8000:options.inputTokenLimit,outputLimit=options.outputTokenLimit===undefined?900:options.outputTokenLimit
 if(!Number.isSafeInteger(inputLimit)||inputLimit<1)throw Error('INVALID_AB_INPUT_TOKEN_LIMIT')
 if(!Number.isSafeInteger(outputLimit)||outputLimit<1)throw Error('INVALID_AB_OUTPUT_TOKEN_LIMIT')
 const archived=JSON.parse(readFileSync(new URL('./replay-fixtures/20261023/frozen-preparation-v2.json',import.meta.url),'utf8'))
 if(options.protocolVersion==='legacy-v2')return prepareV3(fixtures,model,options)
 // Regenerate arbitrary/changed inputs with the legacy preparer. Only byte-equal
 // public frozen fixtures can reuse captured bytes; this is not a result cache.
 const known=modelFixtures(),equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
 const result=prepareDynamicLegacy(fixtures,model,{...options,inputTokenLimit:Math.max(inputLimit,1000000),outputTokenLimit:outputLimit})
 const eligible=new Set(fixtures.filter(f=>known.some(k=>equal(k,f))).map(f=>f.caseId))
 const requests:any[]=[],blocked=[...result.blocked]
 for(let i=0;i<result.requests.length;i+=2){
  const id=result.requests[i].caseId,captured=archived.requests.filter((r:any)=>r.caseId===id)
  const pair=eligible.has(id)&&captured.length===2?structuredClone(captured):result.requests.slice(i,i+2)
  for(const r of pair){r.model=model;r.maxOutputTokens=outputLimit;r.generation.model=model;r.generation.max_tokens=outputLimit;r.providerRequest.model=model;r.providerRequest.max_tokens=outputLimit}
  if(pair.some((r:any)=>r.inputTokenUpperBound>inputLimit))blocked.push({caseId:id,reason:`PAIRED_CONTEXT_CAP_${inputLimit}_NO_TRIMMING`,inputUpperBounds:pair.map((r:any)=>r.inputTokenUpperBound)})
  else requests.push(...pair)
 }
 return {...result,requests,blocked,plannedCalls:requests.length}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href&&process.argv.includes('--prepare')){
 const value=(flag:string)=>{const index=process.argv.indexOf(flag);return index<0?undefined:process.argv[index+1]}
 const path=value('--prepare'),out=value('--output'),model=value('--model'),protocol=value('--protocol')
 if(!path||!out||!model)throw Error('Usage: --prepare fixtures.json --model selected-model --output output-directory [--protocol v3|legacy-v2]')
 if(protocol&&protocol!=='v3'&&protocol!=='legacy-v2')throw Error('INVALID_AB_PROTOCOL_VERSION')
 const result=prepareAB(JSON.parse(readFileSync(path,'utf8')),model,{protocolVersion:protocol as 'v3'|'legacy-v2'|undefined})
 mkdirSync(out,{recursive:true});writeFileSync(out+'/requests.json',JSON.stringify(result,null,2))
}
