import test from 'node:test'
import assert from 'node:assert/strict'
import { shareAssetNativeFirst } from './native-share.js'

const asset = {
  blob: new Blob(['png'], { type: 'image/png' }),
  filename: 'reconnect-test.png',
  title: 'ReConnect share',
  caption: 'ARMY, we did it 💜\nReConnect → https://hopetrackers.org',
  url: 'https://hopetrackers.org',
}

test('native file share contains PNG, caption and ReConnect URL', async () => {
  let received
  let fallback = 0
  const result = await shareAssetNativeFirst(asset, {
    FileCtor: File,
    canShare: ({ files }) => files[0].type === 'image/png',
    share: async (payload) => { received = payload },
  }, async () => { fallback++ })
  assert.equal(result, 'shared')
  assert.equal(received.files[0].name, 'reconnect-test.png')
  assert.equal(received.files[0].type, 'image/png')
  assert.equal(received.text, 'ARMY, we did it 💜\nReConnect → https://hopetrackers.org')
  assert.equal(received.url, 'https://hopetrackers.org')
  assert.equal(fallback, 0)
})

test('cancelling native share never runs download/copy fallback', async () => {
  let fallback = 0
  const error = new Error('cancelled'); error.name = 'AbortError'
  const result = await shareAssetNativeFirst(asset, {
    FileCtor: File, canShare: () => true, share: async () => { throw error },
  }, async () => { fallback++ })
  assert.equal(result, 'cancelled')
  assert.equal(fallback, 0)
})

test('missing file support runs fallback exactly once', async () => {
  let fallback = 0
  let native = 0
  const result = await shareAssetNativeFirst(asset, {
    FileCtor: File, canShare: () => false, share: async () => { native++ },
  }, async () => { fallback++ })
  assert.equal(result, 'fallback')
  assert.equal(native, 0)
  assert.equal(fallback, 1)
})

test('non-cancellation native failure runs fallback exactly once', async () => {
  let fallback = 0
  const result = await shareAssetNativeFirst(asset, {
    FileCtor: File, canShare: () => true, share: async () => { throw new Error('not supported') },
  }, async () => { fallback++ })
  assert.equal(result, 'fallback')
  assert.equal(fallback, 1)
})
