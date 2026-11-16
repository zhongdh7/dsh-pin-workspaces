import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planMoves, planOrder } from '../lib/pin-order.js'

/** 按 planMoves 的语义把真实顺序重放一遍。 */
function applyMoves(order, moves) {
  const next = [...order]
  for (const [id, beforeId] of moves) {
    next.splice(next.indexOf(id), 1)
    next.splice(next.indexOf(beforeId), 0, id)
  }
  return next
}

test('置顶项排在最前，其余保持原顺序', () => {
  assert.deepEqual(planOrder(['a', 'b', 'c'], ['c']), ['c', 'a', 'b'])
  assert.deepEqual(planOrder(['a', 'b', 'c'], ['c', 'b']), ['c', 'b', 'a'])
})

test('置顶列表里已不存在的工作区被忽略', () => {
  assert.deepEqual(planOrder(['a', 'b'], ['gone', 'b']), ['b', 'a'])
})

test('取消置顶后落到置顶区之后的第一个', () => {
  assert.deepEqual(planOrder(['b', 'c', 'a'], ['c'], 'a'), ['c', 'a', 'b'])
})

test('顺序已经正确时不产生移动', () => {
  assert.deepEqual(planMoves(['a', 'b', 'c'], ['a', 'b', 'c']), [])
})

test('移动序列能把当前顺序变成目标顺序', () => {
  const current = ['a', 'b', 'c', 'd']
  const desired = ['d', 'b', 'a', 'c']
  assert.deepEqual(applyMoves(current, planMoves(desired, current)), desired)
})

test('任意排列都能靠移动序列还原', () => {
  const base = ['w1', 'w2', 'w3', 'w4', 'w5']
  const cases = [
    ['w5', 'w4', 'w3', 'w2', 'w1'],
    ['w2', 'w1', 'w5', 'w4', 'w3'],
    ['w3', 'w1', 'w2', 'w5', 'w4'],
  ]
  for (const desired of cases) {
    assert.deepEqual(applyMoves(base, planMoves(desired, base)), desired)
  }
})
