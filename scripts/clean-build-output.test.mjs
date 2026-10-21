import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanBuildOutput } from './clean-build-output.mjs';

test('clean rebuild removes stale HTML and Nitro manifests but preserves source, dependencies, assets and data',()=>{
  const root=mkdtempSync(join(tmpdir(),'fk-build-output-'));
  try {
    for(const directory of ['.output/public','.nitro/vite','node_modules/.nitro/prerender','node_modules/kept','src','public','.data'])mkdirSync(join(root,directory),{recursive:true});
    for(const file of ['.output/public/index.html','.nitro/vite/manifest.js','node_modules/.nitro/prerender/index.mjs'])writeFileSync(join(root,file),'OLD_BUNDLE');
    const preserved=['src/app.ts','public/avatar.png','.data/training.json','node_modules/kept/index.js'];
    for(const file of preserved)writeFileSync(join(root,file),'PRESERVE');
    cleanBuildOutput(root);cleanBuildOutput(root);
    for(const directory of ['.output','.nitro','node_modules/.nitro'])assert.equal(existsSync(join(root,directory)),false);
    for(const file of preserved)assert.equal(readFileSync(join(root,file),'utf8'),'PRESERVE');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
