import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { activateBulkStore, bulkStatus, flushBulkStore, resetBulkStoreForTest, isBulkKey, BULK_DB, BULK_MARKER_KEY, enterBulkDegradedIfMigrated, bulkEntries } from './bulk-store'
import { currentStore, setStoreBackend } from './storage'
import { saveIntraday, loadIntraday } from '../health/intraday-store'
import { setEventContext } from './events'

/** 最小的 IndexedDB 替身：只实现大块层用到的部分（open / 对象存储 / 事务 / put get delete openCursor）。 */
function fakeIdb(opts: { failPut?: () => boolean; failOpen?: boolean; corruptReadback?: boolean; beforeMigration?: (kv:Map<string,unknown>)=>void } = {}) {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>()
  const later = (fn: () => void) => queueMicrotask(() => setTimeout(fn, 0))
  const make = (name: string) => {
    const stores = dbs.get(name)!
    const db: any = {
      objectStoreNames: { contains: (n: string) => stores.has(n) }, createObjectStore: (n: string) => { stores.set(n, new Map()) }, close() {},
      transaction(names: string | string[], mode: string) {
        const list = Array.isArray(names) ? names : [names]; if(list.includes('backup')&&mode==='readwrite')opts.beforeMigration?.(stores.get('kv')!); const tx: any = { error: null }
        let pending = 0; let aborted = false
        const done = () => { if (--pending === 0) later(() => { if (!aborted) tx.oncomplete?.() }) }
        const req = (fn: () => unknown) => { pending++; const r: any = {}; later(() => { try { r.result = fn(); r.onsuccess?.() } catch (e) { tx.error = e; aborted = true; tx.onabort?.() } ; done() }); return r }
        tx.abort = () => { aborted = true }
        tx.objectStore = (n: string) => { if (!list.includes(n)) throw new Error('not in tx'); const s = stores.get(n)!; return {
          put: (v: unknown, k: string) => req(() => { if (opts.failPut?.() && n === 'kv') throw new Error('QUOTA'); s.set(k, v); return k }),
          get: (k: string) => req(() => { const v = s.get(k); return opts.corruptReadback && n === 'kv' && typeof v === 'string' ? v + 'X' : v }),
          delete: (k: string) => req(() => { s.delete(k) }),
          openCursor: () => { const keys = [...s.keys()]; let i = 0; const r: any = {}; const step = () => { pending++; later(() => { r.result = i < keys.length ? { key: keys[i], value: s.get(keys[i]), continue: () => { i++; step() } } : null; r.onsuccess?.(); done() }) }; step(); return r },
        } }
        if (mode) later(() => { if (pending === 0) tx.oncomplete?.() })
        return tx
      },
    }
    return db
  }
  return {
    dbs, open(name: string) {
      const request: any = {}
      later(() => {
        if (opts.failOpen) { request.error = new Error('denied'); request.onerror?.(); return }
        const fresh = !dbs.has(name); if (fresh) dbs.set(name, new Map())
        request.result = make(name)
        if (fresh) request.onupgradeneeded?.()
        request.onsuccess?.()
      }); return request
    },
  }
}
function fakeLocalStorage(limit = Infinity) {
  const d = new Map<string, string>()
  const used = () => [...d].reduce((n, [k, v]) => n + k.length + v.length, 0)
  return { d, ls: {
    getItem: (k: string) => d.get(k) ?? null, removeItem: (k: string) => { d.delete(k) },
    setItem: (k: string, v: string) => { const p = d.get(k); if (used() - (p === undefined ? 0 : k.length + p.length) + k.length + v.length > limit) { const e = new Error('q'); e.name = 'QuotaExceededError'; throw e } d.set(k, v) },
    key: (i: number) => [...d.keys()][i] ?? null, get length() { return d.size },
  } }
}
const g = globalThis as any
let lsBox: ReturnType<typeof fakeLocalStorage>, idb: ReturnType<typeof fakeIdb>
const install = (opts: Parameters<typeof fakeIdb>[0] = {}, limit = Infinity) => { lsBox = fakeLocalStorage(limit); idb = fakeIdb(opts); g.localStorage = lsBox.ls; g.indexedDB = idb }
beforeEach(() => { setStoreBackend(null); setEventContext({ athleteId: 'local' }) })
afterEach(() => { resetBulkStoreForTest(); delete g.localStorage; delete g.indexedDB; setStoreBackend(null) })
const kvOf = () => idb.dbs.get(BULK_DB)!.get('kv')!
const backupOf = () => idb.dbs.get(BULK_DB)!.get('backup')!
const day = (d: string, n = 4): any => ({ schemaVersion: 1, day: d, fetchedAt: `${d}T23:59:00.000Z`, hr: Array.from({ length: n }, (_, i) => [i * 60, 60 + i]), bb: [[0, 50]], sourceId: 's1' })

