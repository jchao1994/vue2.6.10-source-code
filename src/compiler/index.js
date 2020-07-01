/* @flow */

import { parse } from './parser/index'
import { optimize } from './optimizer'
import { generate } from './codegen/index'
import { createCompilerCreator } from './create-compiler'

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.
export const createCompiler = createCompilerCreator(function baseCompile (
  template: string,
  options: CompilerOptions
): CompiledResult {
  const ast = parse(template.trim(), options) // 将模板转化为ast语法树
  if (options.optimize !== false) { // 优化树
    optimize(ast, options)
  }
  const code = generate(ast, options) // 生成树
  return {
    ast,
    render: code.render, // // 根据语法树生成新的代码
    staticRenderFns: code.staticRenderFns
  }
})
