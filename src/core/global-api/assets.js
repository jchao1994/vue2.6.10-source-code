/* @flow */

import { ASSET_TYPES } from 'shared/constants'
import { isPlainObject, validateComponentName } from '../util/index'

export function initAssetRegisters (Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   */
  ASSET_TYPES.forEach(type => { // component directive filter
    Vue[type] = function (
      id: string,
      definition: Function | Object
    ): Function | Object | void {
      if (!definition) { // 没有传入definition，就是从Vue.options上取  Vue.component('xxx') => Vue.options.components.xxx
        return this.options[type + 's'][id]
      } else { // 传入definition，添加到Vue.options上  Vue.component('xxx', options) => Vue.options.components.xxx = Vue.extend(options)
        /* istanbul ignore if */
        if (process.env.NODE_ENV !== 'production' && type === 'component') {
          validateComponentName(id)
        }
        if (type === 'component' && isPlainObject(definition)) { // 定义component，definition一定是对象，先把definition组件选项变为组件构造器，再存放在Vue.components上
          definition.name = definition.name || id
          definition = this.options._base.extend(definition)
        }
        if (type === 'directive' && typeof definition === 'function') { // 定义directive，如果definition是function，把这个definition变为带bind和update的对象
          definition = { bind: definition, update: definition }
        }
        // 处理过的component和directive 以及 filter和不需要处理的directive添加到Vue.options上
        this.options[type + 's'][id] = definition
        return definition
      }
    }
  })
}
