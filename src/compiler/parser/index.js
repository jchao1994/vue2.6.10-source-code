/* @flow */

import he from 'he'
import { parseHTML } from './html-parser'
import { parseText } from './text-parser'
import { parseFilters } from './filter-parser'
import { genAssignmentCode } from '../directives/model'
import { extend, cached, no, camelize, hyphenate } from 'shared/util'
import { isIE, isEdge, isServerRendering } from 'core/util/env'

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  getRawBindingAttr,
  pluckModuleFunction,
  getAndRemoveAttrByRegex
} from '../helpers'

export const onRE = /^@|^v-on:/
export const dirRE = process.env.VBIND_PROP_SHORTHAND
  ? /^v-|^@|^:|^\.|^#/
  : /^v-|^@|^:|^#/
export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
const stripParensRE = /^\(|\)$/g
const dynamicArgRE = /^\[.*\]$/

const argRE = /:(.*)$/
export const bindRE = /^:|^\.|^v-bind:/
const propBindRE = /^\./
const modifierRE = /\.[^.\]]+(?=[^\]]*$)/g

const slotRE = /^v-slot(:|$)|^#/

const lineBreakRE = /[\r\n]/
const whitespaceRE = /\s+/g

const invalidAttributeRE = /[\s"'<>\/=]/

const decodeHTMLCached = cached(he.decode)

export const emptySlotScopeToken = `_empty_`

// configurable state
export let warn: any
let delimiters
let transforms
let preTransforms
let postTransforms
let platformIsPreTag
let platformMustUseProp
let platformGetTagNamespace
let maybeComponent

// 创建ast元素
export function createASTElement (
  tag: string,
  attrs: Array<ASTAttr>,
  parent: ASTElement | void
): ASTElement {
  return {
    type: 1,
    tag,
    attrsList: attrs,
    attrsMap: makeAttrsMap(attrs),
    rawAttrsMap: {},
    parent,
    children: []
  }
}

/**
 * Convert HTML string to AST.
 */
// AST 元素节点总共有 3 种类型，type 为 1 表示是普通元素，为 2 表示是表达式，为 3 表示是纯文本
export function parse (
  template: string,
  options: CompilerOptions // 合并过的options
): ASTElement | void {
  warn = options.warn || baseWarn

  platformIsPreTag = options.isPreTag || no
  platformMustUseProp = options.mustUseProp || no
  platformGetTagNamespace = options.getTagNamespace || no
  const isReservedTag = options.isReservedTag || no
  maybeComponent = (el: ASTElement) => !!el.component || !isReservedTag(el.tag)

  transforms = pluckModuleFunction(options.modules, 'transformNode')
  preTransforms = pluckModuleFunction(options.modules, 'preTransformNode')
  postTransforms = pluckModuleFunction(options.modules, 'postTransformNode')

  delimiters = options.delimiters

  const stack = []
  const preserveWhitespace = options.preserveWhitespace !== false
  const whitespaceOption = options.whitespace
  let root
  let currentParent
  let inVPre = false
  let inPre = false
  let warned = false

  function warnOnce (msg, range) {
    if (!warned) {
      warned = true
      warn(msg, range)
    }
  }

  // 解析element的各种属性，然后设置父子关系，形成ast语法树
  // element.parent指向currentParent
  // currentParent的children中加入element
  function closeElement (element) {
    // 删除element的尾部空格
    trimEndingWhitespace(element)
    if (!inVPre && !element.processed) {
      // 处理元素的key ref 插槽相关 is inline-template 属性(v- @ : . #开头的以及元素普通属性)
      element = processElement(element, options)
    }
    // tree management
    if (!stack.length && element !== root) {
      // allow root elements with v-if, v-else-if and v-else
      // root带v-if v-else-if v-else
      if (root.if && (element.elseif || element.else)) {
        if (process.env.NODE_ENV !== 'production') {
          checkRootConstraints(element)
        }
        addIfCondition(root, {
          exp: element.elseif,
          block: element
        })
      } else if (process.env.NODE_ENV !== 'production') {
        warnOnce(
          `Component template should contain exactly one root element. ` +
          `If you are using v-if on multiple elements, ` +
          `use v-else-if to chain them instead.`,
          { start: element.start }
        )
      }
    }
    if (currentParent && !element.forbidden) {
      if (element.elseif || element.else) {
        // 处理v-else-if和v-else，添加ifconditions到对应的v-if的el上
        processIfConditions(element, currentParent)
      } else {
        // 将解析好的带slot相关数据的ast元素存放到父节点的scopedSlots中，并且设置好父子关系
        // 除了slot-scope语法，其他语法的ast元素的tag均为template
        if (element.slotScope) { // element有slot的props
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          const name = element.slotTarget || '"default"' // 插槽的name
          // scopedSlots中存放的都是ast元素
          ;(currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
        }
        currentParent.children.push(element)
        element.parent = currentParent
      }
    }

    // final children cleanup
    // filter out scoped slots
    // element的children过滤掉带slotScope的元素，剩下非插槽元素
    element.children = element.children.filter(c => !(c: any).slotScope)
    // remove trailing whitespace node again
    // 删除element的尾部空格
    trimEndingWhitespace(element)

    // check pre state
    // 重置inVPre为false
    if (element.pre) {
      inVPre = falsefalse
    }
    // 重置inPre为false
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options)
    }
  }

  // 删除el的尾部空格
  function trimEndingWhitespace (el) {
    // remove trailing whitespace node
    if (!inPre) {
      let lastNode
      while (
        (lastNode = el.children[el.children.length - 1]) &&
        lastNode.type === 3 &&
        lastNode.text === ' '
      ) {
        el.children.pop()
      }
    }
  }

  function checkRootConstraints (el) {
    if (el.tag === 'slot' || el.tag === 'template') {
      warnOnce(
        `Cannot use <${el.tag}> as component root element because it may ` +
        'contain multiple nodes.',
        { start: el.start }
      )
    }
    if (el.attrsMap.hasOwnProperty('v-for')) {
      warnOnce(
        'Cannot use v-for on stateful component root element because ' +
        'it renders multiple elements.',
        el.rawAttrsMap['v-for']
      )
    }
  }

  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    outputSourceRange: options.outputSourceRange,
    // 创建ast元素并添加到ast语法树root上
    start (tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      // 创建命名空间(优先继承父类命名空间)
      const ns = (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }

      // 创建ast元素
      let element: ASTElement = createASTElement(tag, attrs, currentParent)
      if (ns) {
        element.ns = ns
      }

      if (process.env.NODE_ENV !== 'production') {
        if (options.outputSourceRange) {
          element.start = start
          element.end = end
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr
            return cumulated
          }, {})
        }
        attrs.forEach(attr => {
          if (invalidAttributeRE.test(attr.name)) {
            warn(
              `Invalid dynamic argument expression: attribute names cannot contain ` +
              `spaces, quotes, <, >, / or =.`,
              {
                start: attr.start + attr.name.indexOf(`[`),
                end: attr.start + attr.name.length
              }
            )
          }
        })
      }

      // 非服务端渲染的情况下是否存在被禁止标签
      if (isForbiddenTag(element) && !isServerRendering()) {
        element.forbidden = true
        process.env.NODE_ENV !== 'production' && warn(
          'Templates should only be responsible for mapping the state to the ' +
          'UI. Avoid placing tags with side-effects in your templates, such as ' +
          `<${tag}>` + ', as they will not be parsed.',
          { start: element.start }
        )
      }

      // apply pre-transforms
      // 预处理一些动态类型：v-model
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element
      }

      // 对vue的指令进行处理v-pre、v-if、v-for、v-once、slot、key、ref
      if (!inVPre) { // 处理v-pre，有v-pre就设置inVPre为true，跳过编译，显示原本内容
        processPre(element)
        if (element.pre) {
          inVPre = true
        }
      }
      if (platformIsPreTag(element.tag)) {
        inPre = true
      }
      // 如果v-pre，就不处理v-for v-if v-once
      if (inVPre) { // 处理v-pre元素的attrs
        processRawAttrs(element)
      } else if (!element.processed) {
        // structural directives
        processFor(element) // 处理v-for
        processIf(element) // 处理v-if v-else-if v-else
        processOnce(element) // 处理v-once
      }

      // 没有root，就将element作为ast语法树root并进栈
      // 有root，就等到出栈(双标签进栈，出栈时添加父子关系)或结束元素(单标签不进栈，直接结束)时通过parent和children添加父子关系，扩展ast语法树
      if (!root) {
        root = element
        // 限制根节点不能是slot，template，v-for这类标签
        if (process.env.NODE_ENV !== 'production') {
          checkRootConstraints(root)
        }
      }

      // 不是单标签就入栈，是的话结束这个元素的
      if (!unary) {
        currentParent = element
        stack.push(element)
      } else {
        closeElement(element)
      }
    },

    // 移除栈中最后一个元素作为当前元素，同时设置栈中前一个元素为当前元素的父元素
    end (tag, start, end) {
      const element = stack[stack.length - 1]
      // pop stack
      stack.length -= 1
      currentParent = stack[stack.length - 1]
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        element.end = end
      }
      // element.parent指向currentParent
      // currentParent的children中加入element
      closeElement(element)
    },

    chars (text: string, start: number, end: number) {
      // 没有父元素就报错
      if (!currentParent) {
        if (process.env.NODE_ENV !== 'production') {
          if (text === template) {
            warnOnce(
              'Component template requires a root element, rather than just text.',
              { start }
            )
          } else if ((text = text.trim())) {
            warnOnce(
              `text "${text}" outside root element will be ignored.`,
              { start }
            )
          }
        }
        return
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      if (isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      const children = currentParent.children // 父元素的children
      if (inPre || text.trim()) {
        text = isTextTag(currentParent) ? text : decodeHTMLCached(text)
      } else if (!children.length) {
        // remove the whitespace-only node right after an opening tag
        // text只有空格，清除
        text = ''
      } else if (whitespaceOption) {
        if (whitespaceOption === 'condense') {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          // condense模式下，纯空格文本如果包括换行符，就替换成空字符串，如果不包括，就替换成单个空格
          text = lineBreakRE.test(text) ? '' : ' '
        } else {
          // 非condense模式下，纯空格文本统一替换成单个空格(无论是否包括换行符)
          text = ' '
        }
      } else {
        // 保留单个空格
        text = preserveWhitespace ? ' ' : ''
      }
      // 单个空格字符串text判断为true
      if (text) {
        if (!inPre && whitespaceOption === 'condense') {
          // condense consecutive whitespaces into single space
          // condense模式下，将多个连续空格压缩成一个
          // 这里的text不是纯空格文本, '      abc     def      ' => ' abc def '
          text = text.replace(whitespaceRE, ' ')
        }
        let res
        let child: ?ASTNode
        // 创建ast元素
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          // 表达式元素
          child = {
            type: 2,
            expression: res.expression,
            tokens: res.tokens,
            text
          }
        } else if (text !== ' ' || !children.length || children[children.length - 1].text !== ' ') {
          // 纯文本元素
          child = {
            type: 3,
            text
          }
        }
        if (child) {
          if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
            child.start = start
            child.end = end
          }
          children.push(child)
        }
      }
    },
    comment (text: string, start, end) {
      // adding anyting as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored
      if (currentParent) {
        const child: ASTText = {
          type: 3,
          text,
          isComment: true
        }
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          child.start = start
          child.end = end
        }
        currentParent.children.push(child)
      }
    }
  })
  return root
}

