/* @flow */

import RenderStream from './render-stream'
import { createWriteFunction } from './write'
import { createRenderFunction } from './render'
import { createPromiseCallback } from './util'
import TemplateRenderer from './template-renderer/index'
import type { ClientManifest } from './template-renderer/index'

export type Renderer = {
  renderToString: (component: Component, context: any, cb: any) => ?Promise<string>;
  renderToStream: (component: Component, context?: Object) => stream$Readable;
};

type RenderCache = {
  get: (key: string, cb?: Function) => string | void;
  set: (key: string, val: string) => void;
  has?: (key: string, cb?: Function) => boolean | void;
};

export type RenderOptions = {
  modules?: Array<(vnode: VNode) => ?string>;
  directives?: Object;
  isUnaryTag?: Function;
  cache?: RenderCache;
  template?: string | (content: string, context: any) => string;
  inject?: boolean;
  basedir?: string;
  shouldPreload?: Function;
  shouldPrefetch?: Function;
  clientManifest?: ClientManifest;
  serializer?: Function;
  runInNewContext?: boolean | 'once';
};


// const renderer = require('vue-server-renderer').createRenderer({ template: 'xxx' })
// const renderer = require('vue-server-renderer').createRenderer()
// createRenderer可以不传template，如果传入template，那么template中必须要有占位符(默认是<!--vue-ssr-outlet-->)
export function createRenderer ({
  modules = [],
  directives = {},
  isUnaryTag = (() => false),
  template,
  inject,
  cache,
  shouldPreload,
  shouldPrefetch,
  clientManifest,
  serializer
}: RenderOptions = {}): Renderer {
  const render = createRenderFunction(modules, directives, isUnaryTag, cache)
  const templateRenderer = new TemplateRenderer({ // 负责将占位符替换为html
    template,
    inject,
    shouldPreload,
    shouldPrefetch,
    clientManifest,
    serializer
  })

  return {
    renderToString (
      component: Component, // new Vue()
      context: any,
      cb: any
    ): ?Promise<string> {
      // renderToString(app, context, (err, html) => {})
      // renderToString(app, (err, html) => {})
      // 将(err, html) => {}回调统一至cb
      if (typeof context === 'function') {
        cb = context
        context = {}
      }
      // 绑定renderResourceHints renderState renderScripts renderStyles getPreloadFiles的context
      if (context) {
        templateRenderer.bindRenderFns(context)
      }

      // no callback, return Promise
      // renderToString(app).then(html => {}).catch(err => {})
      // 等同于renderToString(app, (err, html) => {})
      let promise
      if (!cb) {
        ({ promise, cb } = createPromiseCallback())
      }

      let result = ''
      const write = createWriteFunction(text => {
        result += text
        return false
      }, cb)
      try {
        render(component, write, context, err => {
          // render-context.js中的done函数
          // 不断next清空renderStates之后会执行这个回调(不传递参数)，最后执行cb回调传出完整的html，返回给服务端
          if (err) {
            return cb(err)
          }
          if (context && context.rendered) {
            context.rendered(context)
          }
          if (template) {
            // 传入template(index.html)，必须带占位符contentPlaceholder(默认是<!--vue-ssr-outlet-->)
            // 返回完整的html(index.html)，包括<!DOCTYPE html>、html标签、head标签、body标签等(由index.html决定)
            try {
              const res = templateRenderer.render(result, context) // 替换占位符contentPlaceholder(默认是<!--vue-ssr-outlet-->)
              if (typeof res !== 'string') { // promise
                // function template returning promise
                res
                  .then(html => cb(null, html))
                  .catch(cb)
              } else { // html str
                cb(null, res)
              }
            } catch (e) {
              cb(e)
            }
          } else {
            // 不传template，直接返回不完整的html，只有<div id="app" data-server-rendered="true">...</div>，可在外部拼接成完整的html
            // 如果直接将这个html返回给浏览器，整个html只有html标签、head标签、body标签，其中服务端返回的HTML放在body标签中，没有其他任何内容
            // <html><head></head><body><div id="app" data-server-rendered="true">...</div></body></html>
            cb(null, result)
          }
        })
      } catch (e) {
        cb(e)
      }

      return promise
    },

    renderToStream (
      component: Component,
      context?: Object
    ): stream$Readable {
      if (context) {
        templateRenderer.bindRenderFns(context)
      }
      const renderStream = new RenderStream((write, done) => {
        render(component, write, context, done)
      })
      if (!template) {
        if (context && context.rendered) {
          const rendered = context.rendered
          renderStream.once('beforeEnd', () => {
            rendered(context)
          })
        }
        return renderStream
      } else if (typeof template === 'function') {
        throw new Error(`function template is only supported in renderToString.`)
      } else {
        const templateStream = templateRenderer.createStream(context)
        renderStream.on('error', err => {
          templateStream.emit('error', err)
        })
        renderStream.pipe(templateStream)
        if (context && context.rendered) {
          const rendered = context.rendered
          renderStream.once('beforeEnd', () => {
            rendered(context)
          })
        }
        return templateStream
      }
    }
  }
}
