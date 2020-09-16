/* @flow */

import { genHandlers } from './events'
import baseDirectives from '../directives/index'
import { camelize, no, extend } from 'shared/util'
import { baseWarn, pluckModuleFunction } from '../helpers'
import { emptySlotScopeToken } from '../parser/index'

type TransformFunction = (el: ASTElement, code: string) => string;
type DataGenFunction = (el: ASTElement) => string;
type DirectiveFunction = (el: ASTElement, dir: ASTDirective, warn: Function) => boolean;

export class CodegenState {
  options: CompilerOptions;
  warn: Function;
  transforms: Array<TransformFunction>;
  dataGenFns: Array<DataGenFunction>;
  directives: { [key: string]: DirectiveFunction };
  maybeComponent: (el: ASTElement) => boolean;
  onceId: number;
  staticRenderFns: Array<string>;
  pre: boolean;

  constructor (options: CompilerOptions) {
    this.options = options
    this.warn = options.warn || baseWarn
    this.transforms = pluckModuleFunction(options.modules, 'transformCode')
    this.dataGenFns = pluckModuleFunction(options.modules, 'genData') // src/platforms/web/compiler/index.js
    this.directives = extend(extend({}, baseDirectives), options.directives)
    const isReservedTag = options.isReservedTag || no
    this.maybeComponent = (el: ASTElement) => !!el.component || !isReservedTag(el.tag)
    this.onceId = 0
    this.staticRenderFns = []
    this.pre = false
  }
}

export type CodegenResult = {
  render: string,
  staticRenderFns: Array<string>
};

export function generate (
  ast: ASTElement | void,
  options: CompilerOptions
): CodegenResult {
  const state = new CodegenState(options) // 初始状态
  const code = ast ? genElement(ast, state) : '_c("div")' // 根据语法树生成新的代码,code内部就是_c函数，没有ast语法树就生成空的div
  return {
    render: `with(this){return ${code}}`, // 用with包裹code生成render字符串，之后会将render字符串转为render函数
    staticRenderFns: state.staticRenderFns
  }
}

export function genElement (el: ASTElement, state: CodegenState): string {
  if (el.parent) { // 继承parent.pre  v-pre
    el.pre = el.pre || el.parent.pre
  }

  if (el.staticRoot && !el.staticProcessed) { // 生成静态code，静态的渲染函数被保存至state.staticRenderFns属性中，如 <div id="app">123</div>
    return genStatic(el, state)
  } else if (el.once && !el.onceProcessed) { // v-once
    return genOnce(el, state)
  } else if (el.for && !el.forProcessed) { // v-for 优先级高于 v-if
    return genFor(el, state)
  } else if (el.if && !el.ifProcessed) { // v-if
    return genIf(el, state)
  } else if (el.tag === 'template' && !el.slotTarget && !state.pre) { // vue文件最外层的template，非插槽template，在这里去除vue文件外面包裹的template标签
    return genChildren(el, state) || 'void 0' // 递归children
  } else if (el.tag === 'slot') { // slot
    return genSlot(el, state)
  } else {
    // component or element
    let code
    if (el.component) { // component
      code = genComponent(el.component, el, state)
    } else { // 普通dom元素
      let data
      if (!el.plain || (el.pre && state.maybeComponent(el))) {
        data = genData(el, state)
      }

      const children = el.inlineTemplate ? null : genChildren(el, state, true)
      code = `_c('${el.tag}'${ // 字符串拼接 _c('div', {a: 'xxx', b: 'xxx'}, {'div', {a: 'childxxx'}, {}})
        data ? `,${data}` : '' // data
      }${
        children ? `,${children}` : '' // children
      })`
    }
    // module transforms
    for (let i = 0; i < state.transforms.length; i++) {
      code = state.transforms[i](el, code)
    }
    return code
  }
}

// hoist static sub-trees out
function genStatic (el: ASTElement, state: CodegenState): string {
  el.staticProcessed = true // 标记已经genStatic
  // Some elements (templates) need to behave differently inside of a v-pre
  // node.  All pre nodes are static roots, so we can use this as a location to
  // wrap a state change and reset it upon exiting the pre node.
  // 根据当前el的pre标记生成staticRenderFn存入state.staticRenderFns，最后将state.pre还原为之前的值
  // 生成_m()代码  _m是src/core/instance/render-helpers/render-static.js中的renderStatic方法
  const originalPreState = state.pre
  if (el.pre) { // v-pre
    state.pre = el.pre
  }
  state.staticRenderFns.push(`with(this){return ${genElement(el, state)}}`)
  state.pre = originalPreState
  return `_m(${
    state.staticRenderFns.length - 1
  }${
    el.staticInFor ? ',true' : ''
  })`
}

