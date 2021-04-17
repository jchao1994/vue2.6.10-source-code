/* @flow */

import { inBrowser, isIE9, warn } from 'core/util/index'
import { mergeVNodeHook } from 'core/vdom/helpers/index'
import { activeInstance } from 'core/instance/lifecycle'

import {
  once,
  isDef,
  isUndef,
  isObject,
  toNumber
} from 'shared/util'

import {
  nextFrame,
  resolveTransition,
  whenTransitionEnds,
  addTransitionClass,
  removeTransitionClass
} from '../transition-util'

// toggleDisplay  () => { el.style.display = originalDisplay }
// v-show的bind和update过程会执行这个enter方法
export function enter (vnode: VNodeWithData, toggleDisplay: ?() => void) {
  // dom元素
  const el: any = vnode.elm

  // call leave callback now
  // 在leave过程中触发了enter，中断leave，执行leave回调
  if (isDef(el._leaveCb)) {
    el._leaveCb.cancelled = true
    el._leaveCb()
  }

  // 处理transition数据
  // 根据 name 和 传入的过渡类名 生成 包含所有过渡类名的对象
  // 传入的过渡类名 优先级高于 name
  const data = resolveTransition(vnode.data.transition)
  if (isUndef(data)) {
    return
  }

  /* istanbul ignore if */
  // 必须是 元素节点(nodeType为1)
  if (isDef(el._enterCb) || el.nodeType !== 1) {
    return
  }

  // 解构过渡类名
  const {
    css, // 是否使用 CSS 过渡类。默认为 true。如果设置为 false，将只通过组件事件触发注册的 JavaScript 钩子
    type,
    enterClass,
    enterToClass,
    enterActiveClass,
    appearClass,
    appearToClass,
    appearActiveClass,
    beforeEnter,
    enter,
    afterEnter,
    enterCancelled,
    beforeAppear,
    appear, // 是否在初始渲染中显示过渡效果
    afterAppear,
    appearCancelled,
    duration
  } = data

  // activeInstance will always be the <transition> component managing this
  // transition. One edge case to check is when the <transition> is placed
  // as the root node of a child component. In that case we need to check
  // <transition>'s parent for appear check.
  // 当前组件实例
  let context = activeInstance
  // 当前需要过渡的node为当前组件实例的$vnode
  let transitionNode = activeInstance.$vnode
  // 找到根vnode
  // context 指向 根组件实例
  // transitionNode 指向根vnode
  while (transitionNode && transitionNode.parent) {
    context = transitionNode.context
    transitionNode = transitionNode.parent
  }

  // 根组件实例还没mount完毕，且当前vnode不是根
  // 表示当前需要展示过渡效果
  const isAppear = !context._isMounted || !vnode.isRootInsert

  // appear用来控制初次渲染的时候是否展示过渡效果
  if (isAppear && !appear && appear !== '') {
    return
  }

  // enter开始时刻class
  const startClass = isAppear && appearClass
    ? appearClass
    : enterClass
  // enter过程中class
  const activeClass = isAppear && appearActiveClass
    ? appearActiveClass
    : enterActiveClass
  // enter结束时刻class
  const toClass = isAppear && appearToClass
    ? appearToClass
    : enterToClass

  // enter开始时刻hook
  const beforeEnterHook = isAppear
    ? (beforeAppear || beforeEnter)
    : beforeEnter
  // enter过程中hook
  const enterHook = isAppear
    ? (typeof appear === 'function' ? appear : enter)
    : enter
  // enter结束时刻hook
  const afterEnterHook = isAppear
    ? (afterAppear || afterEnter)
    : afterEnter
  // enter中断时hook
  const enterCancelledHook = isAppear
    ? (appearCancelled || enterCancelled)
    : enterCancelled

  // enter过渡时间
  const explicitEnterDuration: any = toNumber(
    isObject(duration)
      ? duration.enter
      : duration
  )

  if (process.env.NODE_ENV !== 'production' && explicitEnterDuration != null) {
    checkDuration(explicitEnterDuration, 'enter', vnode)
  }

  const expectsCSS = css !== false && !isIE9
  // fn.fns[0] 或 fn 的参数长度是否大于1
  const userWantsControl = getHookArgumentsLength(enterHook)

  // 给dom元素添加 _enterCb，once包裹，只执行一次
  // enter过渡完成之后执行的回调，移除 toClass activeClass，执行 afterEnterHook
  const cb = el._enterCb = once(() => {
    // 移除 enter过程中activeClass 和 enter结束时刻toClass
    if (expectsCSS) {
      removeTransitionClass(el, toClass)
      removeTransitionClass(el, activeClass)
    }
    if (cb.cancelled) {
      // 中断
      // 移除enter开始时刻startClass
      if (expectsCSS) {
        removeTransitionClass(el, startClass)
      }
      // 执行enter中断时hook
      enterCancelledHook && enterCancelledHook(el)
    } else {
      // 没有中断，执行enter结束时刻hook
      afterEnterHook && afterEnterHook(el)
    }
    // 执行完，重置 el._enterCb
    el._enterCb = null
  })

  if (!vnode.data.show) {
    // remove pending leave element on enter by injecting an insert hook
    mergeVNodeHook(vnode, 'insert', () => {
      const parent = el.parentNode
      const pendingNode = parent && parent._pending && parent._pending[vnode.key]
      if (pendingNode &&
        pendingNode.tag === vnode.tag &&
        pendingNode.elm._leaveCb
      ) {
        pendingNode.elm._leaveCb()
      }
      enterHook && enterHook(el, cb)
    })
  }

  // start enter transition
  // 执行enter开始时刻hook
  beforeEnterHook && beforeEnterHook(el)
  if (expectsCSS) {
    // 添加enter开始时刻startClass和过程中activeClass
    // el._transitionClasses 和 el 上都添加类名 startClass 和 activeClass
    addTransitionClass(el, startClass)
    addTransitionClass(el, activeClass)
    // Transition组件内部基于 requestAnimationFrame || setTimeout 实现动画效果
    // 下一帧的requestAnimationFrame执行回调，过渡到enter结束时刻状态
    // 当前帧的浏览器渲染处理的是enter开始时刻状态
    nextFrame(() => {
      // 移除enter开始时刻startClass
      removeTransitionClass(el, startClass)
      // 没有中断，添加结束时刻toClass
      if (!cb.cancelled) {
        // el._transitionClasses 和 el 上都添加类名 toClass
        addTransitionClass(el, toClass)
        if (!userWantsControl) {
          if (isValidDuration(explicitEnterDuration)) {
            // 延迟执行 cb，也就是 el._enterCb(enter过渡完成之后执行的回调，移除 toClass activeClass，执行 afterEnterHook)
            setTimeout(cb, explicitEnterDuration)
          } else {
            // 一般会走这里
            // 不传入 duration enter事件
            // 自动检测出持续时间长的为过渡事件类型，"transition" || "animation"
            // 然后根据timeout来延迟执行cb(enter过渡完成之后执行的回调，移除 toClass activeClass，执行 afterEnterHook)
            whenTransitionEnds(el, type, cb)
          }
        }
      }
    })
  }

  // v-show
  if (vnode.data.show) {
    // el.style.display = originalDisplay
    toggleDisplay && toggleDisplay()
    // 执行enter过程中enterHook
    enterHook && enterHook(el, cb)
  }

  if (!expectsCSS && !userWantsControl) {
    cb()
  }
}