// 处理v-pre
function processPre (el) {
  if (getAndRemoveAttr(el, 'v-pre') != null) {
    el.pre = true
  }
}

function processRawAttrs (el) {
  const list = el.attrsList
  const len = list.length
  if (len) {
    const attrs: Array<ASTAttr> = el.attrs = new Array(len)
    for (let i = 0; i < len; i++) {
      attrs[i] = {
        name: list[i].name,
        value: JSON.stringify(list[i].value)
      }
      if (list[i].start != null) {
        attrs[i].start = list[i].start
        attrs[i].end = list[i].end
      }
    }
  } else if (!el.pre) {
    // non root node in pre blocks with no attributes
    el.plain = true
  }
}

export function processElement (
  element: ASTElement,
  options: CompilerOptions
) {
  // 处理key属性，绑定到el.key上
  processKey(element)

  // determine whether this is a plain element after
  // removing structural attributes
  element.plain = (
    !element.key &&
    !element.scopedSlots &&
    !element.attrsList.length
  )

  // 处理ref属性，绑定到el.ref上
  processRef(element)
  // 处理插槽相关属性scope slot-scope slot v-slot
  processSlotContent(element)
  // 处理slot标签，将name属性绑定到slotName上
  processSlotOutlet(element)
  // 处理is inline-template
  processComponent(element)
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element
  }
  // 处理属性，包括v- @ : . #开头的属性以及元素的普通属性
  processAttrs(element)
  return element
}

