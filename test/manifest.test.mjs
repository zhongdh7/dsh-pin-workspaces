import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// A UTF-8 BOM in package.json makes the DSH profile loader skip the whole bundle
// ("SyntaxError: Unexpected token '\uFEFF' ... is not valid JSON"), which removes the
// plugin from the app without any visible error. Guard against it here.
test('package.json is BOM-free valid JSON', () => {
  const bytes = readFileSync(new URL('../package.json', import.meta.url))
  assert.ok(bytes.length > 0)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF
  assert.equal(hasBom, false, 'package.json must not start with a UTF-8 BOM')
  const manifest = JSON.parse(bytes.toString('utf8'))
  assert.equal(manifest.name, 'dsh-pin-workspaces')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('cordis.patch.yml is BOM-free and declares the plugin row', () => {
  const bytes = readFileSync(new URL('../cordis.patch.yml', import.meta.url))
  const hasBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF
  assert.equal(hasBom, false, 'cordis.patch.yml must not start with a UTF-8 BOM')
  const text = bytes.toString('utf8')
  assert.match(text, /id: dsh-pin-workspaces/)
  assert.match(text, /name: 'dsh-pin-workspaces'/)
})
