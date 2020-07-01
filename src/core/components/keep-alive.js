/* @flow */

import { isRegExp, remove } from 'shared/util'
import { getFirstComponentChild } from 'core/vdom/helpers/index'

type VNodeCache = { [key: string]: ?VNode };

function getComponentName (opts: ?VNodeComponentOptions): ?string {
  return opts && (opts.Ctor.options.name || opts.tag)
}

function matches (pattern: string | RegExp | Array<string>, name: string): boolean { // pattern是否包含name
  // pattern 新的include exclude
  // name 老的cache中的组件name
  if (Array.isArray(pattern)) {
    return pattern.indexOf(name) > -1
  } else if (typeof pattern === 'string') {
    return pattern.split(',').indexOf(name) > -1
  } else if (isRegExp(pattern)) {
    return pattern.test(name)
  }
  /* istanbul ignore next */
  return false
}

function pruneCache (keepAliveInstance: any, filter: Function) {
  const { cache, keys, _vnode } = keepAliveInstance // 老的
  for (const key in cache) {
    const cachedNode: ?VNode = cache[key]
    if (cachedNode) {
      const name: ?string = getComponentName(cachedNode.componentOptions) // 老的cache中的组件name
      if (name && !filter(name)) {
        // 找到老的cache中不包含在新的include中的组件，从缓存组件中移除
        // 找到老的cache中包含在新的exclude中的组件，从缓存组件中移除
        pruneCacheEntry(cache, key, keys, _vnode)
      }
    }
  }
}

function pruneCacheEntry (
  cache: VNodeCache,
  key: string,
  keys: Array<string>,
  current?: VNode
) {
  const cached = cache[key]
  if (cached && (!current || cached.tag !== current.tag)) {
    cached.componentInstance.$destroy() // 调用缓存组件实例的$destroy
  }
  cache[key] = null // 从cache中移除
  remove(keys, key) // 从keys中移除
}

const patternTypes: Array<Function> = [String, RegExp, Array]

export default {
  name: 'keep-alive',
  abstract: true, // 抽象组件

  props: {
    include: patternTypes, // 字符串或正则表达式，只有名称匹配的组件会被缓存
    exclude: patternTypes, // 字符串或正则表达式，任何名称匹配的组件都不会被缓存
    max: [String, Number] // 最多可以缓存的组件实例数量
  },

  created () {
    this.cache = Object.create(null) // 创建缓存列表
    this.keys = [] // 创建缓存组件的key列表
  },

  destroyed () { // 当keep-alive销毁时，清空缓存和key，调用缓存的组件实例对应的$destroy
    for (const key in this.cache) {
      pruneCacheEntry(this.cache, key, this.keys)
    }
  },

  mounted () { // 监控include和exclude，发生改变时修改缓存组件（只移除缓存，不添加）
    this.$watch('include', val => {  // val是新的include
      pruneCache(this, name => matches(val, name))
    })
    this.$watch('exclude', val => { // val是新的exclude
      pruneCache(this, name => !matches(val, name))
    })
  },

  render () {
    const slot = this.$slots.default // 拿到默认插槽
    const vnode: VNode = getFirstComponentChild(slot) // 只缓存第一个组件
    const componentOptions: ?VNodeComponentOptions = vnode && vnode.componentOptions
    if (componentOptions) {
      // check pattern
      const name: ?string = getComponentName(componentOptions) // 取出组件的name
      const { include, exclude } = this
      if ( // include中没有name，或者exclude中有name  不需要缓存
        // not included
        (include && (!name || !matches(include, name))) ||
        // excluded
        (exclude && name && matches(exclude, name))
      ) {
        return vnode
      }

      // 需要缓存的情况
      const { cache, keys } = this
      const key: ?string = vnode.key == null // 如果组件没key，就自己通过组件构造器的cid和组件的tag标签拼接一个key
        // same constructor may get registered as different local components
        // so cid alone is not enough (#3269)
        ? componentOptions.Ctor.cid + (componentOptions.tag ? `::${componentOptions.tag}` : '')
        : vnode.key
      if (cache[key]) { // 如果有缓存
        vnode.componentInstance = cache[key].componentInstance
        // make current key freshest
        // LRU算法 最近最久未使用法  一旦使用，将keys中原有的删除，添加到keys最后
        remove(keys, key)
        keys.push(key)
      } else { // 没有缓存
        cache[key] = vnode
        keys.push(key)
        // prune oldest entry // 缓存数量超限，删除缓存中的第一个组件(也就是最长时间不用的那个组件)
        if (this.max && keys.length > parseInt(this.max)) {
          pruneCacheEntry(cache, keys[0], keys, this._vnode)
        }
      }

      vnode.data.keepAlive = true // 标记keep-alive内部的组件是缓存组件
    }
    return vnode || (slot && slot[0])
  }
}
