/* @flow */

import { makeMap, isBuiltInTag, cached, no } from 'shared/util'

let isStaticKey
let isPlatformReservedTag

const genStaticKeysCached = cached(genStaticKeys)

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 */
// 优化ast树，标记静态节点和静态根节点，在patch过程中可以跳过
// 静态根节点是 optimize 优化的条件，没有静态根节点，说明这部分不会被优化
export function optimize (root: ?ASTElement, options: CompilerOptions) {
  if (!root) return
  isStaticKey = genStaticKeysCached(options.staticKeys || '') // 静态key的map
  isPlatformReservedTag = options.isReservedTag || no // 是否是平台原生标签，如h1 div    platforms/web/util/element.js isReservedTag
  // first pass: mark all non-static nodes.
  // 递归标记静态节点
  markStatic(root)
  // second pass: mark static roots.
  // 递归标记静态根节点
  markStaticRoots(root, false)
}

function genStaticKeys (keys: string): Function {
  return makeMap(
    'type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap' +
    (keys ? ',' + keys : '')
  )
}

// 递归标记静态节点
function markStatic (node: ASTNode) {
  node.static = isStatic(node) // 标记是否静态
  if (node.type === 1) {
    // do not make component slot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading
    if (
      !isPlatformReservedTag(node.tag) &&
      node.tag !== 'slot' &&
      node.attrsMap['inline-template'] == null
    ) {
      return
    }
    // 只要有一个子节点不是静态的，那么这个父node就是非静态的
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i]
      markStatic(child)
      if (!child.static) {
        node.static = false
      }
    }
    // 如果node的v-if的作用域是非静态的，那么这个node就是非静态的
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        // v-if v-else-if v-else对应的el都存放在v-if对应的el的ifConditions中
        // v-if对应的就是当前node，所以主要是判断v-else-if和v-else对应的node
        const block = node.ifConditions[i].block
        markStatic(block)
        if (!block.static) {
          node.static = false
        }
      }
    }
  }
}

// 递归标记静态根节点
// 静态根节点是 optimize 优化的条件，没有静态根节点，说明这部分不会被优化
function markStaticRoots (node: ASTNode, isInFor: boolean) {
  // 只针对type=1的节点，也就是普通标签节点
  if (node.type === 1) {
    if (node.static || node.once) { // once只渲染一次，也可认为是静态的
      node.staticInFor = isInFor // 是否在v-for内部
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    // node是静态的，那其子节点必然都是静态的

    // 如果只有一个纯文本子节点，重新render的收益会更高，所以将其staticRoot为false
    // 细节:
    //   1. 维护静态模板的存储对象
    //     一开始的时候，所有的静态根节点 都会被解析生成 VNode，并且被存在一个缓存对象中，就在 Vue.proto._staticTree 中
    //     随着静态根节点的增加，这个存储对象也会越来越大，那么占用的内存就会越来越多
    //     势必要减少一些不必要的存储，所有只有纯文本的静态根节点就被排除了
    //   2. 多层render函数调用
    //     这个过程涉及到实际操作更新的过程。在实际render 的过程中，针对静态节点的操作也需要调用对应的静态节点渲染函数，做一定的判断逻辑。这里需要一定的消耗
    // 总结:
    //   如果纯文本节点不做优化，那么就是需要在更新的时候比对这部分纯文本节点咯？这么做的代价是什么呢？只是需要比对字符串是否相等而已。简直不要太简单，消耗简直不要太小
    //   既然如此，那么还需要维护多一个静态模板缓存么？在 render 操作过程中也不需要额外对该类型的静态节点进行处理
    if (node.static && node.children.length && !(
      node.children.length === 1 && // 只有一个纯文本子节点
      node.children[0].type === 3
    )) {
      node.staticRoot = true
      return
    } else {
      // 1. node是非静态的
      // 2. node没有子节点
      // 3. node只有一个纯文本子节点(这种情况下设置静态根节点收益低于重新render，所以也将其staticRoot设为false)
      // 这三种情况下staticRoot为false
      node.staticRoot = false
    }
    // 递归子节点
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for)
      }
    }
    // 遍历v-if(这个对应的节点就是当前node) v-else-if v-else中的节点(这些节点不在children中，但也算是子节点)
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor)
      }
    }
  }
}

// 是否是静态节点
function isStatic (node: ASTNode): boolean {
  if (node.type === 2) { // expression
    return false
  }
  if (node.type === 3) { // text
    return true
  }
  return !!(node.pre || (
    !node.hasBindings && // no dynamic bindings
    !node.if && !node.for && // not v-if or v-for or v-else
    !isBuiltInTag(node.tag) && // not a built-in  不是component slot
    isPlatformReservedTag(node.tag) && // not a component  是平台原生标签
    !isDirectChildOfTemplateFor(node) && // 非v-for生成的node或其子node
    Object.keys(node).every(isStaticKey) // node的每个属性必须是静态属性
  ))
}

// 是否是v-for生成node或其子node
function isDirectChildOfTemplateFor (node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent
    if (node.tag !== 'template') {
      return false
    }
    if (node.for) {
      return true
    }
  }
  return false
}
