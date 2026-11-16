import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 状态文件格式版本；将来改结构时据此做迁移。 */
export const STATE_VERSION = 1

/**
 * 置顶状态的落盘位置：`$DSH_HOME` 优先，否则 `~/.dsh`。
 * @param {Record<string, string | undefined>} [env] 环境变量表，测试时注入。
 * @returns {string} 绝对路径。
 */
export function resolveStateFile(env = process.env) {
  const home = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'dsh-pin-workspaces', 'state.json')
}

/**
 * 读取置顶列表。文件不存在视为空；内容损坏时交给调用方记日志后按空处理。
 * @param {string} file 状态文件绝对路径。
 * @param {(error: unknown) => void} [onError] 读取或解析失败的回报口。
 * @returns {Promise<string[]>} 置顶的工作区 id，最近置顶的在前。
 */
export async function readPinned(file, onError) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') onError?.(error)
    return []
  }
  try {
    const value = JSON.parse(raw)
    const list = Array.isArray(value?.pinnedWorkspaceIds) ? value.pinnedWorkspaceIds : []
    return list.filter(id => typeof id === 'string' && id !== '')
  } catch (error) {
    onError?.(error)
    return []
  }
}

/**
 * 覆盖写入置顶列表，必要时创建数据目录。
 * @param {string} file 状态文件绝对路径。
 * @param {readonly string[]} pinnedWorkspaceIds 置顶的工作区 id，最近置顶的在前。
 * @returns {Promise<void>}
 */
export async function writePinned(file, pinnedWorkspaceIds) {
  await mkdir(dirname(file), { recursive: true })
  const body = { version: STATE_VERSION, pinnedWorkspaceIds }
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}
