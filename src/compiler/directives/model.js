/* @flow */

/**
 * Cross-platform code generation for component v-model
 */
export function genComponentModel (
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
): ?boolean {
  const { number, trim } = modifiers || {}

  const baseValueExpression = '$$v'
  let valueExpression = baseValueExpression
  if (trim) {
    valueExpression =
      `(typeof ${baseValueExpression} === 'string'` +
      `? ${baseValueExpression}.trim()` +
      `: ${baseValueExpression})`
  }
  if (number) {
    valueExpression = `_n(${valueExpression})`
  }
  const assignment = genAssignmentCode(value, valueExpression)

  el.model = {
    value: `(${value})`,
    expression: JSON.stringify(value),
    callback: `function (${baseValueExpression}) {${assignment}}`
  }
}

/**
 * Cross-platform codegen helper for generating v-model value assignment code.
 */
export function genAssignmentCode (
  value: string,
  assignment: string
): string {
  const res = parseModel(value) // 解析标签属性值value
  if (res.key === null) { // value是不带[]和.的纯字符串
    // key = value
    return `${value}=${assignment}`
  } else {
    // $set(target, key, value)
    return `$set(${res.exp}, ${res.key}, ${assignment})`
  }
}

/**
 * Parse a v-model expression into a base path and a final key segment.
 * Handles both dot-path and possible square brackets.
 *
 * Possible cases:
 *
 * - test
 * - test[key]
 * - test[test1[key]]
 * - test["a"][key]
 * - xxx.test[a[a].test1[key]]
 * - test.xxx.a["asa"][test1[key]]
 *
 */

// expressionPos 最后一个最外层[的index
// expressionEndPos 最后一个最外层]的index
let len, str, chr, index, expressionPos, expressionEndPos

type ModelParseResult = {
  exp: string,
  key: string | null
}

// 解析属性值
// * - test => {exp: 'test', key: null}
// * - test[key] => {exp: 'test', key: 'key'}
// * - test[test1[key]] => {exp: 'test', key: 'test1[key]'}
// * - test["a"][key] => {exp: 'test["a"]', key: 'key'}
// * - xxx.test[a[a].test1[key]] => {exp: 'xxx.test', key: 'a[a].test1[key]'}
// * - test.xxx.a["asa"][test1[key]] => {exp: 'test.xxx.a["asa"]', key: 'test1[key]'}
export function parseModel (val: string): ModelParseResult {
  // Fix https://github.com/vuejs/vue/pull/7730
  // allow v-model="obj.val " (trailing whitespace)
  val = val.trim()
  len = val.length

  // val不带[]，或者]不是最后一个字符
  // obj.xxx
  if (val.indexOf('[') < 0 || val.lastIndexOf(']') < len - 1) {
    index = val.lastIndexOf('.')
    if (index > -1) { // val带.
      return {
        exp: val.slice(0, index), // 'obj'
        key: '"' + val.slice(index + 1) + '"' // 'xxx'
      }
    } else { // val不带.
      return {
        exp: val,
        key: null
      }
    }
  }

  // val带[]且]是最后一个字符
  // test.xxx.a["asa"][test1[key]]
  str = val
  index = expressionPos = expressionEndPos = 0

  while (!eof()) { // index < len
    chr = next() // 从index = 1开始
    /* istanbul ignore if */
    if (isStringStart(chr)) { // chr是'或者"，index直接跳到对应的尾引号
      parseString(chr)
    } else if (chr === 0x5B) { // chr是[
      parseBracket(chr) // 找到最外层[]的起始index
    }
  }

  return {
    exp: val.slice(0, expressionPos), // 'test.xxx.a["asa"]'
    key: val.slice(expressionPos + 1, expressionEndPos) // 'test1[key]'
  }
}

function next (): number {
  return str.charCodeAt(++index)
}

// index >= len
function eof (): boolean {
  return index >= len
}

// chr是'或者"，也就是字符串的开始标志
function isStringStart (chr: number): boolean {
  return chr === 0x22 || chr === 0x27
}

// 找到最外层[]的起始index
function parseBracket (chr: number): void {
  let inBracket = 1 // 标记带[]
  expressionPos = index // [的index
  while (!eof()) {
    chr = next()
    if (isStringStart(chr)) { // 跳过整个''或者""
      parseString(chr)
      continue
    }
    if (chr === 0x5B) inBracket++
    if (chr === 0x5D) inBracket--
    if (inBracket === 0) {
      expressionEndPos = index // 最外层的]的index
      break
    }
  }
}

// index直接跳到对应的尾引号
function parseString (chr: number): void {
  const stringQuote = chr // 引号
  while (!eof()) {
    chr = next()
    if (chr === stringQuote) {
      break
    }
  }
}
