/* @flow */

const MAX_STACK_DEPTH = 800
const noop = _ => _

const defer = typeof process !== 'undefined' && process.nextTick
  ? process.nextTick
  : typeof Promise !== 'undefined'
    ? fn => Promise.resolve().then(fn)
    : typeof setTimeout !== 'undefined'
      ? setTimeout
      : noop

if (defer === noop) {
  throw new Error(
    'Your JavaScript runtime does not support any asynchronous primitives ' +
    'that are required by vue-server-renderer. Please use a polyfill for ' +
    'either Promise or setTimeout.'
  )
}

export function createWriteFunction (
  write: (text: string, next: Function) => boolean,
  onError: Function
): Function {
  let stackDepth = 0
  // create-renderer.js中的write函数
  const cachedWrite = (text, next) => {
    if (text && cachedWrite.caching) {
      cachedWrite.cacheBuffer[cachedWrite.cacheBuffer.length - 1] += text
    }
    const waitForNext = write(text, next) // 拼接text到result中
    if (waitForNext !== true) {
      if (stackDepth >= MAX_STACK_DEPTH) { // 超过最大栈深度800报错
        defer(() => {
          try { next() } catch (e) {
            onError(e)
          }
        })
      } else { // 调用next渲染节点，再调用create-renderer.js中的write，向html str里写入内容
        stackDepth++
        next()
        stackDepth--
      }
    }
  }
  cachedWrite.caching = false
  cachedWrite.cacheBuffer = []
  cachedWrite.componentBuffer = []
  return cachedWrite
}
