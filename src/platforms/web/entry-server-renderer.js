/* @flow */
// SSR入口

process.env.VUE_ENV = 'server'

import { extend } from 'shared/util'
import modules from './server/modules/index'
import baseDirectives from './server/directives/index'
import { isUnaryTag, canBeLeftOpenTag } from './compiler/util'

import { createRenderer as _createRenderer } from 'server/create-renderer'
import { createBundleRendererCreator } from 'server/bundle-renderer/create-bundle-renderer'

export function createRenderer (options?: Object = {}): {
  renderToString: Function,
  renderToStream: Function
} {
  return _createRenderer(extend(extend({}, options), {
    isUnaryTag, // 是否是单标签
    canBeLeftOpenTag, // ???
    modules, // 拼接attrs props class style放入起始标签的方法
    // user can provide server-side implementations for custom directives
    // when creating the renderer.
    directives: extend(baseDirectives, options.directives) // v-show v-model 以及 自定义指令
  }))
}

export const createBundleRenderer = createBundleRendererCreator(createRenderer)
