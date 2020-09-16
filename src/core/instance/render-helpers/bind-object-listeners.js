/* @flow */

import { warn, extend, isPlainObject } from 'core/util/index'

// 判断value 是否是对象，并且为数据 data.on 合并data和value 的on 事件
export function bindObjectListeners (data: any, value: any): VNodeData {
  if (value) {
    if (!isPlainObject(value)) {
      process.env.NODE_ENV !== 'production' && warn(
        'v-on without argument expects an Object value',
        this
      )
    } else {
      const on = data.on = data.on ? extend({}, data.on) : {} // data中的所有$on事件
      for (const key in value) {
        const existing = on[key] // data中的
        const ours = value[key] // value中的
        on[key] = existing ? [].concat(existing, ours) : ours // data中的有就进行合并(data中的放在前面)，没有就添加
      }
    }
  }
  return data
}
