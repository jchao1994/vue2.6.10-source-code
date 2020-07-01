/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'

const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto)

const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */
methodsToPatch.forEach(function (method) { // 修改数组的push pop shift unshift splice sort reverse这7个会修改原数组的原生方法
  // cache original method
  const original = arrayProto[method] // 原生方法
  def(arrayMethods, method, function mutator (...args) { // 重写为新方法
    const result = original.apply(this, args) // 执行原生方法
    const ob = this.__ob__
    let inserted
    switch (method) { // push unshift splice 这三种方法会给数组添加新值
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    // 如果新值是对象，进行观测 observe(新值)，inserted是包含所有新添加值的数组
    if (inserted) ob.observeArray(inserted)
    // notify change // 通知数组的依赖进行更新
    ob.dep.notify()
    return result
  })
})
