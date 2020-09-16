/* @flow */

import { toNumber, toString, looseEqual, looseIndexOf } from 'shared/util'
import { createTextVNode, createEmptyVNode } from 'core/vdom/vnode'
import { renderList } from './render-list'
import { renderSlot } from './render-slot'
import { resolveFilter } from './resolve-filter'
import { checkKeyCodes } from './check-keycodes'
import { bindObjectProps } from './bind-object-props'
import { renderStatic, markOnce } from './render-static'
import { bindObjectListeners } from './bind-object-listeners'
import { resolveScopedSlots } from './resolve-scoped-slots'
import { bindDynamicKeys, prependModifier } from './bind-dynamic-keys'

export function installRenderHelpers (target: any) {
  target._o = markOnce // v-once
  target._n = toNumber // 转换为number
  target._s = toString // 转换为string
  target._l = renderList // v-for
  target._t = renderSlot // slot
  target._q = looseEqual // 判断a和b是否形状相同
  target._i = looseIndexOf // 找到arr中第一个与val形状相同的index
  target._m = renderStatic // 渲染静态树
  target._f = resolveFilter // 根据id找到对应的filter
  target._k = checkKeyCodes // 检查当前按下的键盘按键，若不是指定的键，则返回 true
  target._b = bindObjectProps // 将 v-bind="object" 转换成 VNode 的 data
  target._v = createTextVNode // 创建文本VNode
  target._e = createEmptyVNode // 创建一个空的 VNode（注释）
  target._u = resolveScopedSlots // scopedSlots作用域插槽
  target._g = bindObjectListeners // 判断value 是否是对象，并且为数据 data.on 合并data和value 的on 事件
  target._d = bindDynamicKeys // 合并staticKeys和dynamicKeys
  target._p = prependModifier
}