// 处理key属性，绑定到el.key上
function processKey (el) {
  const exp = getBindingAttr(el, 'key')
  if (exp) {
    if (process.env.NODE_ENV !== 'production') {
      if (el.tag === 'template') {
        warn(
          `<template> cannot be keyed. Place the key on real elements instead.`,
          getRawBindingAttr(el, 'key')
        )
      }
      if (el.for) {
        const iterator = el.iterator2 || el.iterator1
        const parent = el.parent
        if (iterator && iterator === exp && parent && parent.tag === 'transition-group') {
          warn(
            `Do not use v-for index as key on <transition-group> children, ` +
            `this is the same as not using keys.`,
            getRawBindingAttr(el, 'key'),
            true /* tip */
          )
        }
      }
    }
    el.key = exp
  }
}

// 处理ref属性，绑定到el.ref上
function processRef (el) {
  const ref = getBindingAttr(el, 'ref')
  if (ref) {
    el.ref = ref
    // 检查el是否带v-for或者el是否是v-for生成的节点或其子节点
    el.refInFor = checkInFor(el)
  }
}

// 处理v-for
// el = {
//   ...其他属性
//   for: string; // list
//   alias: string; // item, index
//   iterator1?: string; // item
//   iterator2?: string; // index
// }
export function processFor (el: ASTElement) {
  let exp
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    const res = parseFor(exp)
    if (res) {
      extend(el, res)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `Invalid v-for expression: ${exp}`,
        el.rawAttrsMap['v-for']
      )
    }
  }
}

