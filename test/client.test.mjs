import assert from 'node:assert/strict'
import { test } from 'node:test'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

test('浏览器半侧：登记 factory，注册菜单与设置页，能真实切换置顶并刷新配色', async () => {
  const loaded = []
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:55794' },
    __ModuleLoader__: { load: spec => loaded.push(spec) },
  }

  // 极简 DOM：只提供配色 <style> 用到的四个口子。
  const styleNodes = []
  globalThis.document = {
    getElementById: id => styleNodes.find(node => node.id === id) ?? null,
    createElement: () => ({
      id: '',
      textContent: '',
      remove() {
        const index = styleNodes.indexOf(this)
        if (index !== -1) styleNodes.splice(index, 1)
      },
    }),
    head: { appendChild: node => styleNodes.push(node) },
    body: { appendChild() {} },
  }

  // 极简 React：函数组件就地求值（设置页的行组件没有 hooks），元素留在树上供断言。
  const react = {
    createElement: (type, props, ...children) => (typeof type === 'function'
      ? type(props)
      : { type, props, children }),
    useState: value => [value, () => {}],
    useEffect: () => {},
  }

  // 用内存里的置顶集合扮演宿主路由；工作区标题由客户端 workspaces 服务兜底提供。
  const pinned = []
  const requests = []
  const clientWorkspaces = [{ workspaceId: 'ws-2', title: '信号与系统' }]
  globalThis.fetch = async (path, init) => {
    requests.push({ path, method: init.method })
    const body = init.body === undefined ? undefined : JSON.parse(init.body)
    if (body !== undefined) {
      const index = pinned.indexOf(body.workspaceId)
      if (path.endsWith('/pin') && index === -1) pinned.unshift(body.workspaceId)
      if (path.endsWith('/unpin') && index !== -1) pinned.splice(index, 1)
    }
    return { ok: true, json: async () => ({ pinnedWorkspaceIds: [...pinned] }) }
  }

  await import('../lib/client.js')
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'dsh-pin-workspaces')

  const mod = loaded[0].factory(moduleId => {
    assert.equal(moduleId, 'react')
    return react
  })
  assert.equal(mod.name, 'dsh-pin-workspaces')
  assert.deepEqual(mod.inject, ['contextMenus', 'locale', 'slots'])

  const dictionaries = []
  const contributions = []
  const notices = []
  const sections = []
  const slotInjections = []
  const disposers = []
  const ctx = {
    locale: {
      register: (ns, locale, dict) => dictionaries.push({ ns, locale, dict }),
      bind: ns => (key, params) => `${ns}.${key}${params === undefined ? '' : JSON.stringify(params)}`,
    },
    contextMenus: {
      register: contribution => {
        contributions.push(contribution)
        return () => disposers.push(contribution.id)
      },
      notify: (text, success) => notices.push({ text, success }),
    },
    slots: {
      inject: (name, factory) => {
        slotInjections.push(name)
        return factory()
      },
      register: (options, component) => {
        sections.push({ options, component })
        return () => disposers.push(options.id)
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({ items: clientWorkspaces }),
        subscribe: () => () => {},
      },
    },
    effect: fn => {
      fn()
      return () => {}
    },
  }
  mod.apply(ctx)
  await flush()

  assert.equal(dictionaries.length, 2)
  assert.equal(contributions.length, 1)
  assert.deepEqual(slotInjections, ['settings.section'])
  assert.equal(sections.length, 1)
  assert.equal(sections[0].options.id, 'dsh-pin-workspaces')
  assert.equal(typeof sections[0].options.label(), 'string')
  assert.equal(typeof sections[0].component, 'function')

  // 初始没有置顶：样式表存在但为空。
  assert.equal(styleNodes.length, 1)
  assert.equal(styleNodes[0].textContent, '')

  const menu = contributions[0]
  assert.equal(menu.id, 'dsh-pin-workspaces.toggle')
  assert.equal(menu.target, 'workspace')
  assert.equal(typeof menu.resolve, 'function')

  const target = { workspaceId: 'ws-2', displayTitle: '信号与系统' }
  const before = await menu.resolve(target)
  assert.deepEqual(before.map(action => action.id), ['pin'])

  await before[0].run()
  assert.deepEqual(pinned, ['ws-2'])
  assert.equal(notices.at(-1).success, true)
  assert.match(notices.at(-1).text, /dshPinWorkspaces\.pinned/)
  assert.match(styleNodes[0].textContent, /\[data-row-key="workspace:ws-2"\]/)
  assert.match(styleNodes[0].textContent, /--dsw-alias-state-business-primary/)

  // 设置页：渲染一次，能看到标题与置顶项，并点得动「取消置顶」。
  const tree = sections[0].component({ close() {} })
  const texts = []
  const buttons = []
  const walk = node => {
    if (node === undefined || node === null) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node !== 'object') { texts.push(String(node)); return }
    if (node.type === 'button') buttons.push(node)
    walk(node.children)
  }
  walk(tree)
  assert.equal(texts.some(text => text.includes('dshPinWorkspaces.heading')), true)
  assert.equal(texts.includes('信号与系统'), true)
  assert.equal(buttons.length, 1)
  await buttons[0].props.onClick()
  await flush()
  assert.deepEqual(pinned, [])
  assert.equal(styleNodes[0].textContent, '')

  // 取消之后再置顶一次，验证菜单在设置页操作后仍然自洽。
  const again = await menu.resolve(target)
  assert.deepEqual(again.map(action => action.id), ['pin'])
  await again[0].run()
  assert.deepEqual(pinned, ['ws-2'])

  const afterUnpin = await menu.resolve(target)
  assert.deepEqual(afterUnpin.map(action => action.id), ['unpin'])
  await afterUnpin[0].run()
  assert.deepEqual(pinned, [])
  assert.match(notices.at(-1).text, /dshPinWorkspaces\.unpinned/)
  assert.equal(styleNodes[0].textContent, '')

  assert.equal(requests.every(request => request.path.startsWith('/dsh-pin-workspaces')), true)
})