// v-once
function genOnce (el: ASTElement, state: CodegenState): string {
  el.onceProcessed = true // 标记已经genOnce
  if (el.if && !el.ifProcessed) {
    // 同时有v-if，走genIf逻辑
    return genIf(el, state)
  } else if (el.staticInFor) {
    // 在v-for内部，找到对应的key，生成_o()代码
    // _o是src/core/instance/render-helpers/render-static.js中的markOnce方法
    let key = ''
    let parent = el.parent
    while (parent) {
      if (parent.for) {
        key = parent.key
        break
      }
      parent = parent.parent
    }
    // v-once只能被用在带有key的v-for内部
    if (!key) {
      process.env.NODE_ENV !== 'production' && state.warn(
        `v-once can only be used inside v-for that is keyed. `,
        el.rawAttrsMap['v-once']
      )
      return genElement(el, state)
    }
    return `_o(${genElement(el, state)},${state.onceId++},${key})`
  } else {
    // 不是v-if 也不在v-for内部，就是静态节点，走genStatic逻辑
    return genStatic(el, state)
  }
}

export function genIf (
  el: any,
  state: CodegenState,
  altGen?: Function,
  altEmpty?: string
): string {
  el.ifProcessed = true // avoid recursion // 标记已经genIf
  return genIfConditions(el.ifConditions.slice(), state, altGen, altEmpty)
}

function genIfConditions (
  conditions: ASTIfConditions,
  state: CodegenState,
  altGen?: Function,
  altEmpty?: string
): string {
  if (!conditions.length) { // 没有conditions，_e创建空节点
    return altEmpty || '_e()'
  }

  const condition = conditions.shift() // 依次v-if v-else-if v-else
  if (condition.exp) { // v-if v-else-if
    return `(${condition.exp})?${ // 条件成立，生成render代码
      genTernaryExp(condition.block)
    }:${ // 条件不成立，继续向下判断
      genIfConditions(conditions, state, altGen, altEmpty)
    }`
  } else { // v-else
    return `${genTernaryExp(condition.block)}`
  }

  // v-if with v-once should generate code like (a)?_m(0):_m(1)
  function genTernaryExp (el) {
    return altGen
      ? altGen(el, state)
      : el.once
        ? genOnce(el, state) // 走genOnce逻辑渲染成静态节点
        : genElement(el, state)
  }
}

export function genFor (
  el: any,
  state: CodegenState,
  altGen?: Function,
  altHelper?: string
): string {
  const exp = el.for // v-for后面的list
  const alias = el.alias // item
  const iterator1 = el.iterator1 ? `,${el.iterator1}` : '' // index/key
  const iterator2 = el.iterator2 ? `,${el.iterator2}` : '' // object中key对应的index

  // v-for没有key，报错
  if (process.env.NODE_ENV !== 'production' &&
    state.maybeComponent(el) &&
    el.tag !== 'slot' &&
    el.tag !== 'template' &&
    !el.key
  ) {
    state.warn(
      `<${el.tag} v-for="${alias} in ${exp}">: component lists rendered with ` +
      `v-for should have explicit keys. ` +
      `See https://vuejs.org/guide/list.html#key for more info.`,
      el.rawAttrsMap['v-for'],
      true /* tip */
    )
  }

  el.forProcessed = true // avoid recursion // 标记已经genFor
  // 生成_l()代码，_l是src/core/instance/render-helpers/render-list.js中的renderList方法
  return `${altHelper || '_l'}((${exp}),` +
    `function(${alias}${iterator1}${iterator2}){` +
      `return ${(altGen || genElement)(el, state)}` +
    '})'
}

