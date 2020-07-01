/* @flow */

import type VNode from 'core/vdom/vnode'

/**
 * Runtime helper for resolving raw children VNodes into a slot object.
 */
/**
  <my-component>
    <div slot="header">node</div>
    <div>react</div>
    <div slot="footer">vue</div>
  </my-component>

  with(this) {
    return _c('my-component', [_c('div', {
        attrs: {
            "slot": "header"
        },
        slot: "header"
    }, [_v("node")]), _v(" "), _c('div', [_v("react")]), _v(" "), _c('div', {
        attrs: {
            "slot": "footer"
        },
        slot: "footer"
    }, [_v("vue")])])
  }
 */
export function resolveSlots( // 映射slot名字和对应的vnode
  children: ?Array<VNode>, // parentVnode.componentOptions.children
  context: ?Component // parentVnode.context
): { [key: string]: Array<VNode> } {
  if (!children || !children.length) {
    return {}
  }
  const slots = {}
  for (let i = 0, l = children.length; i < l; i++) {
    const child = children[i]
    const data = child.data
    // remove slot attribute if the node is resolved as a Vue slot node
    if (data && data.attrs && data.attrs.slot) { // data.attrs和data中都会有slot属性，删除data.attrs.slot，保留data.slot
      delete data.attrs.slot
    }
    // named slots should only be respected if the vnode was rendered in the
    // same context.
    if ((child.context === context || child.fnContext === context) &&
      data && data.slot != null // 具名插槽
    ) {
      const name = data.slot
      const slot = (slots[name] || (slots[name] = []))
      if (child.tag === 'template') { // template标签
        slot.push.apply(slot, child.children || [])
      } else {
        slot.push(child)
      }
    } else { // 默认插槽
      (slots.default || (slots.default = [])).push(child)
    }
  }
  // ignore slots that contains only whitespace
  for (const name in slots) {
    if (slots[name].every(isWhitespace)) {
      delete slots[name]
    }
  }
  return slots
}

function isWhitespace(node: VNode): boolean {
  return (node.isComment && !node.asyncFactory) || node.text === ' '
}
