/* @flow */

import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
import platformModules from 'web/runtime/modules/index'

// the directive module should be applied last, after all
// built-in modules have been applied.
const modules = platformModules.concat(baseModules) // baseModules是封装的操作vm.$refs和directives的方法集合 platformModules = [attrs, klass, events, domProps, style, transition]
// nodeOps是封装的dom原生方法集合
// modules包含ref directives attrs klass events domProps style transition，主要用于创建完成和更新完成后处理对应的模块
//   ref 处理节点上的引用ref
//   directives 处理节点上的指令directives
//   attrs 处理节点上的特性attribute
//   klass 处理节点上的类class
//   events 处理节点上的原生事件
//   domProps 处理节点上的属性property
//   style 处理节点上的内联样式style特性
//   transition 
export const patch: Function = createPatchFunction({ nodeOps, modules })