// 拼接data
export function genData (el: ASTElement, state: CodegenState): string {
  let data = '{'

  // directives first.
  // directives may mutate the el's other properties before they are generated.
  // 首先是指令，可以改变其他属性值
  const dirs = genDirectives(el, state)
  if (dirs) data += dirs + ','

  // key
  if (el.key) {
    data += `key:${el.key},`
  }
  // ref
  if (el.ref) {
    data += `ref:${el.ref},`
  }
  // el是否带v-for或者在v-for内部
  if (el.refInFor) {
    data += `refInFor:true,`
  }
  // pre
  if (el.pre) {
    data += `pre:true,`
  }
  // record original tag name for components using "is" attribute
  // is
  if (el.component) {
    data += `tag:"${el.tag}",`
  }
  // module data generation functions
  // staticClass class staticStyle style
  for (let i = 0; i < state.dataGenFns.length; i++) {
    data += state.dataGenFns[i](el)
  }
  // attributes
  if (el.attrs) {
    data += `attrs:${genProps(el.attrs)},`
  }
  // DOM props
  if (el.props) {
    data += `domProps:${genProps(el.props)},`
  }
  // event handlers // 处理.修饰符，拼接出完整的事件函数
  // $on事件
  if (el.events) {
    data += `${genHandlers(el.events, false)},`
  }
  // dom原生事件
  if (el.nativeEvents) {
    data += `${genHandlers(el.nativeEvents, true)},`
  }
  // slot target
  // only for non-scoped slots
  // 非作用域插槽，不带props
  // <test-component slot="hello">{{ item }}</test-component>
  // [_c('test-component', {
  //   attrs: {
  //     "slot": "hello"
  //   },
  //   slot: "hello"
  // }, [_v(_s(item))])]
  if (el.slotTarget && !el.slotScope) {
    data += `slot:${el.slotTarget},`
  }
  // scoped slots
  // 作用域插槽，带props
  // scope语法 slot-scope语法 v-slot语法(官方已废弃前两种，均有一定的问题)
  // <test-component slot="hello" slot-scope="props">{{ item }}</test-component>
  // scopedSlots: _u([{
  //   key: "hello",
  //   fn: function (props) {
  //     return _c('test-component', {}, [_v(_s(item))])
  //   }
  // }], null, true)
  if (el.scopedSlots) {
    data += `${genScopedSlots(el, el.scopedSlots, state)},`
  }
  // component v-model
  // <test-component v-model="name">{{ item }}</test-component>
  // {
  //   model: {
  //     value: (name),
  //     callback: function ($$v) {
  //       name = $$v
  //     },
  //     expression: "name"
  // }
  if (el.model) {
    data += `model:{value:${
      el.model.value
    },callback:${
      el.model.callback
    },expression:${
      el.model.expression
    }},`
  }
  // inline-template
  if (el.inlineTemplate) {
    const inlineTemplate = genInlineTemplate(el, state)
    if (inlineTemplate) {
      data += `${inlineTemplate},`
    }
  }
  // 拼接结尾
  data = data.replace(/,$/, '') + '}'
  // v-bind dynamic argument wrap
  // v-bind with dynamic arguments must be applied using the same v-bind object
  // merge helper so that class/style/mustUseProp attrs are handled correctly.
  // _b是src/code/instance/render-helpers/bind-object-props中的bindObjectProps方法
  if (el.dynamicAttrs) {
    data = `_b(${data},"${el.tag}",${genProps(el.dynamicAttrs)})`
  }
  // v-bind data wrap
  // 包裹_b
  // _b是src/code/instance/render-helpers/bind-object-props中的bindObjectProps方法
  // data中存放的是v-bind对应的变量，这里将变量对应的值替换到data中，完成修正
  if (el.wrapData) {
    data = el.wrapData(data)
  }
  // v-on data wrap
  // 包裹_g
  // _g是src/code/instance/render-helpers/bind-object-listeners中的bindObjectListeners方法
  // 判断dir.value是否是对象，并且为数据 data.on 合并data和value 的on 事件
  if (el.wrapListeners) {
    data = el.wrapListeners(data)
  }
  return data
}

