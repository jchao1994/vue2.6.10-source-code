/* @flow */

// Provides transition support for a single element/component.
// supports transition mode (out-in / in-out)

import { warn } from 'core/util/index'
import { camelize, extend, isPrimitive } from 'shared/util'
import {
  mergeVNodeHook,
  isAsyncPlaceholder,
  getFirstComponentChild
} from 'core/vdom/helpers/index'

export const transitionProps = {
  name: String,
  appear: Boolean,
  css: Boolean,
  mode: String,
  type: String,
  enterClass: String,
  leaveClass: String,
  enterToClass: String,
  leaveToClass: String,
  enterActiveClass: String,
  leaveActiveClass: String,
  appearClass: String,
  appearActiveClass: String,
  appearToClass: String,
  duration: [Number, String, Object]
}

// in case the child is also an abstract component, e.g. <keep-alive>
// we want to recursively retrieve the real component to be rendered
function getRealChild (vnode: ?VNode): ?VNode {
  const compOptions: ?VNodeComponentOptions = vnode && vnode.componentOptions
  if (compOptions && compOptions.Ctor.options.abstract) {
    return getRealChild(getFirstComponentChild(compOptions.children))
  } else {
    return vnode
  }
}

// 获取transition数据
export function extractTransitionData (comp: Component): Object {
  const data = {}
  // 组件选项
  const options: ComponentOptions = comp.$options
  // props
  // transitionProps，包含name 过渡类名等
  for (const key in options.propsData) {
    data[key] = comp[key]
  }
  // events.
  // extract listeners and pass them directly to the transition methods
  const listeners: ?Object = options._parentListeners
  for (const key in listeners) {
    data[camelize(key)] = listeners[key]
  }
  return data
}

// 这里一般返回为 undefined
function placeholder (h: Function, rawChild: VNode): ?VNode {
  if (/\d-keep-alive$/.test(rawChild.tag)) {
    return h('keep-alive', {
      props: rawChild.componentOptions.propsData
    })
  }
}

function hasParentTransition (vnode: VNode): ?boolean {
  while ((vnode = vnode.parent)) {
    if (vnode.data.transition) {
      return true
    }
  }
}

function isSameChild (child: VNode, oldChild: VNode): boolean {
  return oldChild.key === child.key && oldChild.tag === child.tag
}

const isNotTextNode = (c: VNode) => c.tag || isAsyncPlaceholder(c)

const isVShowDirective = d => d.name === 'show'

export default {
  name: 'transition',
  props: transitionProps,
  abstract: true,

  render (h: Function) {
    // Transition组件只支持单个元素的过渡
    // 所以这里的children只包含单个元素
    let children: any = this.$slots.default
    if (!children) {
      return
    }

    // filter out text nodes (possible whitespaces)
    // 过滤掉文本节点
    children = children.filter(isNotTextNode)
    /* istanbul ignore if */
    if (!children.length) {
      return
    }

    // warn multiple elements
    if (process.env.NODE_ENV !== 'production' && children.length > 1) {
      warn(
        '<transition> can only be used on a single element. Use ' +
        '<transition-group> for lists.',
        this.$parent
      )
    }

    // out-in in-out
    const mode: string = this.mode

    // warn invalid mode
    if (process.env.NODE_ENV !== 'production' &&
      mode && mode !== 'in-out' && mode !== 'out-in'
    ) {
      warn(
        'invalid <transition> mode: ' + mode,
        this.$parent
      )
    }

    // 取出需要过渡的元素vnode
    const rawChild: VNode = children[0]

    // if this is a component root node and the component's
    // parent container node also has transition, skip.
    // 如果当前还有父Transition组件，这里直接返回rawChild就行，过渡功能由父Transition组件来完成
    if (hasParentTransition(this.$vnode)) {
      return rawChild
    }

    // apply transition data to child
    // use getRealChild() to ignore abstract components e.g. keep-alive
    // 跳过抽象组件（如keep-alive组件），取到内部的实际组件vnode
    // 一般 child 就是指向 rawChild
    const child: ?VNode = getRealChild(rawChild)
    /* istanbul ignore if */
    // 如果没有内部vnode，直接返回rawChild，说明不需要做过渡效果
    if (!child) {
      return rawChild
    }

    if (this._leaving) {
      return placeholder(h, rawChild)
    }

    // ensure a key that is unique to the vnode type and to this transition
    // component instance. This key will be used to remove pending leaving nodes
    // during entering.
    const id: string = `__transition-${this._uid}-`
    // 生成child.key
    // 相同标签通过key来分开
    child.key = child.key == null
      ? child.isComment
        ? id + 'comment' // 注释vnode
        : id + child.tag // 原生标签vnode
      : isPrimitive(child.key) // child.key是 string number symbol boolean
        ? (String(child.key).indexOf(id) === 0 ? child.key : id + child.key)
        : child.key

    // 获取transition数据，设置child.data.transition
    // v-show create activate remove 就是根据vnode.data.transition来实现过渡效果的
    const data: Object = (child.data || (child.data = {})).transition = extractTransitionData(this)
    // 老的child，其实也是老的自己，因为render函数返回的是child
    const oldRawChild: VNode = this._vnode
    const oldChild: VNode = getRealChild(oldRawChild)

    // mark v-show
    // so that the transition module can hand over the control to the directive
    // 标记child带了v-show
    if (child.data.directives && child.data.directives.some(isVShowDirective)) {
      child.data.show = true
    }

    if (
      oldChild &&
      oldChild.data &&
      !isSameChild(child, oldChild) &&
      !isAsyncPlaceholder(oldChild) &&
      // #6687 component root is a comment node
      !(oldChild.componentInstance && oldChild.componentInstance._vnode.isComment)
    ) {
      // replace old child transition data with fresh one
      // important for dynamic transitions!
      const oldData: Object = oldChild.data.transition = extend({}, data)
      // handle transition mode
      if (mode === 'out-in') {
        // return placeholder node and queue update when leave finishes
        // 当前元素先进行过渡，完成之后新元素过渡进入
        // 处理oldChild的 afterLeave
        this._leaving = true
        // oldChild.data.transition['afterLeave'] = invoker
        // 执行 invoker 就会调用传入的hook回调，也就是第三个参数
        // 当前元素leave结束时刻hook，触发新元素强制更新
        // 实现 当前元素离开过渡完成 => 新元素触发过渡进入
        mergeVNodeHook(oldData, 'afterLeave', () => {
          this._leaving = false
          this.$forceUpdate()
        })
        // 这里一般返回为 undefined
        return placeholder(h, rawChild)
      } else if (mode === 'in-out') {
        // 新元素先进行过渡，完成之后当前元素过渡离开
        // 处理child的 afterEnter enterCancelled，以及oldChild的 delayLeave
        if (isAsyncPlaceholder(child)) {
          return oldRawChild
        }
        let delayedLeave
        const performLeave = () => { delayedLeave() }
        // child.data.transition['afterEnter'] = invoker
        // invoker => performLeave
        // 新元素enter结束时刻hook，触发当前元素performLeave
        // 实现 新元素进入过渡完成 => 当前元素触发过渡离开
        mergeVNodeHook(data, 'afterEnter', performLeave)
        // child.data.transition['enterCancelled'] = invoker
        // invoker => performLeave
        mergeVNodeHook(data, 'enterCancelled', performLeave)
        // oldChild.data.transition['delayLeave'] = invoker
        // invoker => leave => { delayedLeave = leave }
        mergeVNodeHook(oldData, 'delayLeave', leave => { delayedLeave = leave })
      }
    }

    return rawChild
  }
}
