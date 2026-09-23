/**
 * 把 sql.js 的 wasm 复制到 public/assets/
 *
 * @capacitor-community/sqlite 在 Web 平台依赖 jeep-sqlite + sql.js，
 * 它会去 /assets/sql-wasm.wasm 加载这个文件。少了它浏览器调试会直接白屏。
 * 用 postinstall 自动完成，避免手工拷贝。
 */
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const source = resolve(root, 'node_modules/sql.js/dist/sql-wasm.wasm')
const targetDir = resolve(root, 'public/assets')
const target = resolve(targetDir, 'sql-wasm.wasm')

if (!existsSync(source)) {
  console.warn('[shoestock] 跳过 wasm 复制：找不到 sql.js，请先执行 npm install')
  process.exit(0)
}

mkdirSync(targetDir, { recursive: true })
copyFileSync(source, target)
console.log('[shoestock] 已复制 sql-wasm.wasm 到 public/assets/')
