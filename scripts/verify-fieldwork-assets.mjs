import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const manifest=JSON.parse(readFileSync(new URL('../docs/fieldwork-v4/asset-manifest.json',import.meta.url),'utf8'))
const failed=[]
for(const file of manifest.files){
 if(!/^(?:src|public)\//.test(file.path)||file.path.split('/').includes('..')){failed.push({path:file.path,reason:'invalid path'});continue}
 try{const data=readFileSync(new URL('../'+file.path,import.meta.url));if(createHash('sha256').update(data).digest('hex')!==file.sha256||data.length!==file.bytes)failed.push({path:file.path,reason:'hash or byte count mismatch'})}catch{failed.push({path:file.path,reason:'missing file'})}
}
console.log(JSON.stringify({status:failed.length?'FAIL':'PASS',checked:manifest.files.length,failed},null,2));if(failed.length)process.exitCode=1
