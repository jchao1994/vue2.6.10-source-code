import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'

function Vue (options) {
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)
}

initMixin(Vue) // 初始化_init方法
stateMixin(Vue) // 初始化$data $props $set $delete $watch
eventsMixin(Vue)  // 初始化$on $once $off $emit
lifecycleMixin(Vue) // 初始化_updata $forceUpdate $destroy
renderMixin(Vue) // 初始化$nextTick _render 

export default Vue
