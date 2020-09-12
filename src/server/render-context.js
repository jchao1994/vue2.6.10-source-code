/* @flow */

import { isUndef } from 'shared/util'

type RenderState = {
  type: 'Element';
  rendered: number;
  total: number;
  children: Array<VNode>;
  endTag: string;
} | {
  type: 'Fragment';
  rendered: number;
  total: number;
  children: Array<VNode>;
} | {
  type: 'Component';
  prevActive: Component;
} | {
  type: 'ComponentWithCache';
  buffer: Array<string>;
  bufferIndex: number;
  componentBuffer: Array<Set<Class<Component>>>;
  key: string;
};

export class RenderContext {
  userContext: ?Object;
  activeInstance: Component;
  renderStates: Array<RenderState>;
  write: (text: string, next: Function) => void;
  renderNode: (node: VNode, isRoot: boolean, context: RenderContext) => void;
  next: () => void;
  done: (err: ?Error) => void;

  modules: Array<(node: VNode) => ?string>;
  directives: Object;
  isUnaryTag: (tag: string) => boolean;

  cache: any;
  get: ?(key: string, cb: Function) => void;
  has: ?(key: string, cb: Function) => void;

  constructor (options: Object) {
    this.userContext = options.userContext
    this.activeInstance = options.activeInstance
    this.renderStates = []

    this.write = options.write
    this.done = options.done
    this.renderNode = options.renderNode

    this.isUnaryTag = options.isUnaryTag
    this.modules = options.modules
    this.directives = options.directives

    const cache = options.cache
    if (cache && (!cache.get || !cache.set)) {
      throw new Error('renderer cache must implement at least get & set.')
    }
    this.cache = cache
    this.get = cache && normalizeAsync(cache, 'get')
    this.has = cache && normalizeAsync(cache, 'has')

    this.next = this.next.bind(this)
  }

  // 渲染上下文的next里会调用create-renderer.js中的write，向html str里写入内容
  // 不断next，直到renderStates清空，执行done(create-render.js中的回调函数)
  next () {
    // eslint-disable-next-line
    while (true) {
      // renderStates在render.js中的renderNode中添加
      // renderStates没有数据了，跳出循环，执行done(create-render.js中的回调函数)
      const lastState = this.renderStates[this.renderStates.length - 1]
      if (isUndef(lastState)) {
        return this.done()
      }
      /* eslint-disable no-case-declarations */
      switch (lastState.type) {
        case 'Element':
        case 'Fragment':
          const { children, total } = lastState
          const rendered = lastState.rendered++
          if (rendered < total) { // 逐个渲染子节点
            return this.renderNode(children[rendered], false, this)
          } else { // 子节点渲染完毕，补上结束标签，继续下一个next
            this.renderStates.pop()
            if (lastState.type === 'Element') {
              return this.write(lastState.endTag, this.next) // create-renderer.js中的write，拼接结束标签到result中，再进行下一个next
            }
          }
          break
        case 'Component':
          // 子组件及其子组件完全渲染完毕，将context.activeInstance重新设为当前组件实例，继续循环next
          this.renderStates.pop()
          this.activeInstance = lastState.prevActive // context.activeInstance始终是当前正在渲染的组件实例
          break
        case 'ComponentWithCache':
          this.renderStates.pop()
          const { buffer, bufferIndex, componentBuffer, key } = lastState
          const result = {
            html: buffer[bufferIndex],
            components: componentBuffer[bufferIndex]
          }
          // 缓存自己的结果
          // 子组件缓存自己的结果
          // 父组件缓存自己及其所有子组件的结果
          this.cache.set(key, result)
          if (bufferIndex === 0) { // 缓存根组件，退出缓存模式
            // this is a top-level cached component,
            // exit caching mode.
            this.write.caching = false
          } else { // 非缓存根组件，将缓存结果添加到父组件的结果中
            // parent component is also being cached,
            // merge self into parent's result
            buffer[bufferIndex - 1] += result.html
            const prev = componentBuffer[bufferIndex - 1]
            result.components.forEach(c => prev.add(c))
          }
          buffer.length = bufferIndex
          componentBuffer.length = bufferIndex
          break
      }
    }
  }
}

function normalizeAsync (cache, method) {
  const fn = cache[method]
  if (isUndef(fn)) {
    return
  } else if (fn.length > 1) {
    return (key, cb) => fn.call(cache, key, cb)
  } else {
    return (key, cb) => cb(fn.call(cache, key))
  }
}