// 拼接指令
// v-demo:foo.a.b="message"
// directives: [{
//   name: "demo",
//   rawName: "v-demo:foo.a.b",
//   value: (message), // message指向的值
//   expression: "message",
//   arg: "foo",
//   modifiers: {
//     "a": true,
//     "b": true
//   }
// }
function genDirectives (el: ASTElement, state: CodegenState): string | void {
  const dirs = el.directives
  if (!dirs) return
  let res = 'directives:['
  let hasRuntime = false
  let i, l, dir, needRuntime
  for (i = 0, l = dirs.length; i < l; i++) {
    dir = dirs[i]
    needRuntime = true
    const gen: DirectiveFunction = state.directives[dir.name]
    if (gen) {
      // compile-time directive that manipulates AST.
      // returns true if it also needs a runtime counterpart.
      needRuntime = !!gen(el, dir, state.warn)
    }
    if (needRuntime) {
      hasRuntime = true
      res += `{name:"${dir.name}",rawName:"${dir.rawName}"${
        dir.value ? `,value:(${dir.value}),expression:${JSON.stringify(dir.value)}` : ''
      }${
        dir.arg ? `,arg:${dir.isDynamicArg ? dir.arg : `"${dir.arg}"`}` : ''
      }${
        dir.modifiers ? `,modifiers:${JSON.stringify(dir.modifiers)}` : ''
      }},`
    }
  }
  if (hasRuntime) {
    return res.slice(0, -1) + ']'
  }
}

// 处理inline-template
// 组件将会使用其里面的内容作为模板
function genInlineTemplate (el: ASTElement, state: CodegenState): ?string {
  const ast = el.children[0]
  if (process.env.NODE_ENV !== 'production' && (
    el.children.length !== 1 || ast.type !== 1
  )) {
    state.warn(
      'Inline-template components must have exactly one child element.',
      { start: el.start }
    )
  }
  if (ast && ast.type === 1) {
    const inlineRenderFns = generate(ast, state.options)
    return `inlineTemplate:{render:function(){${
      inlineRenderFns.render
    }},staticRenderFns:[${
      inlineRenderFns.staticRenderFns.map(code => `function(){${code}}`).join(',')
    }]}`
  }
}

function genScopedSlots (
  el: ASTElement,
  slots: { [key: string]: ASTElement },
  state: CodegenState
): string {
  // by default scoped slots are considered "stable", this allows child
  // components with only scoped slots to skip forced updates from parent.
  // but in some cases we have to bail-out of this optimization
  // for example if the slot contains dynamic names, has v-if or v-for on them...
  // 是否需要强制更新
  let needsForceUpdate = el.for || Object.keys(slots).some(key => {
    const slot = slots[key]
    return (
      slot.slotTargetDynamic ||
      slot.if ||
      slot.for ||
      containsSlotChild(slot) // is passing down slot from parent which may be dynamic
    )
  })

  // #9534: if a component with scoped slots is inside a conditional branch,
  // it's possible for the same component to be reused but with different
  // compiled slot content. To avoid that, we generate a unique key based on
  // the generated code of all the slot contents.
  let needsKey = !!el.if

  // OR when it is inside another scoped slot or v-for (the reactivity may be
  // disconnected due to the intermediate scope variable)
  // #9438, #9506
  // TODO: this can be further optimized by properly analyzing in-scope bindings
  // and skip force updating ones that do not actually use scope variables.
  // 如果有父节点是作用域插槽，或是带v-for，设置为需要强制更新
  // 如果有父节点带v-if，needsKey设置为true
  if (!needsForceUpdate) {
    let parent = el.parent
    while (parent) {
      if (
        (parent.slotScope && parent.slotScope !== emptySlotScopeToken) ||
        parent.for
      ) {
        needsForceUpdate = true
        break
      }
      if (parent.if) {
        needsKey = true
      }
      parent = parent.parent
    }
  }

  const generatedSlots = Object.keys(slots)
    .map(key => genScopedSlot(slots[key], state))
    .join(',')

  // <test-component slot="hello" slot-scope="props">{{ item }}</test-component>
  // 需要强制更新
  // scopedSlots: _u([{
  //   key: "hello",
  //   fn: function (props) {
  //     return _c('test-component', {}, [_v(_s(item))])
  //   }
  // }], null, true)
  // 不需要强制更新
  // scopedSlots: _u([{
  //   key: "hello",
  //   fn: function (props) {
  //     return _c('test-component', {}, [_v(_s(item))])
  //   }
  // }])
  return `scopedSlots:_u([${generatedSlots}]${
    needsForceUpdate ? `,null,true` : ``
  }${
    !needsForceUpdate && needsKey ? `,null,false,${hash(generatedSlots)}` : ``
  })`
}

function hash(str) {
  let hash = 5381
  let i = str.length
  while(i) {
    hash = (hash * 33) ^ str.charCodeAt(--i)
  }
  return hash >>> 0
}

