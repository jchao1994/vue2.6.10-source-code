/* @flow */

import { extend, warn, isObject } from 'core/util/index'

/**
 * Runtime helper for rendering <slot>
 */
export function renderSlot (
  name: string,
  fallback: ?Array<VNode>, // children
  props: ?Object,
  bindObject: ?Object
): ?Array<VNode> {
  const scopedSlotFn = this.$scopedSlots[name]
  let nodes
  if (scopedSlotFn) { // scoped slot // 作用域插槽
    props = props || {}
    if (bindObject) {
      if (process.env.NODE_ENV !== 'production' && !isObject(bindObject)) {
        warn(
          'slot v-bind without argument expects an Object',
          this
        )
      }
      props = extend(extend({}, bindObject), props)
    }
    nodes = scopedSlotFn(props) || fallback
  } else { // 普通插槽 具名插槽
    nodes = this.$slots[name] || fallback
  }

  const target = props && props.slot
  if (target) { // 如果props里有slot属性，给nodes外面包裹一个template
    return this.$createElement('template', { slot: target }, nodes)
  } else {
    return nodes
  }
}
