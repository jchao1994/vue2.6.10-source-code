/* @flow */

import { toArray } from '../util/index'

export function initUse (Vue: GlobalAPI) {
  Vue.use = function (plugin: Function | Object) {
    const installedPlugins = (this._installedPlugins || (this._installedPlugins = []))
    if (installedPlugins.indexOf(plugin) > -1) { // Vue._installedPlugins中存在plugin，直接返回Vue
      return this
    }

    // additional parameters
    const args = toArray(arguments, 1)
    args.unshift(this) // 参数数组args开头添加Vue
    // 执行plugin.install方法或者plugin方法
    if (typeof plugin.install === 'function') {
      plugin.install.apply(plugin, args)
    } else if (typeof plugin === 'function') {
      plugin.apply(null, args)
    }
    installedPlugins.push(plugin)
    return this
  }
}
