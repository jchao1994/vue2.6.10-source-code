import directives from './directives'
import ref from './ref'

export default [
  ref, // 操作vm.$refs的方法 create update destroy
  directives // 操作指令directives的方法 create update destroy
]