type ForParseResult = {
  for: string; // list
  alias: string; // item
  iterator1?: string; // index/key
  iterator2?: string; // object中key对应的index
};

export function parseFor (exp: string): ?ForParseResult {
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return
  const res = {}
  res.for = inMatch[2].trim() // for后面的list
  const alias = inMatch[1].trim().replace(stripParensRE, '')
  const iteratorMatch = alias.match(forIteratorRE)
  if (iteratorMatch) {
    res.alias = alias.replace(forIteratorRE, '').trim() // item
    res.iterator1 = iteratorMatch[1].trim() // index/key
    if (iteratorMatch[2]) { // res.for为object的情况，这里匹配到的是key对应的index
      res.iterator2 = iteratorMatch[2].trim()
    }
  } else {
    res.alias = alias // item, index
  }
  return res
}

// 处理v-if v-else-if v-else
function processIf (el) {
  const exp = getAndRemoveAttr(el, 'v-if')
  if (exp) {
    // 处理v-if
    el.if = exp
    // el.ifConditions里添加{ exp: exp, block: el }
    addIfCondition(el, {
      exp: exp, // v-if表达式
      block: el // 作用域
    })
  } else {
    // 处理v-else
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    // 处理v-else-if
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    if (elseif) {
      el.elseif = elseif // v-else-if表达式
    }
  }
}

