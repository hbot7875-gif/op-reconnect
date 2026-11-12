// The sign-in / create-file card: layout changes must not touch what the
// forms send or which rules they apply.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const auth = read('./ui-auth.js')
const css = read('../css/reconnect.css')

test('header is the heading and one subtitle; the numbered step boxes are gone', () => {
  assert.match(auth, /'The network needs agents\.'/)
  assert.match(auth, /el\('p', 'muted auth-lede'/)
  assert.doesNotMatch(auth, /authSteps|auth-step/)
  assert.doesNotMatch(css, /\.auth-step\b/)
})

test('Instagram and X sit in one group with the at-least-one rule said once', () => {
  assert.match(auth, /const social = el\('div', 'auth-group'\)/)
  assert.match(auth, /social\.append\(handleField, xField,/)
  assert.equal((auth.match(/Add at least one: Instagram, X, or both/g) || []).length, 1)
  assert.match(auth, /pickAccountHandle\(\{ handle: handle\.value, xHandle: xHandle\.value \}\)/)
})

test('what the forms send is unchanged', () => {
  assert.match(auth, /call\('registerAgent', \{\s*handle: picked\.handleSource === 'instagram' \? picked\.handle : '',\s*email: email\.value\.trim\(\),\s*password: pw\.value,\s*lbUsername: null,\s*xHandle: picked\.xHandle,\s*\}\)/)
  assert.match(auth, /call\('loginAgent', \{ agentNo, password: pw\.value \}\)/)
  assert.match(auth, /call\('requestPasswordReset', \{ email: addr \}\)/)
  assert.match(auth, /call\('resetPassword', \{ code: code\.value\.trim\(\), newPassword: pw\.value \}\)/)
})

test('password toggle uses line icons and keeps its accessible state', () => {
  assert.doesNotMatch(auth, /👁|🙈/)
  assert.match(auth, /el\('button', 'pw-toggle', EYE\)/)
  assert.match(auth, /toggle\.setAttribute\('aria-pressed', String\(!showing\)\)/)
})

test('card, segmented tabs and inputs are styled on the auth screen only', () => {
  assert.match(css, /\.auth-wrap \{[^}]*background: var\(--surface\)/)
  assert.match(css, /\.auth-tabs \{[^}]*grid-template-columns: 1fr 1fr/)
  assert.match(css, /\.auth-wrap \.ob-input \{/)
  assert.match(css, /\.auth-wrap \.ob-input:focus \{/)
  assert.match(css, /@media \(max-width: 520px\) \{\s*#auth:not\(\[hidden\]\)/)
})
