import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(process.env.FANGKUN_EVAL_OUTPUT_DIR || resolve(root, '../evidence/r11'))
mkdirSync(outputDir, { recursive: true })
const paths = Object.fromEntries(['results', 'summary', 'calls', 'network'].map(name => [name, resolve(outputDir, `promptfoo-${name}.${['calls','network'].includes(name) ? 'jsonl' : 'json'}`)]))
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
for (const path of Object.values(paths)) if (existsSync(path)) renameSync(path, path.replace(/(\.[^.]+)$/, `-prior-${stamp}$1`))
const environment = { ...process.env,
  PROMPTFOO_DISABLE_TELEMETRY: '1', PROMPTFOO_DISABLE_UPDATE: '1',
  PROMPTFOO_CONFIG_DIR: resolve(outputDir, 'promptfoo-runtime'),
  npm_config_cache: process.env.npm_config_cache || '/tmp/fangkun-npm-cache',
  npm_config_offline: 'true', npm_config_update_notifier: 'false',
  FANGKUN_EVAL_CALL_LOG: paths.calls, FANGKUN_EVAL_NETWORK_LOG: paths.network,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${resolve(root, 'evals/network-deny.cjs')}`].filter(Boolean).join(' '),
}
// The local provider needs no service keys; do not pass those to the CLI either.
for (const key of Object.keys(environment)) if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_KEY)$/.test(key)) delete environment[key]
const command = ['--no-install', 'promptfoo', 'eval', '--config', 'evals/promptfooconfig.yaml', '--output', paths.results, '--no-cache', '--no-table', '--no-progress-bar', '--no-write']
console.log('Running npx ' + command.join(' '))
const startedAt = new Date().toISOString()
const run = spawnSync('npx', command, { cwd: root, env: environment, stdio: 'inherit', timeout: 600_000 })
const readLines = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
let report = {}, parseError = null
try { report = JSON.parse(readFileSync(paths.results, 'utf8')) } catch (error) { parseError = String(error) }
const rows = Array.isArray(report.results?.results) ? report.results.results : Array.isArray(report.results) ? report.results : []
const calls = readLines(paths.calls), network = readLines(paths.network)
const suites = {}
for (const suite of ['dev', 'adversarial']) {
  const expected = (readFileSync(resolve(root, `evals/cases/${suite}.yaml`), 'utf8').match(/^- description:/gm) || []).length
  const suiteRows = rows.filter(row => (row.testCase?.vars || row.vars || {}).suite === suite)
  const passed = suiteRows.filter(row => row.success === true).length
  suites[suite] = { total: expected, passed, failed: suiteRows.length - passed,
    errors: suiteRows.filter(row => Boolean(row.error) && !row.gradingResult).length,
    skipped: Math.max(0, expected - suiteRows.length) }
}
const modelCalls = calls.reduce((sum, row) => sum + (Number.isInteger(row.modelCalls) ? row.modelCalls : Infinity), 0)
const expectedTotal = Object.values(suites).reduce((sum, suite) => sum + suite.total, 0)
const blockedLocalIpc = network.filter(row => row.category === 'LOCAL_IPC').length
const blockedTelemetryRequests = network.filter(row => row.category === 'DISABLED_TELEMETRY').length
const blockedModelRequests = network.filter(row => row.category === 'MODEL_NETWORK').length
const unknownBlockedRequests = network.filter(row => !['LOCAL_IPC', 'DISABLED_TELEMETRY'].includes(row.category)).length
const success = run.status === 0 && !parseError && Object.values(suites).every(suite => suite.total > 0 && suite.total === suite.passed && suite.failed === 0 && suite.errors === 0 && suite.skipped === 0)
  && calls.length === expectedTotal && new Set(calls.map(call => call.id)).size === expectedTotal && modelCalls === 0 && unknownBlockedRequests === 0 && blockedTelemetryRequests <= 1
const summary = { version: 1, success, startedAt, finishedAt: new Date().toISOString(), cliExitCode: run.status,
  suites, providerCalls: calls.length, modelCalls, externalRequests: 0, blockedModelRequests,
  blockedNetworkRequests: network.length - blockedLocalIpc, blockedTelemetryRequests, blockedLocalIpc, unknownBlockedRequests,
  rubric: 'Deterministic weighted criteria only; no model judge', externalAcceptanceRun: false,
  rawReport: paths.results, ...(parseError ? { parseError } : {}), ...(run.error ? { processError: String(run.error) } : {}) }
writeFileSync(paths.summary, JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
process.exitCode = success ? 0 : 1
