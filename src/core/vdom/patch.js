/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 */

import VNode, { cloneVNode } from './vnode'
import config from '../config'
import { SSR_ATTR } from 'shared/constants'
import { registerRef } from './modules/ref'
import { traverse } from '../observer/traverse'
import { activeInstance } from '../instance/lifecycle'
import { isTextInputType } from 'web/util/element'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  makeMap,
  isRegExp,
  isPrimitive
} from '../util/index'

export const emptyNode = new VNode('', {}, [])

const hooks = ['create', 'activate', 'update', 'remove', 'destroy']

function sameVnode (a, b) {
  return (
    a.key === b.key && (
      (
        a.tag === b.tag &&
        a.isComment === b.isComment &&
        isDef(a.data) === isDef(b.data) &&
        sameInputType(a, b)
      ) || (
        isTrue(a.isAsyncPlaceholder) &&
        a.asyncFactory === b.asyncFactory &&
        isUndef(b.asyncFactory.error)
      )
    )
  )
}

function sameInputType (a, b) {
  if (a.tag !== 'input') return true
  let i
  const typeA = isDef(i = a.data) && isDef(i = i.attrs) && i.type
  const typeB = isDef(i = b.data) && isDef(i = i.attrs) && i.type
  return typeA === typeB || isTextInputType(typeA) && isTextInputType(typeB)
}

function createKeyToOldIdx (children, beginIdx, endIdx) {
  let i, key
  const map = {}
  for (i = beginIdx; i <= endIdx; ++i) {
    key = children[i].key
    if (isDef(key)) map[key] = i
  }
  return map
}

