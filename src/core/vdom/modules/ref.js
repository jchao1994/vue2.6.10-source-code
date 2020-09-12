/* @flow */

import { remove, isDef } from 'shared/util'

export default {
  create (_: any, vnode: VNodeWithData) {
    registerRef(vnode) // 创建
  },
  update (oldVnode: VNodeWithData, vnode: VNodeWithData) {
    if (oldVnode.data.ref !== vnode.data.ref) { // 新的老的不同，移除老的，添加新的
      registerRef(oldVnode, true)
      registerRef(vnode)
    }
  },
  destroy (vnode: VNodeWithData) {
    registerRef(vnode, true) // 移除
  }
}

export function registerRef (vnode: VNodeWithData, isRemoval: ?boolean) {
  const key = vnode.data.ref
  if (!isDef(key)) return

  const vm = vnode.context
  // 组件的ref对应组件实例
  // 普通dom标签的ref对应真实dom元素
  const ref = vnode.componentInstance || vnode.elm
  const refs = vm.$refs
  if (isRemoval) { // 移除ref
    if (Array.isArray(refs[key])) {
      remove(refs[key], ref)
    } else if (refs[key] === ref) {
      refs[key] = undefined
    }
  } else { // 添加ref
    if (vnode.data.refInFor) { // refs[key]以数组形式存放
      if (!Array.isArray(refs[key])) {
        refs[key] = [ref]
      } else if (refs[key].indexOf(ref) < 0) { // refs中没有ref
        // $flow-disable-line
        refs[key].push(ref)
      }
    } else { // refs[key]以单个形式存放
      refs[key] = ref
    }
  }
}
