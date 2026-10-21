import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanBuildOutput } from './clean-build-output.mjs';

test('clean rebuild removes stale generated HTML and preserves source, public assets and local data',()=>{
  const root=mkdtempSync(join(tmpdir(),'fk-build-output-'));
  try {
    for(const directory of ['.output/public','src','public','.data'])mkdirSync(join(root,directory),{recursive:true});
    writeFileSync(join(root,'.output/public/index.html'),'OLD_BUNDLE');
    for(const file of ['src/app.ts','public/avatar.png','.data/training.json'])writeFileSync(join(root,file),'PRESERVE');
    cleanBuildOutput(root);cleanBuildOutput(root);
    assert.equal(existsSync(join(root,'.output')),false);
    for(const file of ['src/app.ts','public/avatar.png','.data/training.json'])assert.equal(readFileSync(join(root,file),'utf8'),'PRESERVE');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
