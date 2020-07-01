/* @flow */

import { def } from 'core/util/lang'
import { normalizeChildren } from 'core/vdom/helpers/normalize-children'
import { emptyObject } from 'shared/util'

export function normalizeScopedSlots (
  slots: { [key: string]: Function } | void, // 作用域插槽
  normalSlots: { [key: string]: Array<VNode> }, // 普通插槽（具名和默认插槽）
  prevSlots?: { [key: string]: Function } | void
): any {
  let res
  const hasNormalSlots = Object.keys(normalSlots).length > 0
  const isStable = slots ? !!slots.$stable : !hasNormalSlots
  const key = slots && slots.$key
  // 先处理作用域插槽
  if (!slots) {
    res = {}
  } else if (slots._normalized) {
    // fast path 1: child component re-render only, parent did not change
    return slots._normalized
  } else if (
    isStable &&
    prevSlots &&
    prevSlots !== emptyObject &&
    key === prevSlots.$key &&
    !hasNormalSlots &&
    !prevSlots.$hasNormal
  ) {
    // fast path 2: stable scoped slots w/ no normal slots to proxy,
    // only need to normalize once
    return prevSlots
  } else {
    res = {}
    for (const key in slots) {
      if (slots[key] && key[0] !== '$') {
        res[key] = normalizeScopedSlot(normalSlots, key, slots[key]) // 将作用域插槽的函数slots[key]定义在vm.$scopedSlots（也就是res）上，在vm.$slots（也就是normalSlots）上也可以直接取slots[key]的执行结果
      }
    }
  }
  // expose normal slots on scopedSlots // 处理普通插槽
  for (const key in normalSlots) {
    if (!(key in res)) { // 原来的normalSlots中的key
      res[key] = proxyNormalSlot(normalSlots, key) // 将普通插槽封装成函数代理到vm.$scopedSlots上
    }
  }
  // avoriaz seems to mock a non-extensible $scopedSlots object
  // and when that is passed down this would cause an error
  if (slots && Object.isExtensible(slots)) {
    (slots: any)._normalized = res // _parentVnode.data.scopedSlots._normalized = res
  }
  def(res, '$stable', isStable) // res.$stable = isStable
  def(res, '$key', key) // res.$key = key
  def(res, '$hasNormal', hasNormalSlots) // res.$hasNormal = hasNormalSlots
  return res
}

function normalizeScopedSlot(normalSlots, key, fn) {
  const normalized = function () {
    let res = arguments.length ? fn.apply(null, arguments) : fn({})
    res = res && typeof res === 'object' && !Array.isArray(res)
      ? [res] // single vnode
      : normalizeChildren(res) // 把res数组扁平化处理成一维数组
    return res && (
      res.length === 0 ||
      (res.length === 1 && res[0].isComment) // #9658
    ) ? undefined
      : res
  }
  // this is a slot using the new v-slot syntax without scope. although it is
  // compiled as a scoped slot, render fn users would expect it to be present
  // on this.$slots because the usage is semantically a normal slot.
  if (fn.proxy) { // vm.$slots.xxx会调用normalized方法
    Object.defineProperty(normalSlots, key, {
      get: normalized,
      enumerable: true,
      configurable: true
    })
  }
  return normalized
}

function proxyNormalSlot(slots, key) {
  return () => slots[key]
}
