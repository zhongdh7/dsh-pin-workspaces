# dsh-pin-workspaces

把工作区置顶到侧栏最前。DSH 原生只有「会话置顶」（会话行 hover 的图钉，置顶后在所属工作区分组内排最前），没有工作区级别的置顶；这个插件补的就是后者。

## 用法

1. 侧栏某个工作区标题上右键，菜单里多出 **置顶工作区**（已置顶时是 **取消置顶工作区**）。
2. 置顶的工作区按置顶先后排在列表最前，最近置顶的在最上面。
3. 置顶的工作区在侧栏里用强调色显示（标题与文件夹图标），和普通工作区一眼分得开。
4. 取消置顶后，该工作区落到置顶区之下的第一位。
5. DSH 新建工作区（比如新建会话时自动登记一个新目录）时，它会被 DSH 插到列表最前；插件会自动把置顶项压回前排，新工作区落在置顶区之后。
6. 顺序持久化，DSH 重启后自动恢复。
7. **设置 → 工作区置顶** 里能看到当前置顶清单，也可以逐条取消置顶。

## 状态与接口

- 状态文件：`%USERPROFILE%\.dsh\dsh-pin-workspaces\state.json`（`$DSH_HOME` 存在时以它为准），结构为 `{ "version": 1, "pinnedWorkspaceIds": [...] }`，最近置顶的在前。删掉这个文件即清空全部置顶。
- 本地路由（同源，浏览器半侧用）：`GET /dsh-pin-workspaces/state`、`POST /dsh-pin-workspaces/pin`、`POST /dsh-pin-workspaces/unpin`，请求体 `{ "workspaceId": "..." }`。`/state` 同时返回 `workspaces`（`{ id, title }` 列表），设置页用它显示工作区名字。
- 顺序写入走宿主 `workspaceRegistry.insertBefore`，与拖拽排序是同一份持久顺序。
- 顺序看护：工作区注册表没有「持久顺序变了」的事件，插件每 0.6 秒对账一次（`DSH_PIN_WORKSPACES_WATCH_MS` 可改间隔，最小 20 毫秒），发现置顶项被挤出前排就重新压回去。DSH 新建工作区会把它插到最前，这一步就是靠看护纠正的。

## 配色怎么来的

置顶行的强调色由浏览器半侧注入一段样式表实现：选择器是 `[data-row-key="workspace:<工作区 id>"]`，颜色取主题 token `--dsw-alias-state-business-primary`（跟随浅色/深色主题）。`data-row-key` 是侧栏工作区行的现有标记，不是公开契约；DSH 大版本升级后若这个标记变了，配色会失效，需要跟着改选择器（不影响置顶本身）。

## 已知限制

- DSH 没有「工作区行级别」的装饰 slot，所以行上**没有图钉图标**，状态体现在右键菜单文案和强调色上。
- 置顶项的排位由看护强制维持：把置顶项拖出前排会在 0.6 秒内被挪回去；把普通工作区拖到置顶区之前同样会被挪回置顶区之后。
- 只处理工作区。会话置顶用 DSH 自带的会话行图钉，两者互不影响。
- 改完插件文件（或把插件禁用再启用）之后，**必须在 DSH 窗口按 Ctrl+R 重载页面**。宿主重载会让页面里的客户端模块图失效，页面不重载时这个插件会整个消失，连右键菜单都没了。

## 安装与卸载

```sh
dsh plugin --profile desktop add ./dsh-pin-workspaces
dsh plugin --profile desktop remove dsh-pin-workspaces
```

或在 DSH 应用内用 `plugin_manager` 的 `install_bundle` / `remove_bundle`。

## 许可证

MIT，见 [LICENSE](./LICENSE)。