// 处理v-else-if v-else，将ifCondition绑定到对应的v-if的节点上
function processIfConditions (el, parent) {
  // 找到前一个el
  const prev = findPrevElement(parent.children)
  // 如果prev是v-if，将当前el绑定到prev的ifCondition上
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `v-${el.elseif ? ('else-if="' + el.elseif + '"') : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? 'v-else-if' : 'v-else']
    )
  }
}

//找到前一个el
function findPrevElement (children: Array<any>): ASTElement | void {
  let i = children.length
  while (i--) {
    if (children[i].type === 1) {
      return children[i]
    } else {
      if (process.env.NODE_ENV !== 'production' && children[i].text !== ' ') {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
          `will be ignored.`,
          children[i]
        )
      }
      children.pop()
    }
  }
}

export function addIfCondition (el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = []
  }
  el.ifConditions.push(condition)
}

// 处理v-once
function processOnce (el) {
  const once = getAndRemoveAttr(el, 'v-once')
  if (once != null) {
    el.once = true
  }
}

// handle content being passed to a component as slot,
// e.g. <template slot="xxx">, <div slot-scope="xxx">
function processSlotContent (el) {
  let slotScope // 组件传给slot的props
  if (el.tag === 'template') {
    // scope属性只可用于template标签，被 2.5.0 新增的 slot-scope 取代
    slotScope = getAndRemoveAttr(el, 'scope')
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && slotScope) {
      warn(
        `the "scope" attribute for scoped slots have been deprecated and ` +
        `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
        `can also be used on plain elements in addition to <template> to ` +
        `denote scoped slots.`,
        el.rawAttrsMap['scope'],
        true
      )
    }
    // 优先级scope > slot-scope
    el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
  } else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
    // el不是template标签，就是找slot-scope属性作为slotScope
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && el.attrsMap['v-for']) {
      warn(
        `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
        `(v-for takes higher priority). Use a wrapper <template> for the ` +
        `scoped slot to make it clearer.`,
        el.rawAttrsMap['slot-scope'],
        true
      )
    }
    el.slotScope = slotScope
  }

  // slot="xxx"  slot对应的name  推荐 2.6.0 新增的 v-slot
  const slotTarget = getBindingAttr(el, 'slot')
  if (slotTarget) {
    // 没有slot属性，就默认slotTarget为default
    el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
    // v-bind绑定的动态slot
    el.slotTargetDynamic = !!(el.attrsMap[':slot'] || el.attrsMap['v-bind:slot'])
    // preserve slot as an attribute for native shadow DOM compat
    // only for non-scoped slots.
    // 将slot作为el的原生属性
    if (el.tag !== 'template' && !el.slotScope) {
      addAttr(el, 'slot', slotTarget, getRawBindingAttr(el, 'slot'))
    }
  }

  // 2.6 v-slot syntax  推荐的v-slot语法
  // 只能用于template(多个具名插槽只能用这个)，或者是组件(必须是一个单独的带 prop 的默认插槽)
  // v-slot:xxx = ""  #xxx = ""
  if (process.env.NEW_SLOT_SYNTAX) {
    if (el.tag === 'template') {
      // v-slot on <template>
      // template上的v-slot
      // 移除v-slot属性
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (process.env.NODE_ENV !== 'production') {
          if (el.slotTarget || el.slotScope) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          if (el.parent && !maybeComponent(el.parent)) {
            warn(
              `<template v-slot> can only appear at the root level inside ` +
              `the receiving component`,
              el
            )
          }
        }
        const { name, dynamic } = getSlotName(slotBinding)
        el.slotTarget = name
        el.slotTargetDynamic = dynamic
        el.slotScope = slotBinding.value || emptySlotScopeToken // force it into a scoped slot for perf // 组件slot传递的props
      }
    } else {
      // v-slot on component, denotes default slot
      // 组件上的v-slot，slot必须是一个单独的带 prop 的默认插槽
      // 生成新的tag为template的ast元素作为slot的内容，设置在el.scopedSlots中
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (process.env.NODE_ENV !== 'production') {
          if (!maybeComponent(el)) {
            warn(
              `v-slot can only be used on components or <template>.`,
              slotBinding
            )
          }
          if (el.slotScope || el.slotTarget) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          if (el.scopedSlots) {
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
              `<template> syntax when there are other named slots.`,
              slotBinding
            )
          }
        }
        // add the component's children to its default slot
        const slots = el.scopedSlots || (el.scopedSlots = {})
        // 获取slot的name
        const { name, dynamic } = getSlotName(slotBinding)
        // 创建slot的容器slotContainer
        const slotContainer = slots[name] = createASTElement('template', [], el)
        slotContainer.slotTarget = name
        slotContainer.slotTargetDynamic = dynamic
        // 过滤出所有不带slotScope的children，放入slotContainer.children中
        slotContainer.children = el.children.filter((c: any) => {
          // 只有el有带scope或slot-scope属性的template子标签，才会生成带slotScope的child(template元素)
          // 如果child有slotScope，那么el就有scopedSlots，上面的逻辑就会报错
          // 不会存在有slotScope的child
          if (!c.slotScope) {
            c.parent = slotContainer
            return true
          }
        })
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken // 组件slot传递的props
        // remove children as they are returned from scopedSlots now
        // 清空el的children
        el.children = []
        // mark el non-plain so data gets generated
        // 标记el为非plain
        el.plain = false
      }
    }
  }
}

function getSlotName (binding) {
  let name = binding.name.replace(slotRE, '')
  if (!name) {
    if (binding.name[0] !== '#') {
      name = 'default'
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `v-slot shorthand syntax requires a slot name.`,
        binding
      )
    }
  }
  return dynamicArgRE.test(name)
    // dynamic [name]
    ? { name: name.slice(1, -1), dynamic: true }
    // static name
    : { name: `"${name}"`, dynamic: false }
}

// handle <slot/> outlets
// 处理slot标签，将name属性绑定到slotName上
function processSlotOutlet (el) {
  if (el.tag === 'slot') {
    el.slotName = getBindingAttr(el, 'name')
    if (process.env.NODE_ENV !== 'production' && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`,
        getRawBindingAttr(el, 'key')
      )
    }
  }
}