// el或其子组件是slot标签
function containsSlotChild (el: ASTNode): boolean {
  if (el.type === 1) {
    if (el.tag === 'slot') {
      return true
    }
    return el.children.some(containsSlotChild)
  }
  return false
}

// 生成作用域插槽code
// 在这里的el都是存放在ScopedSlots中的，所以是没有走genElement逻辑的，也就是没有走过v-if v-for逻辑
// scope语法和slot-scope语法均有一定的问题，所以官方已经废弃
// v-slot语法逻辑
//   1. template上的v-slot => template不能带v-for(准确来说是不能带key，可以强行带没有key的v-for，这点与scope语法一致)，
//                            v-if逻辑会在这里执行，通过genIf逻辑编译出完整的if代码
//   2. 组件上的v-slot => 由于组件内部会创建一个template元素存放在组件el.scopedSlots[name]上，
//                        所以组件会走genElement逻辑，到这里的forProcessed和ifProcessed已经是true了，不会重复执行
function genScopedSlot (
  el: ASTElement, // ScopedSlots中的每一个slot
  state: CodegenState
): string {
  const isLegacySyntax = el.attrsMap['slot-scope'] // 是否是被废弃的语法slot-scope
  // 新语法v-slot先走v-if，因为带v-slot的template不能带v-for，带v-slot的组件会生成scopedSlots属性存放插槽(也就是会在一开始就走genElement逻辑)
  // 所以，走这个v-if的，要么是不能带v-for的，要么是已经走完v-for逻辑的，依旧是v-for优先级高于v-if
  // scope语法也先走v-if，然后再走下面的v-for，所以只有这里v-if优先级高于v-for
  // 但是scope语法只能用于template，而template不支持key属性，也就不会用v-for(但是如果强行用不带key的v-for，可以编译出来，且不会报错，这个问题在template上的v-slot语法上同样存在)
  // template一般不用v-for，所以也没有做处理，官方废弃scope的原因应该是scope只适用于template标签
  if (el.if && !el.ifProcessed && !isLegacySyntax) {
    return genIf(el, state, genScopedSlot, `null`)
  }
  // 这里走v-for的，只有老语法的情况
  if (el.for && !el.forProcessed) {
    return genFor(el, state, genScopedSlot)
  }
  const slotScope = el.slotScope === emptySlotScopeToken // props
    ? ``
    : String(el.slotScope)
  const fn = `function(${slotScope}){` +
    `return ${el.tag === 'template' // scope语法 template上的slot-scope语法 template上的v-slot语法
      ? el.if && isLegacySyntax //  template上的slot-scope语法的v-if在这里拼接，此时v-for已经走完，依旧是v-for优先级高于v-if
        // template上的slot-scope语法只处理v-if，不处理v-else-if和v-else(这两个会直接被忽略)
        // 可能是slot-scope是官方废弃的语法，所以这点上并没有做过多的处理(这里应该算是个bug)
        ? `(${el.if})?${genChildren(el, state) || 'undefined'}:undefined`
        // template上的v-slot语法
        : genChildren(el, state) || 'undefined'
      : genElement(el, state) // 非template上的slot-scope语法 组件上的v-slot语法
    }}`
  // reverse proxy v-slot without scope on this.$slots
  const reverseProxy = slotScope ? `` : `,proxy:true`
  return `{key:${el.slotTarget || `"default"`},fn:${fn}${reverseProxy}}`
}

// 递归children
export function genChildren (
  el: ASTElement,
  state: CodegenState,
  checkSkip?: boolean,
  altGenElement?: Function,
  altGenNode?: Function
): string | void {
  const children = el.children
  if (children.length) {
    const el: any = children[0]
    // optimize single v-for // 优化单个v-for
    if (children.length === 1 &&
      el.for &&
      el.tag !== 'template' &&
      el.tag !== 'slot'
    ) {
      const normalizationType = checkSkip
        ? state.maybeComponent(el) ? `,1` : `,0`
        : ``
      return `${(altGenElement || genElement)(el, state)}${normalizationType}`
    }
    const normalizationType = checkSkip
      ? getNormalizationType(children, state.maybeComponent)
      : 0
    const gen = altGenNode || genNode
    return `[${children.map(c => gen(c, state)).join(',')}]${
      normalizationType ? `,${normalizationType}` : ''
    }`
  }
}