export function createPatchFunction (backend) {
  let i, j
  const cbs = {}

  const { modules, nodeOps } = backend
 
  for (i = 0; i < hooks.length; ++i) { // create activate update remove destroy
    cbs[hooks[i]] = []
    for (j = 0; j < modules.length; ++j) { // ref directives attrs klass events domProps style transition
      if (isDef(modules[j][hooks[i]])) { // 如果modules中的属性有上述5种hook，就放入cbs里对应的数组中
        cbs[hooks[i]].push(modules[j][hooks[i]])
      }
    }
  }

  function emptyNodeAt (elm) {
    return new VNode(nodeOps.tagName(elm).toLowerCase(), {}, [], undefined, elm)
  }

  function createRmCb (childElm, listeners) {
    function remove () {
      if (--remove.listeners === 0) {
        removeNode(childElm)
      }
    }
    remove.listeners = listeners
    return remove
  }

  function removeNode (el) {
    const parent = nodeOps.parentNode(el)
    // element may have already been removed due to v-html / v-text
    if (isDef(parent)) {
      nodeOps.removeChild(parent, el)
    }
  }

  function isUnknownElement (vnode, inVPre) {
    return (
      !inVPre &&
      !vnode.ns &&
      !(
        config.ignoredElements.length &&
        config.ignoredElements.some(ignore => {
          return isRegExp(ignore)
            ? ignore.test(vnode.tag)
            : ignore === vnode.tag
        })
      ) &&
      config.isUnknownElement(vnode.tag)
    )
  }

  let creatingElmInVPre = 0

  function createElm ( // 创建真实dom放在vnode.elm上
    vnode, // 渲染节点_vnode，如果组件的根节点是普通元素，那么_vnode也是普通的vnode
    insertedVnodeQueue,
    parentElm,
    refElm,
    nested,
    ownerArray,
    index
  ) {
    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // This vnode was used in a previous render!
      // now it's used as a new node, overwriting its elm would cause
      // potential patch errors down the road when it's used as an insertion
      // reference node. Instead, we clone the node on-demand before creating
      // associated DOM element for it.
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

    vnode.isRootInsert = !nested // for transition enter check
    // 每个组件的最外层一般都有div标签包裹，这里会直接返回undefined
    // vnode是组件实例化的vnode，在这里组件实例化，并且进行child.$mount，开始新的一轮render、update、patch
    // 组件vnode没有children，所以这里如果返回true，就直接return
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return
    }

    const data = vnode.data
    const children = vnode.children
    const tag = vnode.tag
    if (isDef(tag)) {
      if (process.env.NODE_ENV !== 'production') {
        if (data && data.pre) {
          creatingElmInVPre++
        }
        if (isUnknownElement(vnode, creatingElmInVPre)) {
          warn(
            'Unknown custom element: <' + tag + '> - did you ' +
            'register the component correctly? For recursive components, ' +
            'make sure to provide the "name" option.',
            vnode.context
          )
        }
      }

      vnode.elm = vnode.ns // 创建vnode.elm真实占位dom元素
        ? nodeOps.createElementNS(vnode.ns, tag)
        : nodeOps.createElement(tag, vnode)
      setScope(vnode) // 设置vnode的scope

      /* istanbul ignore if */
      if (__WEEX__) { // __WEEX__是什么？？？
        // in Weex, the default insertion order is parent-first.
        // List items can be optimized to use children-first insertion
        // with append="tree".
        const appendAsTree = isDef(data) && isTrue(data.appendAsTree)
        if (!appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)
        }
        createChildren(vnode, children, insertedVnodeQueue)
        if (appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)
        }
      } else {
        createChildren(vnode, children, insertedVnodeQueue) // 遍历children创建对应的DOM节点
        if (isDef(data)) {
          invokeCreateHooks(vnode, insertedVnodeQueue) // 执行create钩子函数
        }
        insert(parentElm, vnode.elm, refElm) // 将dom元素插入到父元素中
      }

      if (process.env.NODE_ENV !== 'production' && data && data.pre) {
        creatingElmInVPre--
      }
    } else if (isTrue(vnode.isComment)) { // vnode是注释节点
      vnode.elm = nodeOps.createComment(vnode.text)
      insert(parentElm, vnode.elm, refElm)
    } else { // vnode是文本节点
      vnode.elm = nodeOps.createTextNode(vnode.text)
      insert(parentElm, vnode.elm, refElm)
    }
  }

  // 先走_init(完整的生命周期，除了mounted放在了insertedVnodeQueue中触发)初始化组件，得到自己完整的insertedVnodeQueue
  // 然后走initComponent，把自己的insertedVnodeQueue合并到父节点(上下文context)的insertedVnodeQueue中
  // insertedVnodeQueue中的vnode顺序是先子后父，因此mounted生命周期函数是先子后父
  function createComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i = vnode.data
    if (isDef(i)) {
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
      // 每个组件的最外层一般都有div标签包裹，对应的vnode会直接结束这个createComponent函数，返回undefined
      if (isDef(i = i.hook) && isDef(i = i.init)) {
        i(vnode, false /* hydrating */) // 执行vnode.data.hook.init方法，生成vnode对应的组件实例(_init)并进行挂载
      }
      // after calling the init hook, if the vnode is a child component
      // it should've created a child instance and mounted it. the child
      // component also has set the placeholder vnode's elm.
      // in that case we can just return the element and be done.
      if (isDef(vnode.componentInstance)) {
        initComponent(vnode, insertedVnodeQueue)
        insert(parentElm, vnode.elm, refElm)
        if (isTrue(isReactivated)) {
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
        }
        return true
      }
    }
  }

  function initComponent (vnode, insertedVnodeQueue) {
    // data.pendingInsert存放的是子组件vnode(渲染_vnode)的insertedVnodeQueue
    // 将子组件的insertedVnodeQueue合并到自己的insertedVnodeQueue上
    if (isDef(vnode.data.pendingInsert)) {
      insertedVnodeQueue.push.apply(insertedVnodeQueue, vnode.data.pendingInsert)
      vnode.data.pendingInsert = null
    }
    vnode.elm = vnode.componentInstance.$el
    if (isPatchable(vnode)) { // 可patch
      invokeCreateHooks(vnode, insertedVnodeQueue) // 执行create钩子
      setScope(vnode) // 设置css的scope id
    } else { // 不可patch，也就是组件根为空，只注册ref
      // empty component root.
      // skip all element-related modules except for ref (#3455)
      registerRef(vnode) // 注册Ref
      // make sure to invoke the insert hook
      insertedVnodeQueue.push(vnode)
    }
  }

  function reactivateComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i
    // hack for #4339: a reactivated component with inner transition
    // does not trigger because the inner node's created hooks are not called
    // again. It's not ideal to involve module-specific logic in here but
    // there doesn't seem to be a better way to do it.
    let innerNode = vnode
    while (innerNode.componentInstance) {
      innerNode = innerNode.componentInstance._vnode
      if (isDef(i = innerNode.data) && isDef(i = i.transition)) {
        for (i = 0; i < cbs.activate.length; ++i) {
          cbs.activate[i](emptyNode, innerNode)
        }
        insertedVnodeQueue.push(innerNode)
        break
      }
    }
    // unlike a newly created component,
    // a reactivated keep-alive component doesn't insert itself
    insert(parentElm, vnode.elm, refElm)
  }

  function insert (parent, elm, ref) {
    if (isDef(parent)) {
      if (isDef(ref)) {
        if (nodeOps.parentNode(ref) === parent) {
          nodeOps.insertBefore(parent, elm, ref)
        }
      } else {
        nodeOps.appendChild(parent, elm)
      }
    }
  }

  function createChildren (vnode, children, insertedVnodeQueue) {
    if (Array.isArray(children)) {
      if (process.env.NODE_ENV !== 'production') {
        checkDuplicateKeys(children) // 检查children中的每个child的key是否重复
      }
      for (let i = 0; i < children.length; ++i) {
        createElm(children[i], insertedVnodeQueue, vnode.elm, null, true, children, i)
      }
    } else if (isPrimitive(vnode.text)) {
      nodeOps.appendChild(vnode.elm, nodeOps.createTextNode(String(vnode.text)))
    }
  }

  // 是否可patch
  function isPatchable (vnode) {
    while (vnode.componentInstance) { // 找到vnode下第一个根标签为普通标签的组件vnode
      vnode = vnode.componentInstance._vnode
    }
    return isDef(vnode.tag)
  }

  // create过程中处理数据的函数 attrs class events props style directives
  /**
     * 执行的函数包括下面这么多
     * cbs = [
     *  create:[
     *      updateAttrs, updateClass,
     *      updateDOMListeners, updateDOMProps,
     *      updateStyle, create, updateDirectives
     *  ]
     * ]
  **/
  function invokeCreateHooks (vnode, insertedVnodeQueue) {
    for (let i = 0; i < cbs.create.length; ++i) {
      cbs.create[i](emptyNode, vnode)
    }
    i = vnode.data.hook // Reuse variable
    if (isDef(i)) {
      if (isDef(i.create)) i.create(emptyNode, vnode) // data.hook.create
      if (isDef(i.insert)) insertedVnodeQueue.push(vnode) // data.hook.insert
    }
  }

  // set scope id attribute for scoped CSS.
  // this is implemented as a special case to avoid the overhead
  // of going through the normal attribute patching process.
  function setScope (vnode) {
    let i
    if (isDef(i = vnode.fnScopeId)) {
      nodeOps.setStyleScope(vnode.elm, i)
    } else {
      let ancestor = vnode
      while (ancestor) {
        if (isDef(i = ancestor.context) && isDef(i = i.$options._scopeId)) { // i = ancestor.context.$options._scopeId
          nodeOps.setStyleScope(vnode.elm, i)
        }
        ancestor = ancestor.parent
      }
    }
    // for slot content they should also get the scopeId from the host instance.
    if (isDef(i = activeInstance) && // i = activeInstance.$options._scopeId
      i !== vnode.context &&
      i !== vnode.fnContext &&
      isDef(i = i.$options._scopeId)
    ) {
      nodeOps.setStyleScope(vnode.elm, i)
    }
  }

  function addVnodes (parentElm, refElm, vnodes, startIdx, endIdx, insertedVnodeQueue) {
    for (; startIdx <= endIdx; ++startIdx) {
      createElm(vnodes[startIdx], insertedVnodeQueue, parentElm, refElm, false, vnodes, startIdx)
    }
  }

  function invokeDestroyHook (vnode) {
    let i, j
    const data = vnode.data
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.destroy)) i(vnode)
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode)
    }
    if (isDef(i = vnode.children)) {
      for (j = 0; j < vnode.children.length; ++j) {
        invokeDestroyHook(vnode.children[j])
      }
    }
  }

  function removeVnodes (vnodes, startIdx, endIdx) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx]
      if (isDef(ch)) {
        if (isDef(ch.tag)) { // 带tag的节点
          removeAndInvokeRemoveHook(ch) // 移除ch并调用remove钩子
          invokeDestroyHook(ch) // 调用destroy钩子
        } else { // Text node // 文本节点直接移除
          removeNode(ch.elm)
        }
      }
    }
  }

  function removeAndInvokeRemoveHook (vnode, rm) {
    if (isDef(rm) || isDef(vnode.data)) {
      let i
      const listeners = cbs.remove.length + 1
      if (isDef(rm)) {
        // we have a recursively passed down rm callback
        // increase the listeners count
        rm.listeners += listeners
      } else {
        // directly removing
        rm = createRmCb(vnode.elm, listeners)
      }
      // recursively invoke hooks on child component root node
      if (isDef(i = vnode.componentInstance) && isDef(i = i._vnode) && isDef(i.data)) {
        removeAndInvokeRemoveHook(i, rm)
      }
      for (i = 0; i < cbs.remove.length; ++i) {
        cbs.remove[i](vnode, rm) // 调用cbs上的remove钩子
      }
      if (isDef(i = vnode.data.hook) && isDef(i = i.remove)) {
        i(vnode, rm) // 调用vnode.data.hook.remove钩子
      } else {
        rm()
      }
    } else {
      removeNode(vnode.elm)
    }
  }

  // dom diff的核心
  function updateChildren (parentElm, oldCh, newCh, insertedVnodeQueue, removeOnly) {
    let oldStartIdx = 0
    let newStartIdx = 0
    let oldEndIdx = oldCh.length - 1
    let oldStartVnode = oldCh[0]
    let oldEndVnode = oldCh[oldEndIdx]
    let newEndIdx = newCh.length - 1
    let newStartVnode = newCh[0]
    let newEndVnode = newCh[newEndIdx]
    let oldKeyToIdx, idxInOld, vnodeToMove, refElm

    // removeOnly is a special flag used only by <transition-group>
    // to ensure removed elements stay in correct relative positions
    // during leaving transitions
    const canMove = !removeOnly

    if (process.env.NODE_ENV !== 'production') {
      checkDuplicateKeys(newCh)
    }

    // 头头 => 尾尾 => 头(老)尾(新) => 尾(老)头(新) => 查找
    // 用以上5步进行判断的目的是尽可能多得找到不用移动的vnode，直接patch更新，也就是尽可能少得移动真实dom，提高性能
    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      if (isUndef(oldStartVnode)) { // 该vnode已经被移动过了，直接跳过
        oldStartVnode = oldCh[++oldStartIdx] // Vnode has been moved left
      } else if (isUndef(oldEndVnode)) { // 该vnode已经被移动过了，直接跳过
        oldEndVnode = oldCh[--oldEndIdx]
      } else if (sameVnode(oldStartVnode, newStartVnode)) { // 新老的第一个vnode可复用，更新，同时往后移
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
        oldStartVnode = oldCh[++oldStartIdx]
        newStartVnode = newCh[++newStartIdx]
      } else if (sameVnode(oldEndVnode, newEndVnode)) { // 新老的最后一个vnode可复用，更新，同时往前移
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue, newCh, newEndIdx)
        oldEndVnode = oldCh[--oldEndIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldStartVnode, newEndVnode)) { // Vnode moved right // 老的第一个vnode和新的最后一个vnode可复用，更新，将老的第一个vnode移动到最后一个
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue, newCh, newEndIdx)
        canMove && nodeOps.insertBefore(parentElm, oldStartVnode.elm, nodeOps.nextSibling(oldEndVnode.elm))
        oldStartVnode = oldCh[++oldStartIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldEndVnode, newStartVnode)) { // Vnode moved left // 老的最后一个vnode和新的第一个vnode可复用，更新，将老的最后一个vnode移动到第一个
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
        canMove && nodeOps.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm)
        oldEndVnode = oldCh[--oldEndIdx]
        newStartVnode = newCh[++newStartIdx]
      } else {
        // 首次走到这里，会生成oldKeyToIdx，也就是剩下的老children的key(key)-value(index)的map结构
        // 用于让新child找到key相同的老child的index
        if (isUndef(oldKeyToIdx)) oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx)
        idxInOld = isDef(newStartVnode.key) // 找到newStartVnode可以复用的老children中Vnode的index
          ? oldKeyToIdx[newStartVnode.key] // newStartVnode有key，就要找到老children中有相同key的Vnode的index
          : findIdxInOld(newStartVnode, oldCh, oldStartIdx, oldEndIdx) // newStartVnode没有key，在老children中找是否存在sameVnode，新老Vnode的key均为undefined
        if (isUndef(idxInOld)) { // New element // 没有找到idxInOld，说明是新的Vnode，插在oldStartVnode.elm之前
          createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx)
        } else { // 找到了idxInOld，复用
          vnodeToMove = oldCh[idxInOld] // 需要移动的Vnode
          if (sameVnode(vnodeToMove, newStartVnode)) { // key和元素类型均相同，包括两个key都是undefined的情况
            patchVnode(vnodeToMove, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
            oldCh[idxInOld] = undefined // 老children中移动过的vnode重置为undefined，在 剩下的循环中 或是 循环之后删除剩余老children 可以跳过这个vnode
            canMove && nodeOps.insertBefore(parentElm, vnodeToMove.elm, oldStartVnode.elm) // 将可复用的Vnode移动至oldStartVnode.elm之前
          } else {
            // same key but different element. treat as new element // key相同，但不是相同类型元素
            createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx)
          }
        }
        newStartVnode = newCh[++newStartIdx]
      }
    }
    if (oldStartIdx > oldEndIdx) { // 新的children有多的Vnode，需要添加
      refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm
      addVnodes(parentElm, refElm, newCh, newStartIdx, newEndIdx, insertedVnodeQueue)
    } else if (newStartIdx > newEndIdx) { // 老的children有多的Vnode，需要移除
      removeVnodes(oldCh, oldStartIdx, oldEndIdx)
    }
  }

  function checkDuplicateKeys (children) { // 检查children中的每个child的key是否重复
    const seenKeys = {}
    for (let i = 0; i < children.length; i++) {
      const vnode = children[i]
      const key = vnode.key
      if (isDef(key)) {
        if (seenKeys[key]) {
          warn(
            `Duplicate keys detected: '${key}'. This may cause an update error.`,
            vnode.context
          )
        } else {
          seenKeys[key] = true
        }
      }
    }
  }

  function findIdxInOld (node, oldCh, start, end) {
    for (let i = start; i < end; i++) {
      const c = oldCh[i]
      if (isDef(c) && sameVnode(node, c)) return i
    }
  }

  function patchVnode ( // 新老Vnode相似，执行此方法修改现有节点
    oldVnode,
    vnode,
    insertedVnodeQueue,
    ownerArray, // null
    index, // null
    removeOnly
  ) {
    if (oldVnode === vnode) { // 新老Vnode相同，直接返回
      return
    }

    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // clone reused vnode
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

    const elm = vnode.elm = oldVnode.elm // 复用oldVnode.elm

    if (isTrue(oldVnode.isAsyncPlaceholder)) {
      if (isDef(vnode.asyncFactory.resolved)) {
        hydrate(oldVnode.elm, vnode, insertedVnodeQueue)
      } else {
        vnode.isAsyncPlaceholder = true
      }
      return
    }

    // reuse element for static trees.
    // note we only do this if the vnode is cloned -
    // if the new node is not cloned it means the render functions have been
    // reset by the hot-reload-api and we need to do a proper re-render.
    if (isTrue(vnode.isStatic) && // 处理静态节点
      isTrue(oldVnode.isStatic) &&
      vnode.key === oldVnode.key &&
      (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
    ) {
      vnode.componentInstance = oldVnode.componentInstance
      return
    }

    let i
    const data = vnode.data
    if (isDef(data) && isDef(i = data.hook) && isDef(i = i.prepatch)) {
      i(oldVnode, vnode) // 调用vnode.data.hook.prepatch钩子
    }

    const oldCh = oldVnode.children // 老的children
    const ch = vnode.children // 新的children
    if (isDef(data) && isPatchable(vnode)) { // vnode是可patch的，调用update钩子
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode)
      if (isDef(i = data.hook) && isDef(i = i.update)) i(oldVnode, vnode)
    }
    if (isUndef(vnode.text)) { // 新的没有文本
      if (isDef(oldCh) && isDef(ch)) { // 新老children都有  比较新老children，若不同，就更新
        if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly)
      } else if (isDef(ch)) { // 老的没有，新的有  清除老的文本，添加新children
        if (process.env.NODE_ENV !== 'production') {
          checkDuplicateKeys(ch) // 检查ch中的每个child的key是否重复
        }
        if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, '')
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue)
      } else if (isDef(oldCh)) { // 老的有，新的没有  清除老children
        removeVnodes(oldCh, 0, oldCh.length - 1)
      } else if (isDef(oldVnode.text)) { // 新老children都没有，老的有文本，将老文本清除
        nodeOps.setTextContent(elm, '')
      }
    } else if (oldVnode.text !== vnode.text) { // 新老text不相同  替换
      nodeOps.setTextContent(elm, vnode.text)
    }
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.postpatch)) i(oldVnode, vnode) // 调用vnode.data.hook.postpatch钩子
    }
  }

  // 延迟组件根节点的插入钩子，在真正插入元素后调用它们
  // 非根节点，将insert钩子放入父节点(外壳节点)的data.pendingInsert中，延迟触发
  // 根节点，直接触发insert钩子
  function invokeInsertHook (vnode, queue, initial) { // insertedVnodeQueue
    // delay insert hooks for component root nodes, invoke them after the
    // element is really inserted
    if (isTrue(initial) && isDef(vnode.parent)) { // 初次渲染并且有vnode.parent外壳节点
      vnode.parent.data.pendingInsert = queue
    } else { // 不满足上述条件，对每个vnode立即调用insert钩子
      for (let i = 0; i < queue.length; ++i) {
        queue[i].data.hook.insert(queue[i]) // 触发insertedVnodeQueue中的每一个vnode的insert钩子，触发mounted生命周期函数
      }
    }
  }

  let hydrationBailed = false
  // list of modules that can skip create hook during hydration because they
  // are already rendered on the client or has no need for initialization
  // Note: style is excluded because it relies on initial clone for future
  // deep updates (#7063).
  const isRenderedModule = makeMap('attrs,class,staticClass,staticStyle,key')

  // Note: this is a browser-only function so we can assume elms are DOM nodes.
  // elm是服务端返回的首屏HTML(只有页面结构(class attrs style directive scopedCSSID)，没有交互逻辑(数据双向绑定、事件绑定等))
  // vnode是客户端需要挂载的vnode(完整的vnode)
  // hydrate就是要让vue接管服务端返回的HTML的交互逻辑，实际上就是让vnode与elm对应起来
  // hydrate混合过程就是让vue进行数据双向绑定并且绑定上事件events，动态管理服务端返回的HTML
  // 服务端返回HTML的过程中，没有走过$mount，所以组件的生命周期只有beforeCreate和created
  function hydrate (elm, vnode, insertedVnodeQueue, inVPre) {
    let i
    const { tag, data, children } = vnode
    inVPre = inVPre || (data && data.pre)
    vnode.elm = elm // vnode的elm指向服务端返回的HTML中对应的dom元素

    // 注释节点或是异步组件，设置异步占位
    if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
      vnode.isAsyncPlaceholder = true
      return true
    }
    // assert node match
    // 判断elm和vnode是否匹配
    if (process.env.NODE_ENV !== 'production') {
      if (!assertNodeMatch(elm, vnode, inVPre)) {
        return false
      }
    }
    // 组件vnode tag='vue-component-xxx'
    if (isDef(data)) {
      // i = data.hook.init
      // 走组件_init初始化(完整的生命周期，除了mounted放在insertedVnodeQueue中触发)逻辑
      // 这里会递归遍历所有子组件
      if (isDef(i = data.hook) && isDef(i = i.init)) i(vnode, true /* hydrating */)
      // 组件实例，在走init钩子的时候会创建组件实例并存放在vnode.componentInstance上
      if (isDef(i = vnode.componentInstance)) {
        // child component. it should have hydrated its own tree.
        // initComponent会处理vnode的数据，包括attrs class events props style directives
        // 原生events绑定就在这里
        initComponent(vnode, insertedVnodeQueue)
        return true
      }
    }
    // 走到这里的全都是普通vnode
    // 普通vnode 一般tag='div'
    // children中可能有组件 tag='vue-component-xxx'
    if (isDef(tag)) {
      if (isDef(children)) {
        // empty element, allow client to pick up and populate children
        if (!elm.hasChildNodes()) { // 挂载子节点children
          createChildren(vnode, children, insertedVnodeQueue)
        } else {
          // v-html and domProps: innerHTML
          if (isDef(i = data) && isDef(i = i.domProps) && isDef(i = i.innerHTML)) { // i = data.domProps.innerHTML
            if (i !== elm.innerHTML) { // vnode的data.domProps.innerHTML与dom的innerHTML不匹配
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('server innerHTML: ', i)
                console.warn('client innerHTML: ', elm.innerHTML)
              }
              return false
            }
          } else { // 不存在innerHTML，依次替换子节点并检测子节点是否匹配，不匹配就返回false报错
            // iterate and compare children lists
            let childrenMatch = true
            let childNode = elm.firstChild
            for (let i = 0; i < children.length; i++) {
              if (!childNode || !hydrate(childNode, children[i], insertedVnodeQueue, inVPre)) {
                childrenMatch = false
                break
              }
              childNode = childNode.nextSibling // 依次匹配每一个dom节点
            }
            // if childNode is not null, it means the actual childNodes list is
            // longer than the virtual children list.
            // childrenMatch为false => 有单个子节点不匹配
            // childrenMatch为true，但有childNode => 真实子节点数超过vnode子节点数
            // 这两种情况均是子节点不匹配
            if (!childrenMatch || childNode) {
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('Mismatching childNodes vs. VNodes: ', elm.childNodes, children)
              }
              return false
            }
          }
        }
      }
      if (isDef(data)) {
        let fullInvoke = false
        for (const key in data) {
          // key不是attrs,class,staticClass,staticStyle,key其中之一，也就是当前vnode是组件vnode，跳出循环
          if (!isRenderedModule(key)) {
            fullInvoke = true
            invokeCreateHooks(vnode, insertedVnodeQueue)
            break
          }
        }
        if (!fullInvoke && data['class']) {
          // ensure collecting deps for deep class bindings for future updates
          // 响应式
          traverse(data['class']) 
        }
      }
    } else if (elm.data !== vnode.text) { // 文本节点，替换文本
      elm.data = vnode.text
    }
    return true
  }

  function assertNodeMatch (node, vnode, inVPre) {
    if (isDef(vnode.tag)) {
      return vnode.tag.indexOf('vue-component') === 0 || (
        !isUnknownElement(vnode, inVPre) &&
        vnode.tag.toLowerCase() === (node.tagName && node.tagName.toLowerCase())
      )
    } else {
      return node.nodeType === (vnode.isComment ? 8 : 3)
    }
  }

  return function patch (oldVnode, vnode, hydrating, removeOnly) {
    if (isUndef(vnode)) { // 老的vnode有，新的vnode没有，执行oldVnode.data.hook.destroy和cbs.destroy中的每一项
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode)
      return
    }

    let isInitialPatch = false
    // insertedVnodeQueue
    // 每创建一个组件节点或非组件节点的时候就会往insertedVnodeQueue中push当前的vnode，最后对insertedVnodeQueue中所有的vnode调用inserted钩子
    // 但是子组件首次渲染完毕不会立即调用insertedVnodeQueue中各个Vnode的insert方法，而是先存放在父组件占位vnode的vnode.data.pendingInert上，
    // 当父组件执行initComponent的时候，将子组件传递过来的insertedVnodeQueue和自身的insertedVnodeQueue进行连接，
    // 最后调用父组件的insertedVnodeQueue中各个vnode的insert方法
    const insertedVnodeQueue = []

    if (isUndef(oldVnode)) { // 老的vnode没有，新的vnode有 // 如果传入的vm.$el为undefined，也就是这里的oldVnode为undefined，那么$mount出来的vm的$el没有进行挂载
      // empty mount (likely as component), create new root element
      isInitialPatch = true // 初次渲染
      createElm(vnode, insertedVnodeQueue)
    } else { // 新老vnode都有
      const isRealElement = isDef(oldVnode.nodeType)
      if (!isRealElement && sameVnode(oldVnode, vnode)) { // 老节点不是真实dom且和新节点相似，修改现有节点
        // patch existing root node
        patchVnode(oldVnode, vnode, insertedVnodeQueue, null, null, removeOnly)
      } else { // 新老节点不相似
        if (isRealElement) { // 老节点是真实dom，创建老节点对应的渲染节点并将原来的oldVnode替换，oldVnode就变成了虚拟dom，oldVnode.elm指向真实dom
          // mounting to a real element
          // check if this is server-rendered content and if we can perform
          // a successful hydration.
          // SSR服务端 <div id="app" data-server-rendered="true">...</div>
          // data-server-rendered标记表示客户端挂载走hydrating激活模式，将服务端返回的HTML激活为由vue动态管理的DOM
          // 客户端的挂载app.$mount(服务端返回的HTML，也就是<div id="app" data-server-rendered="true">...</div>)
          // 这里的oldVnode是服务端返回的首屏HTML(只有页面结构，没有交互逻辑)
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            oldVnode.removeAttribute(SSR_ATTR)
            hydrating = true
          }
          // 用户可以传入hydrating标志需要混合
          // 服务端渲染会将根节点标志data-server-rendered设为true，patch时会将data-server-rendered移除并设置hydrating为true
          // hydrating只有首次渲染可能为true，视图更新时hydrating永远为false
          if (isTrue(hydrating)) {
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
              // 此时已经完成hydrate混合，触发insert钩子，调用每个vnode的mounted生命周期函数
              // initial设置true，因为hydrate混合只能是首次patch
              invokeInsertHook(vnode, insertedVnodeQueue, true)
              return oldVnode
            } else if (process.env.NODE_ENV !== 'production') {
              warn(
                'The client-side rendered virtual DOM tree is not matching ' +
                'server-rendered content. This is likely caused by incorrect ' +
                'HTML markup, for example nesting block-level elements inside ' +
                '<p>, or missing <tbody>. Bailing hydration and performing ' +
                'full client-side render.'
              )
            }
          }
          // either not server-rendered, or hydration failed.
          // create an empty node and replace it
          // SPA或者hydration失败，生成空的oldVnode
          oldVnode = emptyNodeAt(oldVnode)
        }

        // replacing existing element
        const oldElm = oldVnode.elm
        const parentElm = nodeOps.parentNode(oldElm) // oldElm.parent

        // create new node
        createElm(
          vnode,
          insertedVnodeQueue,
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
          oldElm._leaveCb ? null : parentElm,
          nodeOps.nextSibling(oldElm) // 创建vnode.elm插入在oldElm.nextSibling之前
        ) // 此时的insertedVnodeQueue已经合并了子组件的insertedVnodeQueue

        // update parent placeholder node element, recursively
        if (isDef(vnode.parent)) { // 如果新的vnode有parent外壳节点
          let ancestor = vnode.parent
          const patchable = isPatchable(vnode) // vnode是可patch的？？？
          while (ancestor) {
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor) // 对ancestor调用cbs中的destroy钩子(ref directives)
            }
            ancestor.elm = vnode.elm // 更新ancestor的elm
            if (patchable) { // 调用destroy后又调用create和insert？？？
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor) // 对ancestor调用cbs中的create钩子(ref directives attrs klass events domProps style transition)
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                for (let i = 1; i < insert.fns.length; i++) {
                  insert.fns[i]() // 执行ancestor.data.hook.insert.fns中的方法，这是在directives中传入的inserted与默认的data.hook.insert合并之后的方法
                }
              }
            } else {
              registerRef(ancestor)
            }
            ancestor = ancestor.parent
          }
        }

        // destroy old node // 销毁oldVnode
        if (isDef(parentElm)) {
          removeVnodes([oldVnode], 0, 0)
        } else if (isDef(oldVnode.tag)) {
          invokeDestroyHook(oldVnode)
        }
      }
    }
    
    // 此时的insertedVnodeQueue已经包括了所有子组件的insertedVnodeQueue
    // 如果是子组件，将insertedVnodeQueue放入vnode.parent.data.pendingInsert等待合并到父组件中
    // 如果是根组件，对insertedVnodeQueue中的每个vnode调用insert钩子，触发mounted生命周期函数
    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch)
    return vnode.elm
  }
}
