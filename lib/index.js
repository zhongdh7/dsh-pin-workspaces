import { planMoves, planOrder } from './pin-order.js'
import { readPinned, resolveStateFile, writePinned } from './state.js'

/** 插件名，必须与 package.json 的 name 和 patch 行 id 一致。 */
export const name = 'dsh-pin-workspaces'
/** 依赖的宿主服务：本地 HTTP 路由 + 工作区注册表。 */
export const inject = ['webServer', 'workspaceRegistry']

/** 与 lib/client.js 共用的路由前缀。 */
const ROUTE = '/dsh-pin-workspaces'
/** 请求体上限：只接收一个 workspaceId，超过即拒绝。 */
const MAX_BODY_BYTES = 64 * 1024
/**
 * 插件版本标记，随 `/state` 一起返回。
 * 用来确认「运行中的宿主到底加载了哪一版代码」——改了文件但没重载时它会出卖你。
 */
const PLUGIN_VERSION = '0.2.4'
/**
 * 顺序看护的轮询间隔（毫秒）。工作区注册表没有「持久顺序变了」这类事件，
 * 而 DSH 自己新建工作区时会把它插到最前，所以只能定时对账。
 */
const WATCH_INTERVAL_MS = 600

/**
 * 宿主半侧：维护置顶集合，把置顶工作区排到持久顺序最前，并通过本地路由暴露给浏览器半侧。
 * @param {import('@deepseek-ai/cordis').Context & {
 *   webServer: { register: (route: { kind: 'prefix', path: string, handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void> }) => () => void },
 *   workspaceRegistry: {
 *     list: () => ReadonlyArray<{ id: string, title?: string }>,
 *     get: (id: string) => unknown,
 *     insertBefore: (id: string, beforeId?: string) => Promise<readonly string[]>,
 *   },
 *   logger?: { warn?: (message: string) => void },
 * }} ctx 宿主上下文。
 */
export function apply(ctx) {
  const registry = ctx.workspaceRegistry
  const file = resolveStateFile()
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(`[dsh-pin-workspaces] ${message}`)
    } catch {
      // 日志服务不可用时不影响置顶本身。
    }
  }

  // 所有读写都串行化：并发点击「置顶」不会互相覆盖状态文件。
  let queue = Promise.resolve()
  const serial = (task) => {
    const run = queue.then(task, task)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  const read = () => readPinned(file, error => warn(`读取置顶状态失败：${error?.message ?? error}`))

  /**
   * 按当前置顶集合重排一次，并顺手剔除已不存在的工作区 id。
   * @param {string} [focusId] 刚取消置顶的工作区，落到置顶区之后。
   * @returns {Promise<string[]>} 仍然有效的置顶 id。
   */
  async function sync(focusId) {
    const pinned = await read()
    const current = registry.list().map(row => row.id)
    const desired = planOrder(current, pinned, focusId)
    for (const [id, beforeId] of planMoves(desired, current)) await registry.insertBefore(id, beforeId)
    const known = new Set(current)
    const kept = pinned.filter(id => known.has(id))
    if (kept.length !== pinned.length) await writePinned(file, kept)
    return kept
  }

  /** 当前工作区清单（id + 标题），给设置页显示置顶项名字用。 */
  const listWorkspaces = () => registry.list().map(row => ({
    id: row.id,
    title: typeof row.title === 'string' ? row.title : '',
  }))

  const state = () => serial(async () => ({
    version: PLUGIN_VERSION,
    watchIntervalMs: watchMs,
    pinnedWorkspaceIds: (await read()).filter(id => registry.get(id) !== undefined),
    workspaces: listWorkspaces(),
  }))

  const pin = (id) => serial(async () => {
    if (registry.get(id) === undefined) return { error: 'unknown-workspace' }
    const pinned = await read()
    await writePinned(file, [id, ...pinned.filter(item => item !== id)])
    return { pinnedWorkspaceIds: await sync(id), workspaces: listWorkspaces() }
  })

  const unpin = (id) => serial(async () => {
    const pinned = await read()
    if (!pinned.includes(id)) return { pinnedWorkspaceIds: pinned, workspaces: listWorkspaces() }
    await writePinned(file, pinned.filter(item => item !== id))
    return { pinnedWorkspaceIds: await sync(id), workspaces: listWorkspaces() }
  })

  /**
   * 路由处理器：GET /state、POST /pin、POST /unpin，其余 404。
   * @param {import('node:http').IncomingMessage} req 请求。
   * @param {import('node:http').ServerResponse} res 响应。
   */
  async function handle(req, res) {
    const url = new URL(req.url ?? ROUTE, 'http://localhost')
    const sub = url.pathname.slice(ROUTE.length).replace(/\/+$/, '')
    try {
      if (req.method === 'GET' && (sub === '' || sub === '/state')) {
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && sub === '/reconcile') {
        await sync()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && (sub === '/pin' || sub === '/unpin')) {
        const body = await readBody(req)
        const id = body?.workspaceId
        if (typeof id !== 'string' || id === '') return send(res, 400, { error: 'workspaceId-required' })
        const result = sub === '/pin' ? await pin(id) : await unpin(id)
        if (result.error !== undefined) return send(res, 404, { error: result.error })
        return send(res, 200, result)
      }
      return send(res, 404, { error: 'not-found' })
    } catch (error) {
      warn(`处理 ${req.method} ${url.pathname} 失败：${error?.message ?? error}`)
      return send(res, 500, { error: 'internal-error' })
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: handle }), 'dsh-pin-workspaces: 状态路由')

  /**
   * 顺序看护：DSH 新建工作区时会把它插到持久顺序最前，从而顶掉置顶区。
   * 这里定时对账，一旦发现置顶项不在最前就重新压回去，新工作区自然落到置顶区之后。
   * @param {number} intervalMs 轮询间隔。
   * @returns {() => void} 停止看护。
   */
  function watch(intervalMs) {
    const timer = setInterval(() => {
      void serial(async () => {
        try {
          await sync()
        } catch (error) {
          warn(`对账置顶顺序失败：${error?.message ?? error}`)
        }
      })
    }, intervalMs)
    // 定时器不应该拖住宿主进程退出。
    timer.unref?.()
    return () => clearInterval(timer)
  }

  const watchMs = (() => {
    const configured = Number(process.env.DSH_PIN_WORKSPACES_WATCH_MS)
    return Number.isFinite(configured) && configured >= 20 ? configured : WATCH_INTERVAL_MS
  })()

  ctx.effect(() => watch(watchMs), 'dsh-pin-workspaces: 置顶顺序看护')

  // 启动即恢复顺序：DSH 重启后置顶项应该已经在前。
  void serial(async () => {
    try {
      await sync()
    } catch (error) {
      warn(`启动时恢复置顶顺序失败：${error?.message ?? error}`)
    }
  })
}

/**
 * 写出 JSON 响应。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {number} status HTTP 状态码。
 * @param {unknown} payload 响应体。
 */
function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

/**
 * 读取并解析 JSON 请求体。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @returns {Promise<Record<string, unknown> | undefined>} 解析结果，空体返回 undefined。
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('body-too-large')
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
