/* @flow */

import { escape } from 'web/server/util'
import { SSR_ATTR } from 'shared/constants'
import { RenderContext } from './render-context'
import { resolveAsset } from 'core/util/options'
import { generateComponentTrace } from 'core/util/debug'
import { ssrCompileToFunctions } from 'web/server/compiler'
import { installSSRHelpers } from './optimizing-compiler/runtime-helpers'

import { isDef, isUndef, isTrue } from 'shared/util'

import {
  createComponent,
  createComponentInstanceForVnode
} from 'core/vdom/create-component'

let warned = Object.create(null)
const warnOnce = msg => {
  if (!warned[msg]) {
    warned[msg] = true
    // eslint-disable-next-line no-console
    console.warn(`\n\u001b[31m${msg}\u001b[39m\n`)
  }
}

const onCompilationError = (err, vm) => {
  const trace = vm ? generateComponentTrace(vm) : ''
  throw new Error(`\n\u001b[31m${err}${trace}\u001b[39m\n`)
}

// 如果没有传入render函数，将template编译成render函数
const normalizeRender = vm => {
  const { render, template, _scopeId } = vm.$options
  if (isUndef(render)) {
    if (template) {
      const compiled = ssrCompileToFunctions(template, {
        scopeId: _scopeId,
        warn: onCompilationError
      }, vm)

      vm.$options.render = compiled.render
      vm.$options.staticRenderFns = compiled.staticRenderFns
    } else {
      throw new Error(
        `render function or template not defined in component: ${
          vm.$options.name || vm.$options._componentTag || 'anonymous'
        }`
      )
    }
  }
}

// nuxt的asyncData就是serverPrefetch吗???
function waitForServerPrefetch (vm, resolve, reject) {
  let handlers = vm.$options.serverPrefetch
  if (isDef(handlers)) {
    if (!Array.isArray(handlers)) handlers = [handlers]
    try {
      const promises = []
      for (let i = 0, j = handlers.length; i < j; i++) {
        const result = handlers[i].call(vm, vm)
        if (result && typeof result.then === 'function') {
          promises.push(result)
        }
      }
      Promise.all(promises).then(resolve).catch(reject)
      return
    } catch (e) {
      reject(e)
    }
  }
  resolve()
}

function renderNode (node, isRoot, context) {
  if (node.isString) { // 渲染字符串节点
    renderStringNode(node, context)
  } else if (isDef(node.componentOptions)) { // 渲染vue组件
    renderComponent(node, isRoot, context)
  } else if (isDef(node.tag)) { // 渲染原生dom节点
    renderElement(node, isRoot, context)
  } else if (isTrue(node.isComment)) { // 渲染注释节点
    if (isDef(node.asyncFactory)) {
      // async component
      renderAsyncComponent(node, isRoot, context)
    } else {
      context.write(`<!--${node.text}-->`, context.next)
    }
  } else {
    context.write(
      node.raw ? node.text : escape(String(node.text)),
      context.next
    )
  }
}

function registerComponentForCache (options, write) {
  // exposed by vue-loader, need to call this if cache hit because
  // component lifecycle hooks will not be called.
  const register = options._ssrRegister
  if (write.caching && isDef(register)) {
    write.componentBuffer[write.componentBuffer.length - 1].add(register)
  }
  return register
}

function renderComponent (node, isRoot, context) {
  const { write, next, userContext } = context

  // check cache hit
  const Ctor = node.componentOptions.Ctor
  const getKey = Ctor.options.serverCacheKey
  const name = Ctor.options.name
  const cache = context.cache
  const registerComponent = registerComponentForCache(Ctor.options, write)

  if (isDef(getKey) && isDef(cache) && isDef(name)) {
    const rawKey = getKey(node.componentOptions.propsData)
    if (rawKey === false) {
      renderComponentInner(node, isRoot, context)
      return
    }
    const key = name + '::' + rawKey
    const { has, get } = context
    if (isDef(has)) {
      has(key, hit => {
        if (hit === true && isDef(get)) {
          get(key, res => {
            if (isDef(registerComponent)) {
              registerComponent(userContext)
            }
            res.components.forEach(register => register(userContext))
            write(res.html, next)
          })
        } else {
          renderComponentWithCache(node, isRoot, key, context)
        }
      })
    } else if (isDef(get)) {
      get(key, res => {
        if (isDef(res)) {
          if (isDef(registerComponent)) {
            registerComponent(userContext)
          }
          res.components.forEach(register => register(userContext))
          write(res.html, next)
        } else {
          renderComponentWithCache(node, isRoot, key, context)
        }
      })
    }
  } else {
    if (isDef(getKey) && isUndef(cache)) {
      warnOnce(
        `[vue-server-renderer] Component ${
          Ctor.options.name || '(anonymous)'
        } implemented serverCacheKey, ` +
        'but no cache was provided to the renderer.'
      )
    }
    if (isDef(getKey) && isUndef(name)) {
      warnOnce(
        `[vue-server-renderer] Components that implement "serverCacheKey" ` +
        `must also define a unique "name" option.`
      )
    }
    renderComponentInner(node, isRoot, context)
  }
}