// 处理is inline-template
function processComponent (el) {
  let binding
  if ((binding = getBindingAttr(el, 'is'))) {
    el.component = binding
  }
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    el.inlineTemplate = true
  }
}

// 处理属性，包括v- @ : . #开头的属性以及元素的普通属性
function processAttrs (el) {
  const list = el.attrsList // 属性列表
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic
  for (i = 0, l = list.length; i < l; i++) {
    name = rawName = list[i].name
    value = list[i].value
    if (dirRE.test(name)) { // 匹配v- @ : . #开头的属性
      // mark element as dynamic
      // 标记为动态元素
      el.hasBindings = true
      // modifiers
      // 解析所有的.修饰符，如{ native: true, prevent: true }
      modifiers = parseModifiers(name.replace(dirRE, ''))
      // support .foo shorthand syntax for the .prop modifier
      // .prop修饰符指定的值不应该被props解析，而应该作为dom的属性绑定在元素上
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) {
        (modifiers || (modifiers = {})).prop = true
        name = `.` + name.slice(1).replace(modifierRE, '')
      } else if (modifiers) {
        name = name.replace(modifierRE, '')
      }
      if (bindRE.test(name)) { // v-bind
        // 匹配: . v-bind:开头的属性
        // 移除开头的: . v-bind:
        name = name.replace(bindRE, '')
        // 对一些表达式做解析，例如{a|func1|func2} ???
        value = parseFilters(value)
        // name是否包裹在[]中，表示key是变量
        isDynamic = dynamicArgRE.test(name)
        // 移除首尾中括号
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        if (
          process.env.NODE_ENV !== 'production' &&
          value.trim().length === 0
        ) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          )
        }
        if (modifiers) {
          if (modifiers.prop && !isDynamic) {
            name = camelize(name) // -连接转驼峰
            if (name === 'innerHtml') name = 'innerHTML'
          }
          // camel修饰符，强行转驼峰
          if (modifiers.camel && !isDynamic) {
            name = camelize(name)
          }
          // .sync修饰符，可以让子组件修改prop的值
          // <child :foo.sync="msg"></child> 是 <child :foo="bar" @update:foo="val => bar = val"> 的语法糖
          // 子组件通过this.$emit("update:foo", newValue )触发
          if (modifiers.sync) {
            syncGen = genAssignmentCode(value, `$event`)
            // 根据不同情况的name，生成不同事件名的事件(只是事件的名字不同，事件体完全相同)
            if (!isDynamic) { // 非变量key，添加name为驼峰和-连接(若相同(单个词的name两者就会相同)，就只添加一个)的事件
              addHandler(
                el,
                `update:${camelize(name)}`, // 驼峰
                syncGen,
                null,
                false,
                warn,
                list[i]
              )
              if (hyphenate(name) !== camelize(name)) {
                addHandler(
                  el,
                  `update:${hyphenate(name)}`, // -连接
                  syncGen,
                  null,
                  false,
                  warn,
                  list[i]
                )
              }
            } else { // 变量key，取变量name的值作为事件名，绑定事件
              // handler w/ dynamic event name
              addHandler(
                el,
                `"update:"+(${name})`,
                syncGen,
                null,
                false,
                warn,
                list[i],
                true // dynamic
              )
            }
          }
        }
        if ((modifiers && modifiers.prop) || (
          !el.component && platformMustUseProp(el.tag, el.attrsMap.type, name)
        )) {
          addProp(el, name, value, list[i], isDynamic) // 添加props，标记plain为false
        } else {
          addAttr(el, name, value, list[i], isDynamic) // 添加attrs，标记plain为false
        }
      } else if (onRE.test(name)) { // v-on
        // 匹配v-on @开头的属性
        // 移除开头的v-on @
        name = name.replace(onRE, '')
        // name是否包裹在[]中，表示key是变量
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        // 绑定事件
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic)
      } else { // normal directives
        // 除去v-bind和v-on以外的指令v-xxx，v-model也会走到这里
        // 移除开头的v-
        name = name.replace(dirRE, '')
        // parse arg
        // v-demo:foo.a.b="message"
        const argMatch = name.match(argRE) // [":foo.a.b", "foo.a.b"]
        let arg = argMatch && argMatch[1] // "foo.a.b"
        isDynamic = false
        if (arg) {
          name = name.slice(0, -(arg.length + 1)) // demo
          if (dynamicArgRE.test(arg)) { // 判断arg是否是变量
            arg = arg.slice(1, -1) // 取变量名
            isDynamic = true
          }
        }

        // 添加指令
        // v-demo:foo.a.b="message"
        // name = 'demo'
        // rawName = 'v-demo:foo.a.b'
        // value = 'message'
        // arg = 'foo.a.b'
        addDirective(el, name, rawName, value, arg, isDynamic, modifiers, list[i])
        // 检查v-model是否被绑定在了v-for内部
        if (process.env.NODE_ENV !== 'production' && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
    } else { // 普通属性，添加attrs
      // literal attribute
      if (process.env.NODE_ENV !== 'production') {
        const res = parseText(value, delimiters)
        if (res) {
          warn(
            `${name}="${value}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div id="{{ val }}">, use <div :id="val">.',
            list[i]
          )
        }
      }
      // 添加attrs
      addAttr(el, name, JSON.stringify(value), list[i])
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      // 兼容firefox的muted属性
      if (!el.component &&
          name === 'muted' &&
          platformMustUseProp(el.tag, el.attrsMap.type, name)) {
        addProp(el, name, 'true', list[i])
      }
    }
  }
}

// 检查el是否带v-for或者el是否是v-for生成的节点或其子节点
function checkInFor (el: ASTElement): boolean {
  let parent = el
  while (parent) {
    if (parent.for !== undefined) {
      return true
    }
    parent = parent.parent
  }
  return false
}

// 解析所有的.修饰符
function parseModifiers (name: string): Object | void {
  const match = name.match(modifierRE)
  if (match) {
    const ret = {}
    match.forEach(m => { ret[m.slice(1)] = true })
    return ret
  }
}

function makeAttrsMap (attrs: Array<Object>): Object {
  const map = {}
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== 'production' &&
      map[attrs[i].name] && !isIE && !isEdge
    ) {
      warn('duplicate attribute: ' + attrs[i].name, attrs[i])
    }
    map[attrs[i].name] = attrs[i].value
  }
  return map
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag (el): boolean {
  return el.tag === 'script' || el.tag === 'style'
}

function isForbiddenTag (el): boolean {
  return (
    el.tag === 'style' ||
    (el.tag === 'script' && (
      !el.attrsMap.type ||
      el.attrsMap.type === 'text/javascript'
    ))
  )
}

const ieNSBug = /^xmlns:NS\d+/
const ieNSPrefix = /^NS\d+:/

/* istanbul ignore next */
function guardIESVGBug (attrs) {
  const res = []
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, '')
      res.push(attr)
    }
  }
  return res
}

// 检查v-model是否被绑定在了v-for内部
function checkForAliasModel (el, value) {
  let _el = el
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
        `You are binding v-model directly to a v-for iteration alias. ` +
        `This will not be able to modify the v-for source array because ` +
        `writing to the alias is like modifying a function local variable. ` +
        `Consider using an array of objects and use v-model on an object property instead.`,
        el.rawAttrsMap['v-model']
      )
    }
    _el = _el.parent
  }
}
