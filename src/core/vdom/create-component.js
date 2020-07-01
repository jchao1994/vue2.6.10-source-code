/* @flow */

import VNode from './vnode'
import { resolveConstructorOptions } from 'core/instance/init'
import { queueActivatedComponent } from 'core/observer/scheduler'
import { createFunctionalComponent } from './create-functional-component'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject
} from '../util/index'

import {
  resolveAsyncComponent,
  createAsyncPlaceholder,
  extractPropsFromVNodeData
} from './helpers/index'

import {
  callHook,
  activeInstance,
  updateChildComponent,
  activateChildComponent,
  deactivateChildComponent
} from '../instance/lifecycle'

import {
  isRecyclableComponent,
  renderRecyclableComponentTemplate
} from 'weex/runtime/recycle-list/render-component-template'

// inline hooks to be invoked on component VNodes during patch
const componentVNodeHooks = {
  init (vnode: VNodeWithData, hydrating: boolean): ?boolean { // vnode是外壳节点 hydrating为true，一般是服务器渲染过程
    if (
      vnode.componentInstance &&
      !vnode.componentInstance._isDestroyed &&
      vnode.data.keepAlive
    ) {
      // kept-alive components, treat as a patch
      const mountedNode: any = vnode // work around flow
      componentVNodeHooks.prepatch(mountedNode, mountedNode)
    } else {
      const child = vnode.componentInstance = createComponentInstanceForVnode( // 子组件实例化 _init 但没有执行$mount，vnode.componentInstance指向vnode对应的组件实例
        vnode,
        activeInstance
      )
      child.$mount(hydrating ? vnode.elm : undefined, hydrating) // child.$mount(undefined, false)  递归进行render update patch
    }
  },

  prepatch (oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
    const options = vnode.componentOptions
    const child = vnode.componentInstance = oldVnode.componentInstance // vm
    updateChildComponent(
      child, // vm
      options.propsData, // updated props
      options.listeners, // updated listeners
      vnode, // new parent vnode // 外壳节点
      options.children // new children
    )
  },

  insert (vnode: MountedComponentVNode) {
    const { context, componentInstance } = vnode
    if (!componentInstance._isMounted) {
      componentInstance._isMounted = true
      callHook(componentInstance, 'mounted') // 触发vm.$options.mounted
    }
    if (vnode.data.keepAlive) {
      if (context._isMounted) {
        // vue-router#1212
        // During updates, a kept-alive component's child components may
        // change, so directly walking the tree here may call activated hooks
        // on incorrect children. Instead we push them into a queue which will
        // be processed after the whole patch process ended.
        queueActivatedComponent(componentInstance)
      } else { // 外壳节点带keepAlive且第一次渲染，触发自己的activated以及递归触发每一个子节点activated
        activateChildComponent(componentInstance, true /* direct */)
      }
    }
  },

  destroy (vnode: MountedComponentVNode) {
    const { componentInstance } = vnode
    if (!componentInstance._isDestroyed) {
      if (!vnode.data.keepAlive) {
        componentInstance.$destroy()
      } else { // 外壳节点带keepAlive，触发自己的deactivated以及递归触发每一个子节点deactivated
        deactivateChildComponent(componentInstance, true /* direct */)
      }
    }
  }
}

const hooksToMerge = Object.keys(componentVNodeHooks) // init prepatch insert destroy

