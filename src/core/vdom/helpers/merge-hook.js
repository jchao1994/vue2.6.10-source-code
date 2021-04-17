/* @flow */

import VNode from '../vnode'
import { createFnInvoker } from './update-listeners'
import { remove, isDef, isUndef, isTrue } from 'shared/util'

export function mergeVNodeHook (def: Object, hookKey: string, hook: Function) {
  if (def instanceof VNode) {
    def = def.data.hook || (def.data.hook = {})
  }
  let invoker
  const oldHook = def[hookKey]

  // 执行 hook，执行完从 invoker.fns 中移除 wrappedHook
  function wrappedHook () {
    hook.apply(this, arguments)
    // important: remove merged hook to ensure it's called only once
    // and prevent memory leak
    remove(invoker.fns, wrappedHook)
  }

  if (isUndef(oldHook)) {
    // no existing hook
    // invoker.fns = [wrappedHook]，invoker也是一个函数，invoker()会执行 wrappedHook
    invoker = createFnInvoker([wrappedHook])
  } else {
    /* istanbul ignore if */
    if (isDef(oldHook.fns) && isTrue(oldHook.merged)) { // 老的已经合并过，直接在invoker.fns中添加wrappedHook
      // already a merged invoker
      invoker = oldHook
      invoker.fns.push(wrappedHook)
    } else { // 没有合并过，invoker.fns = [oldHook, wrappedHook]
      // existing plain hook
      // invoker.fns = [oldHook, wrappedHook]，invoker也是一个函数，invoker()会执行 oldHook 和 wrappedHook
      invoker = createFnInvoker([oldHook, wrappedHook])
    }
  }

  invoker.merged = true
  def[hookKey] = invoker
}
