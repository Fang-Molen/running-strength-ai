import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { parseCsvPreview } from './device-csv-preview.ts'
test('CSV handles quoted commas, CRLF and BOM', () => {
 const p = parseCsvPreview('\uFEFFdate,notes\r\n2026-10-10,"400m, 60s"\r\n')
 assert.deepEqual(p.headers, ['date','notes']); assert.equal(p.rows[0][1], '400m, 60s')
})
test('CSV previews bounded rows without losing total', () => {
 const p = parseCsvPreview('a,b\n1,2\n3,4\n5,6', 2)
 assert.equal(p.totalRows, 3); assert.equal(p.rows.length, 2)
})
test('CSV rejects malformed quoting', () => assert.throws(() => parseCsvPreview('a,b\n1,"bad'), /引号/))