function renderComponentWithCache (node, isRoot, key, context) {
  const write = context.write
  write.caching = true
  const buffer = write.cacheBuffer
  const bufferIndex = buffer.push('') - 1
  const componentBuffer = write.componentBuffer
  componentBuffer.push(new Set())
  context.renderStates.push({
    type: 'ComponentWithCache',
    key,
    buffer,
    bufferIndex,
    componentBuffer
  })
  renderComponentInner(node, isRoot, context)
}

// renderComponent不走缓存，就是调用这个函数renderComponentInner
function renderComponentInner (node, isRoot, context) {
  const prevActive = context.activeInstance // activeInstance存储了当前组件的一些信息。如果没有当前组件的话，它就是Vue的根对象
  // expose userContext on vnode
  node.ssrContext = context.userContext
  // 子组件实例化，走生命周期
  const child = context.activeInstance = createComponentInstanceForVnode(
    node,
    context.activeInstance
  )
  // 如果没有传入render函数，将template编译成render函数
  normalizeRender(child)

  const resolve = () => {
    const childNode = child._render() // child对应的vnode
    childNode.parent = node
    context.renderStates.push({
      type: 'Component',
      prevActive
    })
    renderNode(childNode, isRoot, context)
  }

  const reject = context.done

  // 处理SSR预加载serverPrefetch(在组件实例化(生命周期)之后，render(生成vnode)之前)
  // 预加载完毕后才生成childVnode并拼接对应dom元素到html字符串上
  waitForServerPrefetch(child, resolve, reject)
}

function renderAsyncComponent (node, isRoot, context) {
  const factory = node.asyncFactory

  const resolve = comp => {
    if (comp.__esModule && comp.default) {
      comp = comp.default
    }
    const { data, children, tag } = node.asyncMeta
    const nodeContext = node.asyncMeta.context
    const resolvedNode: any = createComponent(
      comp,
      data,
      nodeContext,
      children,
      tag
    )
    if (resolvedNode) {
      if (resolvedNode.componentOptions) {
        // normal component
        renderComponent(resolvedNode, isRoot, context)
      } else if (!Array.isArray(resolvedNode)) {
        // single return node from functional component
        renderNode(resolvedNode, isRoot, context)
      } else {
        // multiple return nodes from functional component
        context.renderStates.push({
          type: 'Fragment',
          children: resolvedNode,
          rendered: 0,
          total: resolvedNode.length
        })
        context.next()
      }
    } else {
      // invalid component, but this does not throw on the client
      // so render empty comment node
      context.write(`<!---->`, context.next)
    }
  }

  if (factory.resolved) {
    resolve(factory.resolved)
    return
  }

  const reject = context.done
  let res
  try {
    res = factory(resolve, reject)
  } catch (e) {
    reject(e)
  }
  if (res) {
    if (typeof res.then === 'function') {
      res.then(resolve, reject).catch(reject)
    } else {
      // new syntax in 2.3
      const comp = res.component
      if (comp && typeof comp.then === 'function') {
        comp.then(resolve, reject).catch(reject)
      }
    }
  }
}