// v-show的update过程会执行这个leave方法
// rm  () => { el.style.display = 'none' }
export function leave (vnode: VNodeWithData, rm: Function) {
  const el: any = vnode.elm

  // call enter callback now
  // 在enter过程中触发了leave，中断enter，执行enter回调
  // el._enterCb  移除 toClass activeClass，执行 afterEnterHook
  if (isDef(el._enterCb)) {
    el._enterCb.cancelled = true
    el._enterCb()
  }

  // 处理transition数据
  // 根据 name 和 传入的过渡类名 生成 包含所有过渡类名的对象
  // 传入的过渡类名 优先级高于 name
  const data = resolveTransition(vnode.data.transition)
  if (isUndef(data) || el.nodeType !== 1) {
    return rm()
  }

  /* istanbul ignore if */
  if (isDef(el._leaveCb)) {
    return
  }

  const {
    css, // 是否使用 CSS 过渡类。默认为 true。如果设置为 false，将只通过组件事件触发注册的 JavaScript 钩子
    type,
    leaveClass,
    leaveToClass,
    leaveActiveClass,
    beforeLeave,
    leave,
    afterLeave,
    leaveCancelled,
    delayLeave,
    duration
  } = data

  const expectsCSS = css !== false && !isIE9
  const userWantsControl = getHookArgumentsLength(leave)

  // leave过渡时间
  const explicitLeaveDuration: any = toNumber(
    isObject(duration)
      ? duration.leave
      : duration
  )

  if (process.env.NODE_ENV !== 'production' && isDef(explicitLeaveDuration)) {
    checkDuration(explicitLeaveDuration, 'leave', vnode)
  }

  // 给dom元素添加 _leaveCb，once包裹，只执行一次
  // enter过渡完成之后执行的回调，移除 leaveToClass leaveActiveClass，执行 rm 和 afterLeave
  const cb = el._leaveCb = once(() => {
    if (el.parentNode && el.parentNode._pending) {
      el.parentNode._pending[vnode.key] = null
    }
    if (expectsCSS) {
      removeTransitionClass(el, leaveToClass)
      removeTransitionClass(el, leaveActiveClass)
    }
    if (cb.cancelled) {
      if (expectsCSS) {
        removeTransitionClass(el, leaveClass)
      }
      leaveCancelled && leaveCancelled(el)
    } else {
      rm()
      afterLeave && afterLeave(el)
    }
    el._leaveCb = null
  })

  // 根据 delayLeave 决定是否延迟执行 performLeave
  if (delayLeave) {
    delayLeave(performLeave)
  } else {
    performLeave()
  }

  // 这个过程和enter的类似
  // 当前帧leave开始 => 下一帧leave结束
  function performLeave () {
    // the delayed leave may have already been cancelled
    if (cb.cancelled) {
      return
    }
    // record leaving element
    if (!vnode.data.show && el.parentNode) {
      (el.parentNode._pending || (el.parentNode._pending = {}))[(vnode.key: any)] = vnode
    }
    // leave开始时刻hook
    beforeLeave && beforeLeave(el)
    if (expectsCSS) {
      // 添加leave开始时刻leaveClass和过程中leaveActiveClass
      addTransitionClass(el, leaveClass)
      addTransitionClass(el, leaveActiveClass)
      // Transition组件内部基于 requestAnimationFrame || setTimeout 实现动画效果
      // 下一帧的requestAnimationFrame执行回调，过渡到leave结束时刻状态
      // 当前帧的浏览器渲染处理的是leave开始时刻状态
      nextFrame(() => {
        // 移除leave开始时刻leaveClass
        removeTransitionClass(el, leaveClass)
        // 没有中断，添加结束时刻leaveToClass
        if (!cb.cancelled) {
          addTransitionClass(el, leaveToClass)
          if (!userWantsControl) {
            if (isValidDuration(explicitLeaveDuration)) {
              // 延迟执行 cb，也就是 el._leaveCb(enter过渡完成之后执行的回调，移除 leaveToClass leaveActiveClass，执行 rm 和 afterLeave)
              setTimeout(cb, explicitLeaveDuration)
            } else {
              // 一般会走这里
              // 不传入 duration enter事件
              // 自动检测出持续时间长的为过渡事件类型，"transition" || "animation"
              // 然后根据timeout来延迟执行cb(enter过渡完成之后执行的回调，移除 leaveToClass leaveActiveClass，执行 rm 和 afterLeave)
              whenTransitionEnds(el, type, cb)
            }
          }
        }
      })
    }
    // 执行leave结束时刻hook
    leave && leave(el, cb)
    if (!expectsCSS && !userWantsControl) {
      cb()
    }
  }
}

