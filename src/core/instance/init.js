/* @flow */

import config from '../config'
import { initProxy } from './proxy'
import { initState } from './state'
import { initRender } from './render'
import { initEvents } from './events'
import { mark, measure } from '../util/perf'
import { initLifecycle, callHook } from './lifecycle'
import { initProvide, initInjections } from './inject'
import { extend, mergeOptions, formatComponentName } from '../util/index'

let uid = 0

export function initMixin (Vue: Class<Component>) {
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    // a uid
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag)
    }

    // a flag to avoid this being observed
    vm._isVue = true
    // merge options // 合并options到vm.$options上
    if (options && options._isComponent) {
      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.
      initInternalComponent(vm, options)
    } else {
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    // expose real self
    vm._self = vm
    initLifecycle(vm) // 初始化组件实例的父子关系 _watcher(render watcher) 生命周期的标识符
    initEvents(vm)  // 初始化组件事件(_events vm.$options._parentListeners)
    initRender(vm)  // 初始化slot _c $createElement $attrs $listeners
    callHook(vm, 'beforeCreate') // 注册vue-router
    initInjections(vm) // resolve injections before data/props // 初始化inject：对inject中的key找到value并绑定到vm上，但不设置响应式
    initState(vm) // 初始化props methods data computed watch 响应式数据原理
    initProvide(vm) // resolve provide after data/props // 初始化provide：生成vm._provided存放provide
    callHook(vm, 'created') // created 此时可以获取到数据

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`vue ${vm._name} init`, startTag, endTag)
    }

    // 挂载方式
    //   1. new Vue({ el: 'xxx' })
    //   2. new Vue({}).$mount
    if (vm.$options.el) {
      vm.$mount(vm.$options.el) // entry-runtime-with-compiler的$mount
    }
  }
}

export function initInternalComponent (vm: Component, options: InternalComponentOptions) {
  const opts = vm.$options = Object.create(vm.constructor.options)
  // doing this because it's faster than dynamic enumeration.
  const parentVnode = options._parentVnode // 外壳节点
  opts.parent = options.parent // 父节点
  opts._parentVnode = parentVnode // 外壳节点

  const vnodeComponentOptions = parentVnode.componentOptions
  opts.propsData = vnodeComponentOptions.propsData
  opts._parentListeners = vnodeComponentOptions.listeners
  opts._renderChildren = vnodeComponentOptions.children
  opts._componentTag = vnodeComponentOptions.tag

  if (options.render) {
    opts.render = options.render
    opts.staticRenderFns = options.staticRenderFns
  }
}

export function resolveConstructorOptions (Ctor: Class<Component>) {
  let options = Ctor.options
  if (Ctor.super) {
    const superOptions = resolveConstructorOptions(Ctor.super) // 递归解构父级组件，获取所有上级的options集合
    const cachedSuperOptions = Ctor.superOptions
    if (superOptions !== cachedSuperOptions) { // 如果父级组件被修改过，更新superOptions
      // super option changed,
      // need to resolve new options.
      Ctor.superOptions = superOptions
      // check if there are any late-modified/attached options (#4976)
      const modifiedOptions = resolveModifiedOptions(Ctor) // 自己修改的那些options
      // update base extend options
      if (modifiedOptions) {
        extend(Ctor.extendOptions, modifiedOptions) // 将修改的添加到自己的Options
      }
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions) // 合并父级和自己修改后的options
      if (options.name) {
        options.components[options.name] = Ctor
      }
    }
  }
  return options
}

function resolveModifiedOptions (Ctor: Class<Component>): ?Object {
  let modified
  const latest = Ctor.options
  const sealed = Ctor.sealedOptions
  for (const key in latest) {
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {}
      modified[key] = latest[key]
    }
  }
  return modified
}
