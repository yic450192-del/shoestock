/**
 * 领域类型定义
 *
 * 两个贯穿全项目的单位约定，任何地方都不得违反：
 *   - 金额一律用整数「分」：priceCents = 32500 表示 325.00 元
 *   - 鞋码一律用整数「十分之一码」：sizeTenth = 425 表示 42.5 码
 * 原因：鞋码存在半码，用浮点数会出现 42.5 !== 42.5 的比较失败，
 * 导致"改 42.5 码"时匹配不到 SKU。
 */

export interface Category {
  id: number
  name: string
  createdAt: number
}

export interface Product {
  id: number
  categoryId: number | null
  name: string
  /** 别名/拼音/简称，用空格分隔。用于搜索和语音匹配，例如 "af1 kongjun 空军" */
  searchKey: string
  costCents: number
  priceCents: number
  note: string
  createdAt: number
}

export interface Sku {
  id: number
  productId: number
  color: string
  /** 十分之一码：425 -> 42.5 */
  sizeTenth: number
  stock: number
  /** 低于此值视为断码预警 */
  warnLevel: number
  createdAt: number
}

export type StockSource = 'manual' | 'voice' | 'undo'

export interface StockLog {
  id: number
  skuId: number
  /** 变动量，可正可负 */
  delta: number
  source: StockSource
  note: string
  createdAt: number
}

/* ---------- 单位换算工具 ---------- */

/** 425 -> "42.5" */
export function formatSize(sizeTenth: number): string {
  const whole = Math.floor(sizeTenth / 10)
  const half = sizeTenth % 10
  if (half === 0) return String(whole)
  const halfText = half === 5 ? '.5' : `.${half}`
  return `${whole}${halfText}`
}

/** "42.5" -> 425。非法输入返回 null */
export function parseSize(input: string): number | null {
  const n = Number(input.trim())
  if (Number.isNaN(n) || n <= 0) return null
  return Math.round(n * 10)
}

/** 32500 -> "325.00" */
export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** "325.5" -> 32550 */
export function parseMoney(input: string): number | null {
  const n = Number(input.trim())
  if (Number.isNaN(n)) return null
  return Math.round(n * 100)
}
