// dsh-pin-workspaces 的浏览器半侧：工作区右键菜单里的「置顶／取消置顶」、
// 置顶行的强调色、以及「设置 → 工作区置顶」页面。
// 客户端模块系统的 lazy-CJS factory 契约：执行本文件只登记 factory，副作用留给 apply。
window.__ModuleLoader__.load({
  id: 'dsh-pin-workspaces',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var ROUTE = '/dsh-pin-workspaces'
    var NS = 'dshPinWorkspaces'
    var STYLE_ID = 'dsh-pin-workspaces-pinned-rows'
    var ACCENT = 'var(--dsw-alias-state-business-primary)'
    var zh = {
      pin: '置顶工作区',
      unpin: '取消置顶工作区',
      pinned: '已置顶「{title}」',
      unpinned: '已取消置顶「{title}」',
      pinFailed: '置顶工作区失败',
      unpinFailed: '取消置顶工作区失败',
      nav: '工作区置顶',
      heading: '工作区置顶',
      intro: '置顶的工作区排在侧栏最前面，标题用强调色显示。',
      empty: '还没有置顶的工作区。',
      hint: '在侧栏右键工作区，选「置顶工作区」即可置顶。',
      count: '已置顶 {count} 个',
      unpinOne: '取消置顶',
      unpinOneFailed: '取消置顶失败，请重试',
    }
    var en = {
      pin: 'Pin workspace',
      unpin: 'Unpin workspace',
      pinned: 'Pinned "{title}"',
      unpinned: 'Unpinned "{title}"',
      pinFailed: 'Could not pin the workspace',
      unpinFailed: 'Could not unpin the workspace',
      nav: 'Pinned workspaces',
      heading: 'Pinned workspaces',
      intro: 'Pinned workspaces lead the sidebar and show their titles in the accent color.',
      empty: 'No workspace is pinned yet.',
      hint: 'Right-click a workspace in the sidebar and choose "Pin workspace".',
      count: '{count} pinned',
      unpinOne: 'Unpin',
      unpinOneFailed: 'Could not unpin this workspace',
    }

    // React 是平台共享模块；拿不到时只降级掉设置页，菜单与配色照常工作。
    var React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }

    // 当前置顶快照；settings 页面与行配色都订阅它。
    var snapshot = { pinnedWorkspaceIds: [], workspaces: [] }
    var subscribers = new Set()
    // 宿主路由给的工作区标题（新版宿主才有），以及从客户端 workspaces 服务兜底拿到的标题。
    var hostedTitles = new Map()
    var clientTitles = new Map()

    /**
     * 调宿主半侧的路由；同源 fetch 自带会话，无需额外凭据。
     * @param {string} path 路由后缀，如 '/state'。
     * @param {object} [payload] JSON 请求体，省略即 GET。
     * @returns {Promise<any>} 解析后的响应体。
     */
    async function call(path, payload) {
      var init = payload === undefined
        ? { method: 'GET' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
      init.credentials = 'same-origin'
      init.cache = 'no-store'
      var response = await fetch(ROUTE + path, init)
      if (!response.ok) throw new Error('dsh-pin-workspaces: HTTP ' + response.status)
      return response.json()
    }

    /**
     * 把一份路由响应收进快照，并把配色和订阅者一起刷新。
     * @param {any} data 宿主返回的 { pinnedWorkspaceIds, workspaces? }。
     */
    function absorb(data) {
      var ids = Array.isArray(data?.pinnedWorkspaceIds) ? data.pinnedWorkspaceIds : []
      var list = Array.isArray(data?.workspaces) ? data.workspaces : []
      snapshot = {
        pinnedWorkspaceIds: ids.filter(id => typeof id === 'string' && id !== ''),
        workspaces: list.filter(row => typeof row?.id === 'string').map(row => ({ id: row.id, title: typeof row.title === 'string' ? row.title : '' })),
      }
      hostedTitles = new Map(snapshot.workspaces.filter(row => row.title !== '').map(row => [row.id, row.title]))
      notify()
    }

    /** 置顶工作区的显示名：宿主标题优先，其次客户端 workspaces 服务，最后退回 id 前缀。 */
    function titleOf(id) {
      return hostedTitles.get(id) ?? clientTitles.get(id) ?? ''
    }

    /** 重画配色并通知订阅者。 */
    function notify() {
      paint()
      for (var listener of [...subscribers]) {
        try {
          listener(snapshot)
        } catch (error) {
          console.error('[dsh-pin-workspaces] 刷新订阅者失败', error)
        }
      }
    }

    /** 重新读一次宿主状态。 */
    async function refresh() {
      absorb(await call('/state'))
      return snapshot
    }

    /**
     * 订阅置顶快照。
     * @param {(snapshot: { pinnedWorkspaceIds: string[], workspaces: Array<{ id: string, title: string }> }) => void} listener 回调。
     * @returns {() => void} 退订函数。
     */
    function subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    }

    /**
     * 把 id 转进 CSS 属性选择器：只处理可能破坏引号/转义的两个字符。
     * @param {string} id 工作区 id。
     * @returns {string} 选择器里的属性值片段。
     */
    function selectorValue(id) {
      return String(id).replace(/["\\]/g, character => '\\' + character)
    }

    /** 生成置顶行的 CSS：标题与文件夹/箭头图标用强调色，其余保持原样。 */
    function cssText() {
      return snapshot.pinnedWorkspaceIds.map(id => {
        var selector = '[data-row-key="workspace:' + selectorValue(id) + '"]'
        return selector + ' { color: ' + ACCENT + '; }\n'
          + selector + ' > span:nth-child(-n + 2) { color: inherit; }'
      }).join('\n')
    }

    /** 保证 <style> 节点存在。 */
    function styleNode() {
      var node = document.getElementById(STYLE_ID)
      if (node === null) {
        node = document.createElement('style')
        node.id = STYLE_ID
        document.head.appendChild(node)
      }
      return node
    }

    /** 按当前快照重写配色样式表。 */
    function paint() {
      try {
        styleNode().textContent = cssText()
      } catch (error) {
        console.error('[dsh-pin-workspaces] 写入行配色失败', error)
      }
    }

    /**
     * 设置页里的一个置顶工作区行。
     * @param {{ id: string, title: string, onUnpin: (id: string) => Promise<void> }} props 行数据。
     */
    function PinnedRow(props) {
      var h = React.createElement
      return h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 12px',
          border: '1px solid var(--dsw-alias-border-l3)',
          borderRadius: '8px',
          background: 'var(--dsw-alias-button-elevated-fill)',
        },
      },
      h('span', {
        style: {
          flex: '1 1 auto',
          minWidth: '0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '13px',
          color: ACCENT,
        },
      }, props.title || props.id.slice(0, 8)),
      h('button', {
        type: 'button',
        onClick: () => { props.onUnpin(props.id).catch(() => {}) },
        style: {
          flex: 'none',
          padding: '3px 10px',
          fontSize: '12px',
          lineHeight: '18px',
          color: 'var(--dsw-alias-label-primary)',
          background: 'transparent',
          border: '1px solid var(--dsw-alias-border-l4)',
          borderRadius: '6px',
          cursor: 'pointer',
        },
      }, props.label))
    }

    /**
     * 「设置 → 工作区置顶」页面：置顶清单 + 逐条取消 + 用法提示。
     * @param {{ t: (key: string, params?: object) => string }} props 运行时道具（close 未用）。
     */
    function PinnedSection(props) {
      var t = props.t
      var h = React.createElement
      var state = React.useState(0)
      var bump = state[1]

      React.useEffect(() => {
        var rerender = () => { bump(function (value) { return value + 1 }) }
        var off = subscribe(rerender)
        refresh().catch(function (error) { console.error('[dsh-pin-workspaces] 读取置顶状态失败', error) })
        return off
      }, [])

      var onUnpin = async (id) => {
        try {
          absorb(await call('/unpin', { workspaceId: id }))
        } catch (error) {
          console.error('[dsh-pin-workspaces] 取消置顶失败', error)
          if (typeof document !== 'undefined') {
            // 用最轻的方式提示失败：不改动设置页布局。
            var node = document.createElement('div')
            node.textContent = t('unpinOneFailed')
            node.setAttribute('role', 'status')
            document.body.appendChild(node)
            setTimeout(() => { node.remove() }, 2400)
          }
        }
      }

      var rows = snapshot.pinnedWorkspaceIds.map(id => ({ id, title: titleOf(id) }))

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          h('h2', { style: { margin: '0', fontSize: '16px', lineHeight: '24px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' } }, t('heading')),
          h('p', { style: { margin: '0', fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' } }, t('intro'))),
        rows.length === 0
          ? h('p', { style: { margin: '0', fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' } }, t('empty'))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            h('div', { style: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } }, t('count', { count: rows.length })),
            rows.map(row => h(PinnedRow, { key: row.id, id: row.id, title: row.title, onUnpin, label: t('unpinOne') }))),
        h('p', { style: { margin: '0', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } }, t('hint')))
    }

    /**
     * @param {any} ctx 客户端上下文。
     */
    function apply(ctx) {
      var t = function (key) { return key }
      try {
        ctx.locale.register(NS, 'zh', zh)
        ctx.locale.register(NS, 'en', en)
        t = ctx.locale.bind(NS)
      } catch (error) {
        console.error('[dsh-pin-workspaces] 注册文案失败', error)
      }

      // 菜单最先注册：它是最核心的功能，后面的配色与设置页出错也不能影响它。
      try {
        ctx.effect(function () {
          return ctx.contextMenus.register({
            id: 'dsh-pin-workspaces.toggle',
            target: 'workspace',
            order: 250,
            resolve: async function (target) {
              var pinnedWorkspaceIds
              try {
                var response = await call('/state')
                pinnedWorkspaceIds = Array.isArray(response.pinnedWorkspaceIds) ? response.pinnedWorkspaceIds : []
              } catch (error) {
                console.error('[dsh-pin-workspaces] 读取置顶状态失败', error)
                return []
              }
              var pinned = pinnedWorkspaceIds.indexOf(target.workspaceId) !== -1
              return [{
                id: pinned ? 'unpin' : 'pin',
                label: t(pinned ? 'unpin' : 'pin'),
                failureLabel: t(pinned ? 'unpinFailed' : 'pinFailed'),
                run: async function () {
                  try {
                    absorb(await call(pinned ? '/unpin' : '/pin', { workspaceId: target.workspaceId }))
                    ctx.contextMenus.notify(t(pinned ? 'unpinned' : 'pinned', { title: target.displayTitle }), true)
                  } catch (error) {
                    console.error('[dsh-pin-workspaces] 切换置顶状态失败', error)
                    ctx.contextMenus.notify(t(pinned ? 'unpinFailed' : 'pinFailed'), false)
                    throw error
                  }
                },
              }]
            },
          })
        }, 'dsh-pin-workspaces: 工作区置顶菜单')
      } catch (error) {
        console.error('[dsh-pin-workspaces] 注册工作区菜单失败', error)
      }

      // 行配色：<style> 跟着快照走，插件卸载时一并移除。
      try {
        ctx.effect(function () {
          var off = subscribe(paint)
          refresh().catch(function (error) { console.error('[dsh-pin-workspaces] 读取置顶状态失败', error) })
          return function () {
            off()
            document.getElementById(STYLE_ID)?.remove()
          }
        }, 'dsh-pin-workspaces: 置顶行配色')
      } catch (error) {
        console.error('[dsh-pin-workspaces] 注册行配色失败', error)
      }

      // 工作区标题：宿主路由没给标题时（旧版宿主），从客户端 workspaces 服务兜底。
      try {
        ctx.effect(function () {
          var source = ctx.workspaces && ctx.workspaces.list
          if (source === undefined || typeof source.subscribe !== 'function') return
          var read = function () {
            try {
              var state = source.getSnapshot()
              var items = Array.isArray(state?.items) ? state.items : []
              clientTitles = new Map(items
                .filter(row => typeof row?.workspaceId === 'string' && typeof row.title === 'string' && row.title !== '')
                .map(row => [row.workspaceId, row.title]))
              notify()
            } catch (error) {
              console.error('[dsh-pin-workspaces] 读取工作区标题失败', error)
            }
          }
          read()
          return source.subscribe(read)
        }, 'dsh-pin-workspaces: 工作区标题')
      } catch (error) {
        console.error('[dsh-pin-workspaces] 订阅工作区标题失败', error)
      }

      // 设置页：插件在「设置」里可见，并且能就地取消置顶。
      if (React !== null && ctx.slots !== undefined) {
        try {
          ctx.slots.inject('settings.section', function () {
            return ctx.slots.register({
              name: 'settings.section',
              id: 'dsh-pin-workspaces',
              order: 400,
              label: function () { return t('nav') },
            }, function SettingsSection(ownerProps) {
              return PinnedSection({ t: t, close: ownerProps.close })
            })
          })
        } catch (error) {
          // 设置页挂不上不影响右键菜单与配色。
          console.error('[dsh-pin-workspaces] 注册设置页失败', error)
        }
      }

      // 自查入口：在浏览器控制台里 __dshPinWorkspaces.state() 能看到当前置顶集合与样式。
      if (typeof window !== 'undefined') {
        window.__dshPinWorkspaces = {
          state: function () { return snapshot },
          styleText: cssText,
          refresh: refresh,
        }
      }
    }

    return { name: 'dsh-pin-workspaces', inject: ['contextMenus', 'locale', 'slots'], apply: apply }
  },
})