function renderStringNode (el, context) {
  const { write, next } = context
  if (isUndef(el.children) || el.children.length === 0) { // 不存在children
    write(el.open + (el.close || ''), next)
  } else { // 存在children
    const children: Array<VNode> = el.children
    // 把children塞进renderStates里面，
    // 写起始标签，并调用next()去渲染children，以及结束标签
    context.renderStates.push({
      type: 'Element',
      children,
      rendered: 0,
      total: children.length,
      endTag: el.close
    })
    write(el.open, next)
  }
}

function renderElement (el, isRoot, context) {
  const { write, next } = context

  if (isTrue(isRoot)) { // 根节点需要加SSR_ATTR标记
    if (!el.data) el.data = {}
    if (!el.data.attrs) el.data.attrs = {}
    el.data.attrs[SSR_ATTR] = 'true'
  }

  if (el.fnOptions) {
    registerComponentForCache(el.fnOptions, write)
  }

  const startTag = renderStartingTag(el, context) // 起始标签  class attrs style directive
  const endTag = `</${el.tag}>` // 结束标签
  if (context.isUnaryTag(el.tag)) { // 不需要结束标签
    write(startTag, next)
  } else if (isUndef(el.children) || el.children.length === 0) { // 没有子节点
    write(startTag + endTag, next)
  } else { // 有子节点
    const children: Array<VNode> = el.children
    context.renderStates.push({
      type: 'Element',
      children,
      rendered: 0,
      total: children.length,
      endTag
    })
    write(startTag, next)
  }
}

function hasAncestorData (node: VNode) {
  const parentNode = node.parent
  return isDef(parentNode) && (isDef(parentNode.data) || hasAncestorData(parentNode))
}

function getVShowDirectiveInfo (node: VNode): ?VNodeDirective {
  let dir: VNodeDirective
  let tmp

  while (isDef(node)) {
    if (node.data && node.data.directives) {
      tmp = node.data.directives.find(dir => dir.name === 'show')
      if (tmp) {
        dir = tmp
      }
    }
    node = node.parent
  }
  return dir
}

function renderStartingTag (node: VNode, context) {
  let markup = `<${node.tag}`
  const { directives, modules } = context

  // construct synthetic data for module processing
  // because modules like style also produce code by parent VNode data
  if (isUndef(node.data) && hasAncestorData(node)) {
    node.data = {}
  }
  if (isDef(node.data)) {
    // check directives
    const dirs = node.data.directives
    if (dirs) {
      for (let i = 0; i < dirs.length; i++) {
        const name = dirs[i].name
        if (name !== 'show') {
          const dirRenderer = resolveAsset(context, 'directives', name)
          if (dirRenderer) {
            // directives mutate the node's data
            // which then gets rendered by modules
            dirRenderer(node, dirs[i])
          }
        }
      }
    }

    // v-show directive needs to be merged from parent to child
    const vshowDirectiveInfo = getVShowDirectiveInfo(node)
    if (vshowDirectiveInfo) {
      directives.show(node, vshowDirectiveInfo)
    }

    // apply other modules
    for (let i = 0; i < modules.length; i++) {
      const res = modules[i](node)
      if (res) {
        markup += res
      }
    }
  }
  // attach scoped CSS ID
  let scopeId
  const activeInstance = context.activeInstance
  if (isDef(activeInstance) &&
    activeInstance !== node.context &&
    isDef(scopeId = activeInstance.$options._scopeId)
  ) {
    markup += ` ${(scopeId: any)}`
  }
  if (isDef(node.fnScopeId)) {
    markup += ` ${node.fnScopeId}`
  } else {
    while (isDef(node)) {
      if (isDef(scopeId = node.context.$options._scopeId)) {
        markup += ` ${scopeId}`
      }
      node = node.parent
    }
  }
  return markup + '>'
}

export function createRenderFunction (
  modules: Array<(node: VNode) => ?string>,
  directives: Object,
  isUnaryTag: Function,
  cache: any
) {
  return function render (
    component: Component,
    write: (text: string, next: Function) => void,
    userContext: ?Object,
    done: Function
  ) {
    warned = Object.create(null)
    const context = new RenderContext({
      activeInstance: component,
      userContext,
      write, done, renderNode,
      isUnaryTag, modules, directives,
      cache
    })
    installSSRHelpers(component)
    normalizeRender(component)

    const resolve = () => {
      renderNode(component._render(), true, context)
    }
    waitForServerPrefetch(component, resolve, done)
  }
}
