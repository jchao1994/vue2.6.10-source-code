/* @flow */

import config from 'core/config'

import {
  warn,
  isObject,
  toObject,
  isReservedAttribute,
  camelize,
  hyphenate
} from 'core/util/index'

/**
 * Runtime helper for merging v-bind="object" into a VNode's data.
 */
// 将 v-bind="object" 转换成 VNode 的 data
// v-bind 指令的值 object 对象就是参数 value，根据这个 value 对象的值对 data 对象进行修正，最后返回 data 对象
// data中存放的是v-bind对应的变量，这里将变量对应的值替换到data中，完成修正
export function bindObjectProps (
  data: any,
  tag: string,
  value: any, // dynamicAttrs
  asProp: boolean,
  isSync?: boolean
): VNodeData {
  if (value) {
    if (!isObject(value)) {
      process.env.NODE_ENV !== 'production' && warn(
        'v-bind without argument expects an Object or Array value',
        this
      )
    } else {
      if (Array.isArray(value)) { // 转换成object，扁平化value中的每一个对象的属性
        value = toObject(value)
      }
      let hash
      for (const key in value) {
        if (
          key === 'class' ||
          key === 'style' ||
          isReservedAttribute(key) // key ref slot slot-scope is
        ) {
          hash = data
        } else {
          const type = data.attrs && data.attrs.type
          hash = asProp || config.mustUseProp(tag, type, key)
            ? data.domProps || (data.domProps = {})
            : data.attrs || (data.attrs = {})
        }
        // hash中没有key就添加
        const camelizedKey = camelize(key) // 驼峰
        const hyphenatedKey = hyphenate(key) // -连接
        if (!(camelizedKey in hash) && !(hyphenatedKey in hash)) {
          hash[key] = value[key]

          if (isSync) {
            const on = data.on || (data.on = {})
            on[`update:${key}`] = function ($event) {
              value[key] = $event
            }
          }
        }
      }
    }
  }
  return data
}
