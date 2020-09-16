/* @flow */

// 将每个slot的key和fn统一到scopedSlots中
// scopedSlots = {
//   key1: fn1,
//   key2: fn2,
//   ...
// }
export function resolveScopedSlots (
  fns: ScopedSlotsData, // see flow/vnode
  res?: Object,
  // the following are added in 2.6
  hasDynamicKeys?: boolean,
  contentHashKey?: number
): { [key: string]: Function, $stable: boolean } {
  res = res || { $stable: !hasDynamicKeys }
  for (let i = 0; i < fns.length; i++) {
    const slot = fns[i]
    if (Array.isArray(slot)) {
      resolveScopedSlots(slot, res, hasDynamicKeys)
    } else if (slot) {
      // slot = {
      //   key: 'xxx1',
      //   fn: function(props) {
      //     return ...
      //   },
      //   proxy: true // slot没有props，也就是el没有slotScope，就会有这个属性proxy
      // }

      // marker for reverse proxying v-slot without scope on this.$slots
      // 反向代理插槽
      // slot没有props，就会有proxy: true
      if (slot.proxy) {
        slot.fn.proxy = true
      }
      res[slot.key] = slot.fn
    }
  }
  if (contentHashKey) {
    (res: any).$key = contentHashKey
  }
  return res
}
