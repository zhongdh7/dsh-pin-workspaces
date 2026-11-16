import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../lib/index.js'

/** 假的工作区注册表：只实现插件用到的那三个方法。 */
function createRegistry(ids, titles = {}) {
  const order = [...ids]
  return {
    order,
    list: () => order.map(id => ({ id, title: titles[id] ?? '' })),
    get: id => (order.includes(id) ? { id } : undefined),
    insertBefore: async (id, beforeId) => {
      order.splice(order.indexOf(id), 1)
      if (beforeId === undefined) order.push(id)
      else order.splice(order.indexOf(beforeId), 0, id)
      return [...order]
    },
  }
}

/** 用一个真实 HTTP 服务器承载插件的路由处理器。 */
async function startHost({ registry, dshHome }) {
  process.env.DSH_HOME = dshHome
  let handler
  const ctx = {
    webServer: {
      register: route => {
        handler = route.handler
        return () => {}
      },
    },
    workspaceRegistry: registry,
    logger: { warn: () => {} },
    effect: (fn) => {
      fn()
      return () => {}
    },
  }
  apply(ctx)
  const server = createServer((req, res) => void handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return { origin, close: () => new Promise(resolve => server.close(resolve)) }
}

const json = async (response) => ({ status: response.status, body: await response.json() })

test('路由与顺序：pin 提到最前，unpin 落到置顶区之后', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pin-'))
  const registry = createRegistry(['ws-1', 'ws-2', 'ws-3'], { 'ws-1': '信号与系统' })
  const host = await startHost({ registry, dshHome })
  try {
    const initial = await json(await fetch(`${host.origin}/dsh-pin-workspaces/state`))
    assert.equal(initial.status, 200)
    assert.deepEqual(initial.body.pinnedWorkspaceIds, [])
    assert.deepEqual(initial.body.workspaces, [
      { id: 'ws-1', title: '信号与系统' },
      { id: 'ws-2', title: '' },
      { id: 'ws-3', title: '' },
    ])

    const pin1 = await json(await fetch(`${host.origin}/dsh-pin-workspaces/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-3' }),
    }))
    assert.equal(pin1.status, 200)
    assert.deepEqual(registry.order, ['ws-3', 'ws-1', 'ws-2'])

    const pin2 = await json(await fetch(`${host.origin}/dsh-pin-workspaces/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-2' }),
    }))
    assert.deepEqual(pin2.body.pinnedWorkspaceIds, ['ws-2', 'ws-3'])
    assert.deepEqual(registry.order, ['ws-2', 'ws-3', 'ws-1'])

    const unpin = await json(await fetch(`${host.origin}/dsh-pin-workspaces/unpin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-2' }),
    }))
    assert.equal(unpin.status, 200)
    assert.deepEqual(registry.order, ['ws-3', 'ws-2', 'ws-1'])

    const state = JSON.parse(await readFile(join(dshHome, 'dsh-pin-workspaces', 'state.json'), 'utf8'))
    assert.deepEqual(state.pinnedWorkspaceIds, ['ws-3'])
  } finally {
    await host.close()
  }
})

test('重启后按状态文件恢复顺序，并剔除已消失的工作区', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pin-'))
  const first = createRegistry(['ws-1', 'ws-2', 'ws-3'])
  const host = await startHost({ registry: first, dshHome })
  try {
    await fetch(`${host.origin}/dsh-pin-workspaces/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-3' }),
    })
  } finally {
    await host.close()
  }

  const registry = createRegistry(['ws-1', 'ws-2'])
  process.env.DSH_HOME = dshHome
  let handler
  apply({
    webServer: { register: route => { handler = route.handler; return () => {} } },
    workspaceRegistry: registry,
    logger: { warn: () => {} },
    effect: (fn) => {
      fn()
      return () => {}
    },
  })
  const deadline = Date.now() + 2000
  const stateFile = join(dshHome, 'dsh-pin-workspaces', 'state.json')
  let pinned = ['ws-3']
  while (pinned.length > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
    try {
      pinned = JSON.parse(await readFile(stateFile, 'utf8')).pinnedWorkspaceIds
    } catch {
      pinned = []
    }
  }
  assert.deepEqual(registry.order, ['ws-1', 'ws-2'])
  assert.deepEqual(pinned, [])
  assert.equal(typeof handler, 'function')
})
