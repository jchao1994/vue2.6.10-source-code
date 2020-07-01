/* @flow */

import { baseOptions } from './options'
import { createCompiler } from 'compiler/index'

// compile 是生成编译后代码的函数
// compileToFunctions 
const { compile, compileToFunctions } = createCompiler(baseOptions)

export { compile, compileToFunctions }