// determine the normalization needed for the children array.
// 0: no normalization needed
// 1: simple normalization needed (possible 1-level deep nested array)
// 2: full normalization needed
function getNormalizationType (
  children: Array<ASTNode>,
  maybeComponent: (el: ASTElement) => boolean
): number {
  let res = 0
  for (let i = 0; i < children.length; i++) {
    const el: ASTNode = children[i]
    if (el.type !== 1) {
      continue
    }
    if (needsNormalization(el) ||
        (el.ifConditions && el.ifConditions.some(c => needsNormalization(c.block)))) {
      res = 2
      break
    }
    if (maybeComponent(el) ||
        (el.ifConditions && el.ifConditions.some(c => maybeComponent(c.block)))) {
      res = 1
    }
  }
  return res
}

function needsNormalization (el: ASTElement): boolean {
  return el.for !== undefined || el.tag === 'template' || el.tag === 'slot'
}

function genNode (node: ASTNode, state: CodegenState): string {
  if (node.type === 1) { // 元素节点
    return genElement(node, state)
  } else if (node.type === 3 && node.isComment) { // 注释节点
    return genComment(node)
  } else { // 文本节点
    return genText(node)
  }
}

// 文本节点
export function genText (text: ASTText | ASTExpression): string {
  return `_v(${text.type === 2
    ? text.expression // no need for () because already wrapped in _s()
    : transformSpecialNewlines(JSON.stringify(text.text))
  })`
}

// 注释节点
export function genComment (comment: ASTText): string {
  return `_e(${JSON.stringify(comment.text)})`
}

// slot
function genSlot (el: ASTElement, state: CodegenState): string {
  const slotName = el.slotName || '"default"'
  const children = genChildren(el, state)
  let res = `_t(${slotName}${children ? `,${children}` : ''}`
  // 合并staticProps和dynamicProps
  const attrs = el.attrs || el.dynamicAttrs
    ? genProps((el.attrs || []).concat(el.dynamicAttrs || []).map(attr => ({
        // slot props are camelized
        name: camelize(attr.name), // 驼峰
        value: attr.value,
        dynamic: attr.dynamic
      })))
    : null
  // v-bind="xxx"
  // bind = "xxx"
  const bind = el.attrsMap['v-bind']
  // 没有children，用null代替
  if ((attrs || bind) && !children) {
    res += `,null`
  }
  // 添加attrs
  if (attrs) {
    res += `,${attrs}`
  }
  if (bind) {
    res += `${attrs ? '' : ',null'},${bind}`
  }
  return res + ')'
}

// componentName is el.component, take it as argument to shun flow's pessimistic refinement
function genComponent (
  componentName: string,
  el: ASTElement,
  state: CodegenState
): string {
  // inline-template没有template标签包裹
  const children = el.inlineTemplate ? null : genChildren(el, state, true)
  // _c是src/core/instance/render.js中的createElement
  // _c(name, attrs, children)
  return `_c(${componentName},${genData(el, state)}${
    children ? `,${children}` : ''
  })`
}

// 合并staticProps和dynamicProps
function genProps (props: Array<ASTAttr>): string {
  let staticProps = ``
  let dynamicProps = ``
  for (let i = 0; i < props.length; i++) {
    const prop = props[i]
    const value = __WEEX__
      ? generateValue(prop.value) // 转换成JSON格式
      : transformSpecialNewlines(prop.value) // 转换分隔符
    if (prop.dynamic) {
      dynamicProps += `${prop.name},${value},`
    } else {
      staticProps += `"${prop.name}":${value},`
    }
  }
  staticProps = `{${staticProps.slice(0, -1)}}` // 去掉最后一个,
  if (dynamicProps) {
    // _d是src/core/instance/render-helpers/bind-dynamic-keys.js中的bindDynamicKeys方法
    // 合并staticProps和dynamicProps
    return `_d(${staticProps},[${dynamicProps.slice(0, -1)}])` // 去掉最后一个,
  } else {
    return staticProps
  }
}

/* istanbul ignore next */
// 转换成JSON格式
function generateValue (value) {
  if (typeof value === 'string') {
    return transformSpecialNewlines(value)
  }
  return JSON.stringify(value)
}

// #3895, #4268
// 转换分隔符
function transformSpecialNewlines (text: string): string {
  return text
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
