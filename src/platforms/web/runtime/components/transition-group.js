/* @flow */

// Provides transition support for list items.
// supports move transitions using the FLIP technique.

// Because the vdom's children update algorithm is "unstable" - i.e.
// it doesn't guarantee the relative positioning of removed elements,
// we force transition-group to update its children into two passes:
// in the first pass, we remove all nodes that need to be removed,
// triggering their leaving transition; in the second pass, we insert/move
// into the final desired state. This way in the second pass removed
// nodes will remain where they should be.

import { warn, extend } from 'core/util/index'
import { addClass, removeClass } from '../class-util'
import { transitionProps, extractTransitionData } from './transition'
import { setActiveInstance } from 'core/instance/lifecycle'

import {
  hasTransition,
  getTransitionInfo,
  transitionEndEvent,
  addTransitionClass,
  removeTransitionClass
} from '../transition-util'

const props = extend({
  tag: String, // 默认为 span
  moveClass: String // 覆盖移动过渡期间应用的 CSS 类
}, transitionProps)

// 移除Transition组件的 mode 属性
delete props.mode

export default {
  props,

  beforeMount () {
    const update = this._update
    // 修改自己的实例方法_update
    // this._vnode => this.kept => vnode
    // 首次渲染 this._vnode 和 this.kept 都为undefined，只是做了 update.call(this, vnode, hydrating)
    // 更新渲染 this._vnode 指向需要卸载的vnode，this.kept 指向需要保留的vnode
    // 这里处理的目的什么???
    this._update = (vnode, hydrating) => {
      const restoreActiveInstance = setActiveInstance(this)
      // force removing pass
      // 渲染需要保留的vnode
      this.__patch__(
        this._vnode, // 老vnode
        this.kept, // 需要保留的vnode
        false, // hydrating
        true // removeOnly (!important, avoids unnecessary moves)
      )
      // 更新vnode
      this._vnode = this.kept
      restoreActiveInstance()
      // 执行Vue原型方法_update
      // 添加当前新增的vnode,并调整节点的顺序
      update.call(this, vnode, hydrating)
    }
  },

  render (h: Function) {
    // 默认为 span
    const tag: string = this.tag || this.$vnode.data.tag || 'span'
    const map: Object = Object.create(null)
    const prevChildren: Array<VNode> = this.prevChildren = this.children
    const rawChildren: Array<VNode> = this.$slots.default || []
    const children: Array<VNode> = this.children = []
    // 获取transition数据
    const transitionData: Object = extractTransitionData(this)

    // 处理新children，存放在 children 和 map 中
    for (let i = 0; i < rawChildren.length; i++) {
      const c: VNode = rawChildren[i]
      if (c.tag) {
        // Transition的children必须是由v-for生成的且key不同
        if (c.key != null && String(c.key).indexOf('__vlist') !== 0) {
          children.push(c)
          map[c.key] = c
          // 设置 c.data.transition
          // 过渡效果实现同 Transition组件
          // v-show create activate remove 就是根据vnode.data.transition来实现过渡效果的
          ;(c.data || (c.data = {})).transition = transitionData
        } else if (process.env.NODE_ENV !== 'production') {
          const opts: ?VNodeComponentOptions = c.componentOptions
          const name: string = opts ? (opts.Ctor.options.name || opts.tag || '') : c.tag
          warn(`<transition-group> children must be keyed: <${name}>`)
        }
      }
    }

    if (prevChildren) {
      // 存放 新children 中有的部分，需要保留
      const kept: Array<VNode> = []
      // 存放 新children 中没有的部分，需要移除
      const removed: Array<VNode> = []
      for (let i = 0; i < prevChildren.length; i++) {
        const c: VNode = prevChildren[i]
        // 这里用于实现leave过渡
        c.data.transition = transitionData
        // 位置
        c.data.pos = c.elm.getBoundingClientRect()
        // 新的children中有，推入 kept
        // 新的children中没有，推入 removed
        if (map[c.key]) {
          kept.push(c)
        } else {
          removed.push(c)
        }
      }
      // this.kept 是以保留children为children的新vnode
      this.kept = h(tag, null, kept)
      // this.removed 是所有需要移除的children数组
      this.removed = removed
    }

    // 创建新vnode渲染，children为所有的新children
    return h(tag, null, children)
  },

  updated () {
    const children: Array<VNode> = this.prevChildren
    const moveClass: string = this.moveClass || ((this.name || 'v') + '-move')
    // children[0].elm的moveClass类名是否带transform样式
    if (!children.length || !this.hasMove(children[0].elm, moveClass)) {
      return
    }

    // 下面处理 moveClass
    // 添加transform和transition样式实现移动效果

    // we divide the work into three loops to avoid mixing DOM reads and writes
    // in each iteration - which helps prevent layout thrashing.
    // 遍历执行 child.elm._moveCb 和 child.elm._enterCb
    children.forEach(callPendingCbs)
    // child.data.newPos = child.elm.getBoundingClientRect()
    children.forEach(recordPosition)
    // 根据dx和dy添加transform和transition样式
    children.forEach(applyTranslation)

    // force reflow to put everything in position
    // assign to this to avoid being removed in tree-shaking
    // $flow-disable-line
    this._reflow = document.body.offsetHeight

    children.forEach((c: VNode) => {
      if (c.data.moved) {
        const el: any = c.elm
        const s: any = el.style
        // el添加类名moveClass
        addTransitionClass(el, moveClass)
        s.transform = s.WebkitTransform = s.transitionDuration = ''
        // 添加transition结束事件，移除刚才添加的事件和moveClass
        el.addEventListener(transitionEndEvent, el._moveCb = function cb (e) {
          if (e && e.target !== el) {
            return
          }
          if (!e || /transform$/.test(e.propertyName)) {
            el.removeEventListener(transitionEndEvent, cb)
            el._moveCb = null
            removeTransitionClass(el, moveClass)
          }
        })
      }
    })
  },

  methods: {
    // el的moveClass类名是否带transform样式
    hasMove (el: any, moveClass: string): boolean {
      /* istanbul ignore if */
      if (!hasTransition) {
        return false
      }
      /* istanbul ignore if */
      if (this._hasMove) {
        return this._hasMove
      }
      // Detect whether an element with the move class applied has
      // CSS transitions. Since the element may be inside an entering
      // transition at this very moment, we make a clone of it and remove
      // all other transition classes applied to ensure only the move class
      // is applied.
      // 拷贝el
      const clone: HTMLElement = el.cloneNode()
      // 移除clone上的transtion相关的类名
      if (el._transitionClasses) {
        el._transitionClasses.forEach((cls: string) => { removeClass(clone, cls) })
      }
      // 给clone添加类名moveClass
      addClass(clone, moveClass)
      clone.style.display = 'none'
      this.$el.appendChild(clone)
      // 自动检测出持续时间长的为过渡事件类型，"transition" || "animation"
      const info: Object = getTransitionInfo(clone)
      this.$el.removeChild(clone)
      return (this._hasMove = info.hasTransform)
    }
  }
}

function callPendingCbs (c: VNode) {
  /* istanbul ignore if */
  if (c.elm._moveCb) {
    c.elm._moveCb()
  }
  /* istanbul ignore if */
  if (c.elm._enterCb) {
    c.elm._enterCb()
  }
}

function recordPosition (c: VNode) {
  c.data.newPos = c.elm.getBoundingClientRect()
}

// 根据dx和dy添加transform和transition样式
function applyTranslation (c: VNode) {
  const oldPos = c.data.pos
  const newPos = c.data.newPos
  const dx = oldPos.left - newPos.left
  const dy = oldPos.top - newPos.top
  if (dx || dy) {
    c.data.moved = true
    const s = c.elm.style
    s.transform = s.WebkitTransform = `translate(${dx}px,${dy}px)`
    s.transitionDuration = '0s'
  }
}