test('isBulkKey 只认日内样本家族和已确认训练导入', () => {
  for (const k of ['fk-garmin-intraday-v1:local', 'fk-garmin-intraday-v1:local:source-archive', 'fr255-confirmed-training-imports-v1']) assert.ok(isBulkKey(k), k)
  for (const k of ['fk-coros-intraday-v1:local', 'fk-polar-intraday-v1:u1:source-archive', 'fk-coros-mcp-health-v1:synthetic-a', 'fk-coros-mcp-health-v1:synthetic-a:archive:s1', 'fk-suunto-confirmed-imports-v1']) assert.ok(isBulkKey(k), k)
  for (const k of ['fk-schedule-v1', 'fk-garmin-intraday-v10', 'fk-coros-mcp-linked-v1:a', 'fk-garmin-acts-v1:local', 'fr255-events-v1', 'fk-garmin-sync-report:local']) assert.equal(isBulkKey(k), false, k)
})

test('B05: both persistent stores failing must reject flush instead of reporting success', async () => {
  let fail = false
  install({ failPut: () => fail })
  await activateBulkStore()
  fail = true
  lsBox.ls.setItem = () => { throw new Error('LOCAL_QUOTA') }
  currentStore()!.setItem('fr255-confirmed-training-imports-v1', 'new data')
  await assert.rejects(flushBulkStore(), /PERSIST_FAILED/)
  assert.equal(bulkStatus().reason, 'PERSIST_FAILED')
  assert.equal(kvOf().has('fr255-confirmed-training-imports-v1'), false)
})