// only used in dev mode
function checkDuration (val, name, vnode) {
  if (typeof val !== 'number') {
    warn(
      `<transition> explicit ${name} duration is not a valid number - ` +
      `got ${JSON.stringify(val)}.`,
      vnode.context
    )
  } else if (isNaN(val)) {
    warn(
      `<transition> explicit ${name} duration is NaN - ` +
      'the duration expression might be incorrect.',
      vnode.context
    )
  }
}

function isValidDuration (val) {
  return typeof val === 'number' && !isNaN(val)
}

/**
 * Normalize a transition hook's argument length. The hook may be:
 * - a merged hook (invoker) with the original in .fns
 * - a wrapped component method (check ._length)
 * - a plain function (.length)
 */
// fn.fns[0] 或 fn 的参数长度是否大于1
function getHookArgumentsLength (fn: Function): boolean {
  if (isUndef(fn)) {
    return false
  }
  const invokerFns = fn.fns
  if (isDef(invokerFns)) {
    // invoker
    return getHookArgumentsLength(
      Array.isArray(invokerFns)
        ? invokerFns[0]
        : invokerFns
    )
  } else {
    return (fn._length || fn.length) > 1
  }
}

function _enter (_: any, vnode: VNodeWithData) {
  if (vnode.data.show !== true) {
    enter(vnode)
  }
}

// 导出 create activate remove
// 当元素 创建 激活 移除 的时候会触发过渡效果
// 另外 v-show 是通过display来控制的，不属于 创建 激活 移除，所以做了另外处理
export default inBrowser ? {
  create: _enter,
  activate: _enter,
  remove (vnode: VNode, rm: Function) {
    /* istanbul ignore else */
    if (vnode.data.show !== true) {
      leave(vnode, rm)
    } else {
      rm()
    }
  }
} : {}
