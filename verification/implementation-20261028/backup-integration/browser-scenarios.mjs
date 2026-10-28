// Synthetic browser-only checks. All API requests are answered locally; external requests are blocked.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'

const evidence = new URL('./', import.meta.url)
const screenshot = '/workspace/screenshots/implementation-20261028-backup.png'
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const checks = [], errors = [], consoleErrors = [], blocked = []
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: true })
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { blocked.push(url.origin); return route.abort('blockedbyclient') }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'SYNTHETIC_QA_NO_SERVICE_ACCESS' }) })
  return route.continue()
})
await context.addInitScript(() => {
  if (!localStorage.getItem('fk-synthetic-seeded')) {
    localStorage.setItem('fk-onboard-skipped-v1', '1')
    localStorage.setItem('fk-synthetic-source', 'original-synthetic-value')
    localStorage.setItem('fk-synthetic-seeded', '1')
  }
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('dialog', dialog => dialog.accept())
const backupFile = (value = 'candidate-synthetic-value') => ({ name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'fangkun-vault-backup', schema: 1, data: { 'fk-synthetic-source': value } })) })
const openBackup = async () => {
  await page.getByRole('button', { name: '个人与数据', exact: true }).first().click()
  await page.getByTestId('menu-backup').click()
  await page.getByTestId('backup-center').waitFor()
}
const localValue = () => page.evaluate(() => localStorage.getItem('fk-synthetic-source'))
try {
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded' })
  await openBackup()
  const center = page.getByTestId('backup-center')
  await center.locator('input[type=file]').first().setInputFiles(backupFile())
  await page.getByTestId('restore-preview').waitFor()
  assert.equal(await localValue(), 'original-synthetic-value')
  await center.getByRole('button', { name: '确认保存待核副本', exact: true }).click()
  await center.getByRole('status').filter({ hasText: '尚未覆盖恢复' }).waitFor()
  const candidateId = await center.getByLabel('待核副本编号').inputValue()
  assert.ok(candidateId)
  const candidate = await page.evaluate(async id => JSON.parse(await (await import('/src/lib/core/restore-candidate.ts')).readRestoreCandidate(id)), candidateId)
  assert.equal(candidate.active, false)
  assert.equal(candidate.entries[0].sourceValue, 'original-synthetic-value')
  assert.equal(candidate.entries[0].target, 'candidate-synthetic-value')
  assert.equal(await localValue(), 'original-synthetic-value')
  checks.push('Settings file preflight + confirmed durable isolated candidate preserves active value')
  await mkdir('/workspace/screenshots', { recursive: true })
  await page.screenshot({ path: screenshot, fullPage: true })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await openBackup()
  assert.equal(await localValue(), 'original-synthetic-value')
  await center.getByLabel('待核副本编号').fill(candidateId)
  const candidateDownload = page.waitForEvent('download')
  await center.getByRole('button', { name: '下载待核副本', exact: true }).click()
  const download = await candidateDownload
  await download.saveAs(new URL('synthetic-candidate.json', evidence).pathname)
  assert.deepEqual(JSON.parse(await readFile(new URL('synthetic-candidate.json', evidence), 'utf8')), candidate)
  checks.push('Reload preserves original; candidate ID retrieves byte-equivalent durable candidate download')

  await center.locator('input[type=file]').first().setInputFiles(backupFile('stale-target'))
  await page.getByTestId('restore-preview').waitFor()
  const other = await context.newPage()
  await other.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded' })
  await other.evaluate(() => localStorage.setItem('fk-synthetic-source', 'other-tab-synthetic-value'))
  await center.getByRole('button', { name: '确认保存待核副本', exact: true }).click()
  await center.getByRole('status').filter({ hasText: '重新预检' }).waitFor()
  assert.equal(await localValue(), 'other-tab-synthetic-value')
  await other.close()
  checks.push('Another browser tab changing source invalidates preview without active overwrite')
  await center.getByRole('button', { name: '取消', exact: true }).click()

  const vaultChecks = await page.evaluate(async () => {
    const vault = await import('/src/lib/vault.ts')
    const bulk = await import('/src/lib/core/bulk-store.ts')
    await vault.flushVault()
    // Seed only an isolated synthetic orphan mirror; no active key exists.
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(vault.VAULT_DB, 2)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => { const db = req.result, tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put('obsolete-synthetic-mirror', 'fk-synthetic-orphan'); tx.oncomplete = () => { db.close(); resolve() }; tx.onabort = () => reject(tx.error) }
    })
    const key = 'fk-garmin-intraday-v1:synthetic-audit'
    bulk.appStorage().setItem(key, 'synthetic-durable-value')
    await bulk.flushBulkStore()
    localStorage.setItem(key, 'synthetic-local-pinned-value')
    const collected = await vault.collectVaultBackupEntries()
    return { orphan: collected['fk-synthetic-orphan'] ?? null, pinned: collected[key], physical: (await bulk.readBulkPersistentEntries())[key], local: localStorage.getItem('fk-synthetic-orphan') }
  })
  assert.deepEqual(vaultChecks, { orphan: null, pinned: 'synthetic-local-pinned-value', physical: 'synthetic-durable-value', local: null })
  checks.push('Export reads physical bulk persistence; local pinned value wins; orphan mirror excluded')
  const archiveDownload = page.waitForEvent('download')
  await center.getByRole('button', { name: '下载记录备份', exact: true }).click()
  const archiveFile = await archiveDownload
  await archiveFile.saveAs(new URL('synthetic-records.json', evidence).pathname)
  const archive = JSON.parse(await readFile(new URL('synthetic-records.json', evidence), 'utf8'))
  assert.equal(archive.format, 'fangkun-chunked-backup')
  assert.equal(archive.schema, 2)
  assert.ok(archive.metadata.excluded.some(value => value.includes('原图')))
  checks.push('Real export download uses chunked v2 with explicit partial scope')

  // Use real shared snapshot and legacy import entrypoints, with actual IndexedDB persistence.
  const entrypoints = await page.evaluate(async () => {
    const vault = await import('/src/lib/vault.ts')
    await vault.snapshotNow()
    const snapshots = await vault.listSnapshots()
    const snapshot = await vault.restoreSnapshot(snapshots.at(-1).at)
    const file = new File([JSON.stringify({ format: 'fangkun-vault-backup', schema: 1, data: { 'fk-synthetic-source': 'legacy-synthetic-target' } })], 'synthetic-legacy.json', { type: 'application/json' })
    const imported = await vault.importVault(file)
    return { snapshot: snapshot.state, imported: imported.state, value: localStorage.getItem('fk-synthetic-source') }
  })
  assert.deepEqual(entrypoints, { snapshot: 'CANDIDATE_READY', imported: 'CANDIDATE_READY', value: 'other-tab-synthetic-value' })
  checks.push('Real snapshot and shared legacy/welcome/Garmin file function create isolated candidates')

  const abort = await page.evaluate(async () => {
    const vault = await import('/src/lib/vault.ts')
    await vault.flushVault()
    const original = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = original.apply(this, args)
      if (this.name === vault.VAULT_DB && args[1] === 'readwrite') queueMicrotask(() => tx.abort())
      return tx
    }
    localStorage.setItem('fk-synthetic-abort', 'still-active')
    let rejected = false
    try { await vault.flushVault() } catch { rejected = true }
    const failed = vault.vaultStatus().failed
    IDBDatabase.prototype.transaction = original
    localStorage.setItem('fk-synthetic-abort', 'still-active')
    await vault.flushVault()
    return { rejected, failed, value: localStorage.getItem('fk-synthetic-abort'), recovered: vault.vaultStatus().failed }
  })
  assert.deepEqual(abort, { rejected: true, failed: 1, value: 'still-active', recovered: 0 })
  checks.push('Real IndexedDB mirror transaction abort rejects flush; source persists; explicit retry clears error')

  // Fresh origin storage, without booting the application: abort the initial mirror transaction.
  const initialContext = await browser.newContext({ serviceWorkers: 'block' })
  await initialContext.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient')
    if (url.pathname === '/__synthetic-vault-harness') return route.fulfill({ contentType: 'text/html', body: '<title>Synthetic storage fault check</title>' })
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, body: '{}' })
    return route.continue()
  })
  const initialPage = await initialContext.newPage()
  await initialPage.goto('http://127.0.0.1:8080/__synthetic-vault-harness')
  const initialAbort = await initialPage.evaluate(async () => {
    localStorage.setItem('fk-synthetic-initial', 'preserved-before-initial-mirror')
    const vault = await import('/src/lib/vault.ts'), original = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = original.apply(this, args)
      if (this.name === vault.VAULT_DB && args[1] === 'readwrite') queueMicrotask(() => tx.abort())
      return tx
    }
    let rejected = false
    try { await vault.initVault() } catch { rejected = true }
    IDBDatabase.prototype.transaction = original
    const failed = vault.vaultStatus().failed
    await vault.initVault()
    return { rejected, failed, recovered: vault.vaultStatus().failed, value: localStorage.getItem('fk-synthetic-initial') }
  })
  assert.deepEqual(initialAbort, { rejected: true, failed: 1, recovered: 0, value: 'preserved-before-initial-mirror' })
  await initialContext.close()
  checks.push('Initial mirror transaction abort rejects initialization; explicit reinitialization recovers without altering active source')
} catch (error) {
  errors.push(String(error.stack ?? error))
  await page.screenshot({ path: '/workspace/screenshots/implementation-20261028-backup-failure.png', fullPage: true }).catch(() => {})
  process.exitCode = 1
} finally {
  await writeFile(new URL('browser-result.json', evidence), JSON.stringify({ checks, errors, consoleErrors, blockedOrigins: [...new Set(blocked)], screenshot, scope: 'Synthetic context only; API fulfilled locally; no external requests, production data, or model calls.' }, null, 2))
  await browser.close()
}