export function createComponent ( // 每个组件标签都会编译成_c(xxx)，从传入的components中找到xxx对应的组件选项，执行到这里
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  if (isUndef(Ctor)) {
    return
  }

  const baseCtor = context.$options._base // Vue

  // plain options object: turn it into a constructor
  if (isObject(Ctor)) { // 将Ctor对象转换为构造函数
    Ctor = baseCtor.extend(Ctor)
  }

  // if at this stage it's not a constructor or an async component factory,
  // reject.
  if (typeof Ctor !== 'function') {
    if (process.env.NODE_ENV !== 'production') {
      warn(`Invalid Component definition: ${String(Ctor)}`, context)
    }
    return
  }

  // async component // 异步组件，就是先给组件一个注释Vnode作为占位符或者是一个loadingComp，等到加载完后执行forceRender将其更新为加载完成后的组件
  // components: { 'my-component': () => import('./my-async-component') } 
  let asyncFactory
  if (isUndef(Ctor.cid)) { // 异步组件是一个函数，不是构造函数，没有cid属性
    asyncFactory = Ctor // 获取异步组件函数
    Ctor = resolveAsyncComponent(asyncFactory, baseCtor) // 首次执行返回undefined或者是loadingComp
    if (Ctor === undefined) { // 如果Ctor为空，就返回一个空的注释节点
      // return a placeholder node for async component, which is rendered
      // as a comment node but preserves all the raw information for the node.
      // the information will be used for async server-rendering and hydration.
      return createAsyncPlaceholder( // 渲染占位符，空的Vnode
        asyncFactory,
        data,
        context,
        children,
        tag
      )
    }
  }

  data = data || {}

  // resolve constructor options in case global mixins are applied after
  // component constructor creation
  resolveConstructorOptions(Ctor) // 向上递归更新父级和自己的options

  // transform component v-model data into props & events
  if (isDef(data.model)) { // 解析v-model
    transformModel(Ctor.options, data)
  }

  // extract props // attrs是模板标签上的属性
  const propsData = extractPropsFromVNodeData(data, Ctor, tag) // 提取Ctor.options.props中存在的，且data.props或者data.attrs中也存在的属性（优先取data.props），data.props中的不删除，data.attrs中的删除
  
  // functional component
  if (isTrue(Ctor.options.functional)) { // ???
    return createFunctionalComponent(Ctor, propsData, data, context, children)
  }

  // extract listeners, since these needs to be treated as
  // child component listeners instead of DOM listeners
  const listeners = data.on
  // replace with listeners with .native modifier
  // so it gets processed during parent component patch.
  data.on = data.nativeOn // .native事件

  if (isTrue(Ctor.options.abstract)) {
    // abstract components do not keep anything
    // other than props & listeners & slot

    // work around flow
    const slot = data.slot
    data = {}
    if (slot) {
      data.slot = slot
    }
  }

  // install component management hooks onto the placeholder node
  installComponentHooks(data) // 将传入的hook和默认的hook进行合并并存放在data.hook中  安装组件钩子函数，等待patch过程时去执行

  // return a placeholder vnode
  const name = Ctor.options.name || tag
  const vnode = new VNode( // 实例化组件的vnode，会有data.hook.init/prepatch/insert/destroy
    `vue-component-${Ctor.cid}${name ? `-${name}` : ''}`, // tag
    data, undefined, undefined, undefined, context, // data children text elm context
    { Ctor, propsData, listeners, tag, children }, // componentOptions
    asyncFactory // asyncFactory
  )

  // Weex specific: invoke recycle-list optimized @render function for
  // extracting cell-slot template.
  // https://github.com/Hanks10100/weex-native-directive/tree/master/component
  /* istanbul ignore if */
  if (__WEEX__ && isRecyclableComponent(vnode)) {
    return renderRecyclableComponentTemplate(vnode)
  }

  return vnode
}

export function createComponentInstanceForVnode (
  vnode: any, // we know it's MountedComponentVNode but flow doesn't
  parent: any, // activeInstance in lifecycle state
): Component {
  const options: InternalComponentOptions = {
    _isComponent: true,
    _parentVnode: vnode, // 外壳节点
    parent // 父节点，也是当前激活的组件实例
  }
  // check inline-template render functions
  const inlineTemplate = vnode.data.inlineTemplate
  if (isDef(inlineTemplate)) {
    options.render = inlineTemplate.render
    options.staticRenderFns = inlineTemplate.staticRenderFns
  }
  return new vnode.componentOptions.Ctor(options) // vnode.componentOptions.Ctor是子组件的构造函数  this._init(options)  子组件实例化
}

function installComponentHooks (data: VNodeData) {
  const hooks = data.hook || (data.hook = {})
  for (let i = 0; i < hooksToMerge.length; i++) { // init prepatch insert destroy
    const key = hooksToMerge[i]
    const existing = hooks[key] // 传入的
    const toMerge = componentVNodeHooks[key] // 默认的
    if (existing !== toMerge && !(existing && existing._merged)) { // 传入的和默认的不相同且传入的没有合并过，就把传入的和默认的进行合并放到data.hook[key]上
      hooks[key] = existing ? mergeHook(toMerge, existing) : toMerge
    }
  }
}

function mergeHook (f1: any, f2: any): Function {
  const merged = (a, b) => {
    // flow complains about extra args which is why we use any
    f1(a, b)
    f2(a, b)
  }
  merged._merged = true
  return merged
}

// transform component v-model info (value and callback) into
// prop and event handler respectively.
function transformModel (options, data: any) { // 可以自定义prop和event，默认是value和input的语法糖
  const prop = (options.model && options.model.prop) || 'value' // 默认是value
  const event = (options.model && options.model.event) || 'input' // 默认是input
  ;(data.attrs || (data.attrs = {}))[prop] = data.model.value // data.attrs.value = 'xxx'
  const on = data.on || (data.on = {})
  const existing = on[event]
  const callback = data.model.callback // 对应input事件
  if (isDef(existing)) { // 如果有多个事件会添加进去
    if (
      Array.isArray(existing)
        ? existing.indexOf(callback) === -1
        : existing !== callback
    ) {
      on[event] = [callback].concat(existing)
    }
  } else {
    on[event] = callback
  }
}