test('B07: a persisted deletion broadcast evicts the old bulk cache', async () => {
  const NativeChannel = globalThis.BroadcastChannel
  let receive: ((event: { data: { key: string } }) => void) | undefined
  g.BroadcastChannel = class { set onmessage(fn: typeof receive) { receive = fn }; postMessage() {}; close() {} }
  try {
    install()
    const key = 'fr255-confirmed-training-imports-v1'
    lsBox.d.set(key, 'old')
    await activateBulkStore()
    kvOf().delete(key)
    receive?.({ data: { key } })
    const deadline = Date.now() + 300
    while (currentStore()!.getItem(key) !== null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(currentStore()!.getItem(key), null)
    assert.equal(Object.hasOwn(bulkEntries(), key), false)
  } finally { resetBulkStoreForTest(); g.BroadcastChannel = NativeChannel }
})

test('B07: queued local write cannot be replaced by a broadcast of the older disk value', async () => {
 const NativeChannel=globalThis.BroadcastChannel
 let receive:((event:{data:{key:string}})=>void)|undefined
 g.BroadcastChannel=class {set onmessage(fn:typeof receive){receive=fn};postMessage(){};close(){}}
 try{
  install();const key='fr255-confirmed-training-imports-v1';lsBox.d.set(key,'old');await activateBulkStore()
  for(let i=0;i<15;i++)currentStore()!.setItem('fk-garmin-intraday-v1:local','blocking-'+i)
  currentStore()!.setItem(key,'new')
  receive?.({data:{key}})
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal(currentStore()!.getItem(key),'new')
  await flushBulkStore();assert.equal(kvOf().get(key),'new')
 }finally{await flushBulkStore();resetBulkStoreForTest();g.BroadcastChannel=NativeChannel}
})
test('B07: flush includes writes appended while the prior persistent transaction is pending',async()=>{
 install();await activateBulkStore()
 const key='fr255-confirmed-training-imports-v1'
 currentStore()!.setItem(key,'first');const flushed=flushBulkStore()
 queueMicrotask(()=>currentStore()!.setItem(key,'second'))
 await flushed
 assert.equal(kvOf().get(key),'second')
})

test('迁移成功：先备份原值，读回一致才删旧键，之后读写走大块层，localStorage 不再占空间', async () => {
  install()
  const intra = JSON.stringify({ schemaVersion: 1, days: { '2026-10-26': day('2026-10-26', 50) } })
  const imports = JSON.stringify({ schemaVersion: 1, revision: 3, updatedAt: 'x', data: [{ id: 1 }] })
  lsBox.d.set('fk-garmin-intraday-v1:local', intra); lsBox.d.set('fr255-confirmed-training-imports-v1', imports); lsBox.d.set('fk-schedule-v1', '{"entries":[],"acks":[]}')
  const st = await activateBulkStore()
  assert.equal(st.state, 'READY'); assert.deepEqual(st.migrated.sort(), ['fk-garmin-intraday-v1:local', 'fr255-confirmed-training-imports-v1'])
  assert.equal(lsBox.d.has('fk-garmin-intraday-v1:local'), false); assert.equal(lsBox.d.has('fr255-confirmed-training-imports-v1'), false)
  assert.equal(lsBox.d.get('fk-schedule-v1'), '{"entries":[],"acks":[]}', '其他键不动')
  assert.ok(lsBox.d.has(BULK_MARKER_KEY))
  assert.equal(kvOf().get('fk-garmin-intraday-v1:local'), intra)
  const backups = [...backupOf().values()] as any[]; assert.equal(backups.length, 2); assert.ok(backups.some(b => b.value === intra && b.source === 'localStorage'))
  const box = currentStore()!
  assert.equal(box.getItem('fk-garmin-intraday-v1:local'), intra); assert.ok(box.keys!().includes('fr255-confirmed-training-imports-v1'))
  assert.equal(lsBox.d.has('fk-garmin-intraday-v1:local'), false)
})

test('迁移失败（IndexedDB 写不进）：旧键原样保留并继续在 localStorage 里工作', async () => {
  install({ failPut: () => true })
  const intra = JSON.stringify({ schemaVersion: 1, days: { '2026-10-26': day('2026-10-26') } })
  lsBox.d.set('fk-garmin-intraday-v1:local', intra)
  const st = await activateBulkStore()
  assert.deepEqual(st.migrated, []); assert.deepEqual(st.pinned, ['fk-garmin-intraday-v1:local']); assert.equal(lsBox.d.get('fk-garmin-intraday-v1:local'), intra)
  assert.equal(Object.keys(loadIntraday()).length, 1, '照常读到')
  assert.equal(saveIntraday([day('2026-10-27')]), 1); assert.ok(lsBox.d.get('fk-garmin-intraday-v1:local')!.includes('2026-10-27'), '写入仍落在 localStorage')
})

test('迁移读回不一致：不删旧键', async () => {
  install({ corruptReadback: true })
  lsBox.d.set('fr255-confirmed-training-imports-v1', '{"data":[]}')
  const st = await activateBulkStore(); assert.deepEqual(st.pinned, ['fr255-confirmed-training-imports-v1']); assert.equal(lsBox.d.get('fr255-confirmed-training-imports-v1'), '{"data":[]}')
})

test('IndexedDB 不可用且没迁移过：保持原样（OFF），读写 localStorage', async () => {
  install({ failOpen: true }); lsBox.d.set('fk-garmin-intraday-v1:local', '{"schemaVersion":1,"days":{}}')
  const st = await activateBulkStore(); assert.equal(st.state, 'OFF'); assert.equal(lsBox.d.has('fk-garmin-intraday-v1:local'), true)
  assert.equal(saveIntraday([day('2026-10-27')]), 1)
})

test('已迁移过但这次 IndexedDB 打不开：降级——读为空、写入被拒绝，绝不覆盖', async () => {
  install({ failOpen: true }); lsBox.d.set(BULK_MARKER_KEY, '{"v":1}')
  const st = await activateBulkStore(); assert.equal(st.state, 'DEGRADED')
  assert.equal(currentStore()!.getItem('fk-garmin-intraday-v1:local'), null)
  assert.equal(saveIntraday([day('2026-10-27')]), 0); assert.equal(lsBox.d.has('fk-garmin-intraday-v1:local'), false)
  assert.throws(() => currentStore()!.setItem('fr255-confirmed-training-imports-v1', '[]'))
  currentStore()!.setItem('fk-other', 'ok'); assert.equal(lsBox.d.get('fk-other'), 'ok', '其他键不受影响')
})

test('超时保护：已迁移用户进入降级，未迁移用户不变', async () => {
  install(); enterBulkDegradedIfMigrated(); assert.equal(bulkStatus().state, 'OFF')
  lsBox.d.set(BULK_MARKER_KEY, '{"v":1}'); enterBulkDegradedIfMigrated(); assert.equal(bulkStatus().state, 'DEGRADED')
})

test('第二次启动：从 IndexedDB 加载；日内样本读写正常并落盘', async () => {
  install(); lsBox.d.set('fk-garmin-intraday-v1:local', JSON.stringify({ schemaVersion: 1, days: { '2026-10-25': day('2026-10-25') } }))
  await activateBulkStore(); resetBulkStoreForTest()
  await activateBulkStore()
  assert.deepEqual(Object.keys(loadIntraday()), ['2026-10-25'])
  assert.equal(saveIntraday([day('2026-10-26', 30)]), 1); await flushBulkStore()
  assert.deepEqual(Object.keys(JSON.parse(kvOf().get('fk-garmin-intraday-v1:local') as string).days).sort(), ['2026-10-25', '2026-10-26'])
  assert.equal([...lsBox.d.keys()].some(k => k.startsWith('fk-garmin-intraday')), false)
  assert.ok(bulkEntries()['fk-garmin-intraday-v1:local'])
})

test('localStorage 里又出现了同名键（降级期间写的）比 IndexedDB 新：以它为准，IndexedDB 旧值也先备份', async () => {
  install(); lsBox.d.set('fr255-confirmed-training-imports-v1', '{"v":"old"}'); await activateBulkStore(); resetBulkStoreForTest()
  lsBox.d.set('fr255-confirmed-training-imports-v1', '{"v":"newer"}')
  await activateBulkStore()
  assert.equal(currentStore()!.getItem('fr255-confirmed-training-imports-v1'), '{"v":"newer"}')
  assert.ok([...backupOf().values()].some((b: any) => b.source === 'indexedDB-replaced' && b.value === '{"v":"old"}'))
})

test('配额模拟：localStorage 已塞满时迁移腾出空间，日程保存成功（原版失败）', async () => {
  const { saveScheduledEntry, loadSchedule } = await import('../ui/day-schedule')
  install({}, 5_000_000)
  lsBox.d.set('fk-garmin-intraday-v1:local', 'a'.repeat(2_400_000))
  const entry: any = { id: 'custom:q1', date: '2026-10-27', title: '力量 · 5个动作', kind: 'strength', modality: 'strength', trainingType: 'strength', focus: [], minutes: 40, intensity: 'MODERATE', lowerHeavy: false, source: 'custom', refId: 'q1', status: 'planned' }
  const bigDoc = JSON.stringify({ entries: Array.from({ length: 4 }, (_, i) => ({ ...entry, id: `o${i}`, title: 'x'.repeat(40_000) })), acks: [] })
  lsBox.d.set('fk-schedule-v1', bigDoc)
  const used = () => [...lsBox.d].reduce((n, [k, v]) => n + k.length + v.length, 0)
  lsBox.d.set('fk-garmin-intraday-v1:local:source-archive', 'b'.repeat(4_999_700 - used() - 'fk-garmin-intraday-v1:local:source-archive'.length)) // 只剩 ~300 字符空间：原版保存必然 E-QUOTA
  const probe = lsBox.ls; assert.throws(() => probe.setItem('fk-schedule-v1', bigDoc + 'x'.repeat(1000)), /q/)
  const r = await saveScheduledEntry(entry)
  assert.deepEqual(r, { ok: true }, '失败时自动迁移大键后重试成功')
  assert.equal(bulkStatus().state, 'READY'); assert.equal(lsBox.d.has('fk-garmin-intraday-v1:local'), false)
  assert.ok(loadSchedule().entries.some(e => e.id === 'custom:q1'))
  assert.equal((kvOf().get('fk-garmin-intraday-v1:local') as string).length, 2_400_000, '大键完整在 IndexedDB')
})

test('通用于所有手表来源：Garmin / COROS / 其他型号的键同样迁移，且互相隔离、不混', async () => {
  install()
  const keys: Record<string, string> = {
    'fk-garmin-intraday-v1:local': '{"src":"garmin"}', 'fk-coros-intraday-v1:local': '{"src":"coros"}', 'fk-polar-intraday-v1:local': '{"src":"polar"}',
    'fk-coros-mcp-health-v1:a': '{"days":[],"c":1}', 'fk-coros-mcp-health-v1:a:archive:old': '{"days":[],"c":2}', 'fr255-confirmed-training-imports-v1': '{"data":[]}',
    'fk-coros-mcp-linked-v1:a': '1', 'fk-garmin-acts-v1:local': '{}',
  }
  for (const [k, v] of Object.entries(keys)) lsBox.d.set(k, v)
  const st = await activateBulkStore()
  assert.equal(st.migrated.length, 6)
  for (const k of ['fk-garmin-intraday-v1:local', 'fk-coros-intraday-v1:local', 'fk-polar-intraday-v1:local', 'fk-coros-mcp-health-v1:a', 'fk-coros-mcp-health-v1:a:archive:old']) {
    assert.equal(lsBox.d.has(k), false, k); assert.equal(kvOf().get(k), keys[k], k); assert.equal(currentStore()!.getItem(k), keys[k])
  }
  assert.equal(lsBox.d.get('fk-coros-mcp-linked-v1:a'), '1', '小键、直接读 localStorage 的键不动'); assert.ok(lsBox.d.has('fk-garmin-acts-v1:local'))
  currentStore()!.setItem('fk-coros-intraday-v1:local', '{"src":"coros","n":2}')
  assert.equal(currentStore()!.getItem('fk-garmin-intraday-v1:local'), '{"src":"garmin"}', '改 COROS 不影响 Garmin')
  assert.equal(currentStore()!.getItem('fk-polar-intraday-v1:local'), '{"src":"polar"}')
})

test('S1 融合：v89.11.13 写入的 IndexedDB 数据在合入 S1 在线教练/R6 后仍能读，原始训练记录逐字不变', async () => {
  install()
  const intra = JSON.stringify({ schemaVersion: 1, days: { '2026-10-26': day('2026-10-26', 40) } })
  const imports = JSON.stringify({ schemaVersion: 1, revision: 7, updatedAt: '2026-10-27T11:00:00.000Z', data: [{ id: 'a1', distance: 5000 }] })
  // “v89.11.13 的一次启动”：迁移、落盘；随后重启（resetBulkStoreForTest）模拟用融合版再次打开。
  lsBox.d.set('fk-garmin-intraday-v1:local', intra); lsBox.d.set('fr255-confirmed-training-imports-v1', imports)
  await activateBulkStore(); await flushBulkStore(); resetBulkStoreForTest()
  const kvBefore = JSON.stringify([...kvOf()]), backupBefore = JSON.stringify([...backupOf()])
  // 融合版新增的模块必须能被加载，且不改变大块层的家族/库名/标记键。
  const fused = await Promise.all([import('../coach/online-session'), import('../coach/online-service'), import('../coach/r6/runtime'), import('../coach/r5/guard')])
  assert.ok(fused.every(Boolean))
  assert.equal(BULK_DB, 'fangkun-bulk-store-v1'); assert.equal(BULK_MARKER_KEY, 'fk-bulk-store-v1')
  for (const k of ['fk-r6-ledger:local', 'fk-r6-changed', 'fk-knowledge-approvals-v1', 'fk-online-coach']) assert.equal(isBulkKey(k), false, k)
  await activateBulkStore()
  assert.equal(bulkStatus().state, 'READY')
  assert.deepEqual(Object.keys(loadIntraday()), ['2026-10-26'])
  assert.equal(currentStore()!.getItem('fr255-confirmed-training-imports-v1'), imports)
  // R6 的本地台账等小键走普通 localStorage，不会进入或污染大块层。
  currentStore()!.setItem('fk-r6-ledger:local', '[]'); await flushBulkStore()
  assert.equal(lsBox.d.get('fk-r6-ledger:local'), '[]'); assert.equal(kvOf().has('fk-r6-ledger:local'), false)
  assert.equal(JSON.stringify([...kvOf()]), kvBefore, '只读不改：IndexedDB 值逐字不变'); assert.equal(JSON.stringify([...backupOf()]), backupBefore, '备份不变')
})

test('migration backs up the actual value replaced inside its write transaction',async()=>{
 let concurrent=false;const key='fr255-confirmed-training-imports-v1'
 install({beforeMigration:kv=>{if(concurrent){kv.set(key,'concurrent-latest');concurrent=false}}})
 lsBox.d.set(key,'first');await activateBulkStore();resetBulkStoreForTest()
 lsBox.d.set(key,'new-local');concurrent=true;await activateBulkStore()
 assert.ok([...backupOf().values()].some((entry:any)=>entry.source==='indexedDB-replaced'&&entry.value==='concurrent-latest'))
 assert.equal(kvOf().get(key),'new-local')
})
