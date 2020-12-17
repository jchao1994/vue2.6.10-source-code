/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import Dep, { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute
} from '../util/index'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props) // 初始化props：生成vm._props，同时代理vm.xxx => vm._props.xxx
  if (opts.methods) initMethods(vm, opts.methods) // 初始化methods：将method直接绑到vm上
  if (opts.data) {
    initData(vm) // 初始化data：生成vm._data，同时代理vm.xxx => vm._data.xxx
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  if (opts.computed) initComputed(vm, opts.computed) // 初始化computed：生成vm._computedWatchers，对每个computed生成对应的watcher存放在vm._computedWatchers中，并设置响应式和缓存
  if (opts.watch && opts.watch !== nativeWatch) { // 不是原生的watch（火狐有原生Object.prototype.watch方法）
    initWatch(vm, opts.watch)
  }
}

function initProps (vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = vm.$options._propKeys = []
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) {
    toggleObserving(false) // props中的value已经在父组件中定义了__ob__，不需要重新定义
  }
  for (const key in propsOptions) { // 遍历传入的props
    keys.push(key)
    const value = validateProp(key, propsOptions, propsData, vm) // 从propsData（父级）取传入的值，若没有，就取自己传入的props中的default 其中Boolean类型做了特殊处理
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
          config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      defineReactive(props, key, value) // 将propsData或者propsOptions中的key-value添加进vm._props中并添加响应式
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      proxy(vm, `_props`, key) // vm取propsOptions时进行代理  vm.xxx => vm._props.xxx
    }
  }
  toggleObserving(true)
}

function initData (vm: Component) {
  let data = vm.$options.data
  data = vm._data = typeof data === 'function' // data: {} 或者 data() { return {} } // 将data数据存放在vm._data中
    ? getData(data, vm)
    : data || {}
  if (!isPlainObject(data)) { // 如果data不是对象，就抛出警告
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) { // hasOwn  Object.prototype.hasOwnProperty.call(obj, key)
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) { // 如果key不是以$或_开头的保留属性，对其进行代理，vm.xxx => vm._data.xxx
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  observe(data, true /* asRootData */)  // 观测根数据data
}

export function getData (data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

const computedWatcherOptions = { lazy: true }

function initComputed (vm: Component, computed: Object) {
  // $flow-disable-line
  const watchers = vm._computedWatchers = Object.create(null)
  // computed properties are just getters during SSR
  const isSSR = isServerRendering()

  for (const key in computed) {
    const userDef = computed[key]
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions // { lazy: true } computed的标识符 即computed对应的watch创建时this.dirty = this.lazy = true
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
    if (!(key in vm)) {
      defineComputed(vm, key, userDef) // 进行响应式设置
    } else if (process.env.NODE_ENV !== 'production') {
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      }
    }
  }
}

export function defineComputed (
  target: any,
  key: string,
  userDef: Object | Function
) {
  const shouldCache = !isServerRendering() // 非服务器端渲染为true
  if (typeof userDef === 'function') { // computed中定义的是方法，直接将其作为get，没有set
    sharedPropertyDefinition.get = shouldCache // 是否缓存，若缓存，就将计算结果存储在对应的watcher的value中，只要数据不发生变化，就不会重新计算
      ? createComputedGetter(key)
      : createGetterInvoker(userDef)
    sharedPropertyDefinition.set = noop
  } else { // computed中定义的是对象，用定义的get和set，get中可以自定义cache属性设置是否缓存
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop
    sharedPropertyDefinition.set = userDef.set || noop
  }
  if (process.env.NODE_ENV !== 'production' &&
      sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

function createComputedGetter (key) {
  return function computedGetter () {
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      if (watcher.dirty) { // dirty为true，就进行计算并将dirty改为false，即标记缓存
        watcher.evaluate()
      }
      if (Dep.target) { // Dep.target为外层的computed对应的watcher依赖（也可能是其他调用这个computed的watcher），让收集了内层watcher依赖的dep收集外层watcher依赖（也就是说内层的数据变了，也需要通知外层更新）
        watcher.depend()
      }
      return watcher.value
    }
  }
}

function createGetterInvoker(fn) {
  return function computedGetter () {
    return fn.call(this, this)
  }
}

function initMethods (vm: Component, methods: Object) {
  const props = vm.$options.props
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      if (typeof methods[key] !== 'function') {
        warn(
          `Method "${key}" has type "${typeof methods[key]}" in the component definition. ` +
          `Did you reference the function correctly?`,
          vm
        )
      }
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm
        )
      }
      if ((key in vm) && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)  // vm[key] = methods[key].bind(vm)
  }
}

// 初始化watch 支持string object array
function initWatch (vm: Component, watch: Object) {
  for (const key in watch) {
    const handler = watch[key]
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

// 先处理得到正确的handler和options，然后执行vm.$watch
function createWatcher (
  vm: Component,
  expOrFn: string | Function, // key
  handler: any, // string(method函数名) | object
  options?: Object
) {
  // 处理一下handle和options，再调用vm.$watch
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
  }r
  // 取到对应的handler
  if (typeof handler === 'string') {
    handler = vm[handler]
  }
  return vm.$watch(expOrFn, handler, options)
}

export function stateMixin (Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () { return this._data }
  const propsDef = {}
  propsDef.get = function () { return this._props }
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function () {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef) // vm.$data获取到vm._data
  Object.defineProperty(Vue.prototype, '$props', propsDef) // vm.$props获取到vm._props

  Vue.prototype.$set = set // 对数组或对象设置key-value，并触发依赖更新（已有key）或设置响应式（新增key） Vue.set = set
  Vue.prototype.$delete = del // 对数组或对象删除key，并触发依赖更新  Vue.delete = del

  Vue.prototype.$watch = function ( // initWatch和vm.$watch会调用这个方法创建watcher
    expOrFn: string | Function, // key
    cb: any, // handler
    options?: Object
  ): Function {
    const vm: Component = this
    // 如果cb是对象，将cb处理成handle和options，重新调用vm.$watch(expOrFn, handler, options)
    // initWatch过来的已经处理过了，直接vm.$watch过来的还需要进行处理
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }
    options = options || {}
    // watch就是user watcher
    options.user = true
    // new Watch的时候会执行一次get进行依赖收集，同时将最新的值放在watcher.value上
    const watcher = new Watcher(vm, expOrFn, cb, options)
    // 传入immediate会在绑定的时候直接执行一次
    if (options.immediate) {
      try {
        // immediate只会传入newVal
        cb.call(vm, watcher.value)
      } catch (error) {
        handleError(error, vm, `callback for immediate watcher "${watcher.expression}"`)
      }
    }
    // 通过xxx = vm.$watch监控expOrFn，可以调用xxx.unwatchFn来停止监控
    return function unwatchFn () {
      watcher.teardown()
    }
  }
}
