/**
 * 置顶顺序的纯计算：不碰宿主服务，便于单测和复用。
 */

/**
 * 把置顶列表投影成目标顺序：置顶项按置顶先后排在最前，其余保持现有相对顺序。
 * @param {readonly string[]} currentIds 当前持久顺序。
 * @param {readonly string[]} pinnedIds 置顶列表，最近置顶的在前。
 * @param {string} [focusId] 刚取消置顶的工作区：落到置顶区之后的第一个。
 * @returns {string[]} 目标顺序。
 */
export function planOrder(currentIds, pinnedIds, focusId) {
  const known = new Set(currentIds)
  const pins = pinnedIds.filter(id => known.has(id))
  const pinned = new Set(pins)
  let rest = currentIds.filter(id => !pinned.has(id))
  if (focusId !== undefined && known.has(focusId) && !pinned.has(focusId)) {
    rest = [focusId, ...rest.filter(id => id !== focusId)]
  }
  return [...pins, ...rest]
}

/**
 * 把 current 变成 desired 所需的最少移动序列，元素是 `[id, beforeId]`。
 * 前缀已经正确的位置不再移动，因此恢复相同顺序时返回空数组。
 * @param {readonly string[]} desired 目标顺序。
 * @param {readonly string[]} current 当前顺序。
 * @returns {Array<[string, string]>} 依次交给 insertBefore 的移动。
 */
export function planMoves(desired, current) {
  const order = [...current]
  const moves = []
  for (let i = 0; i < desired.length; i += 1) {
    const target = desired[i]
    if (order[i] === target) continue
    const from = order.indexOf(target)
    if (from === -1) continue
    moves.push([target, order[i]])
    order.splice(from, 1)
    order.splice(i, 0, target)
  }
  return moves
}
