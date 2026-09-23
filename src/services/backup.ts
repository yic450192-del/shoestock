/**
 * 数据导出与恢复
 *
 * 为什么这个 app 必须有备份：数据只存在手机本地 SQLite 里，没有服务端。
 * 手机丢了、摔坏了、清了应用数据 —— 库存账就全没了。
 * 所以导出不是"锦上添花的功能"，是这个离线架构的必要补丁。
 *
 * 【恢复语义：覆盖，不是合并】
 * 导入一份备份 = 用备份里的四张表整体替换当前的四张表。
 * 没有做增量合并，因为库存是"当前快照"，合并两份快照在语义上根本说不通
 * （A 说 42 码剩 3 双，B 说剩 5 双，合并结果是什么？）。
 * 所以导入前 UI 必须警告"当前数据会被完全替换"。
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { transaction } from '@/db/connection'
import { DEFAULT_CATEGORIES } from '@/db/schema'
import * as categoryRepo from '@/db/repositories/categoryRepo'
import * as productRepo from '@/db/repositories/productRepo'
import * as skuRepo from '@/db/repositories/skuRepo'
import * as stockLogRepo from '@/db/repositories/stockLogRepo'
import { formatSize } from '@/types'
import type { Category, Product, Sku, StockLog } from '@/types'

export const BACKUP_FORMAT_VERSION = 1

export interface BackupPayload {
  app: 'shoestock'
  version: number
  exportedAt: number
  categories: Category[]
  products: Product[]
  skus: Sku[]
  stockLogs: StockLog[]
}

export interface BackupSummary {
  categories: number
  products: number
  skus: number
  logs: number
}

/* ---------- 导出 ---------- */

export async function buildPayload(): Promise<BackupPayload> {
  const [categories, products, skus, stockLogs] = await Promise.all([
    categoryRepo.listCategories(),
    productRepo.listAll(),
    skuRepo.listAll(),
    stockLogRepo.listAll(),
  ])
  return {
    app: 'shoestock',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    categories,
    products,
    skus,
    stockLogs,
  }
}

export function summarize(payload: BackupPayload): BackupSummary {
  return {
    categories: payload.categories.length,
    products: payload.products.length,
    skus: payload.skus.length,
    logs: payload.stockLogs.length,
  }
}

function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/**
 * 保存备份到手机。
 * 原生：写进公共「文档」目录，用文件管理器或其他 app 都能看到。
 * 浏览器：走 <a download>，存到下载目录。
 */
export async function saveBackup(): Promise<string> {
  const payload = await buildPayload()
  const fileName = `shoestock-${stamp()}.json`
  await saveText(fileName, JSON.stringify(payload, null, 2), 'application/json')
  return fileName
}

/** 导出一份给 Excel 看的库存表：一行一个 SKU */
export async function saveCsv(): Promise<string> {
  const [products, skus, categories] = await Promise.all([
    productRepo.listAll(),
    skuRepo.listAll(),
    categoryRepo.listCategories(),
  ])
  const productById = new Map(products.map((p) => [p.id, p]))
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const header = ['款名', '分类', '颜色', '码数', '库存', '预警值', '进价(元)', '售价(元)']
  const lines = [header.join(',')]

  for (const sku of skus) {
    const product = productById.get(sku.productId)
    if (!product) continue
    const category = product.categoryId ? categoryById.get(product.categoryId)?.name ?? '' : ''
    lines.push(
      [
        escapeCsv(product.name),
        escapeCsv(category),
        escapeCsv(sku.color),
        formatSize(sku.sizeTenth),
        String(sku.stock),
        String(sku.warnLevel),
        (product.costCents / 100).toFixed(2),
        (product.priceCents / 100).toFixed(2),
      ].join(','),
    )
  }

  const fileName = `shoestock-${stamp()}.csv`
  // Excel 打开 UTF-8 CSV 需要 BOM，否则中文全是乱码
  await saveText(fileName, `﻿${lines.join('\n')}`, 'text/csv')
  return fileName
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

async function saveText(fileName: string, content: string, mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({
      path: fileName,
      data: content,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    })
    return
  }
  // Web 调试通道：浏览器里没有手机文件系统，直接触发下载
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* ---------- 导入 ---------- */

export interface ImportResult {
  ok: boolean
  message: string
  summary?: BackupSummary
}

/**
 * 解析备份文本。
 * 校验放在写库之前 —— 一旦开始 replaceAll 就没有回头路，所以宁可多查几项。
 */
export function parseBackup(text: string): BackupPayload {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('这不是一个合法的 JSON 文件')
  }

  const payload = raw as Partial<BackupPayload>
  if (payload?.app !== 'shoestock') {
    throw new Error('这不是 ShoeStock 导出的备份文件')
  }
  if (typeof payload.version !== 'number' || payload.version > BACKUP_FORMAT_VERSION) {
    throw new Error(`备份版本不兼容：文件是 v${payload.version ?? '未知'}，当前支持 v${BACKUP_FORMAT_VERSION}`)
  }
  for (const key of ['categories', 'products', 'skus', 'stockLogs'] as const) {
    if (!Array.isArray(payload[key])) {
      throw new Error(`备份文件缺少 ${key} 数据`)
    }
  }
  return payload as BackupPayload
}

/**
 * 用备份覆盖当前库。
 * 整段在事务里 —— 中途任何一条失败就整体回滚，不会留下"删了一半"的库。
 */
export async function restoreBackup(payload: BackupPayload): Promise<BackupSummary> {
  await transaction(async () => {
    // 顺序不能反：先删引用别人的（流水、SKU），再删被引用的（款、分类）
    await stockLogRepo.replaceAll([])
    await skuRepo.replaceAll([])
    await productRepo.replaceAll([])
    await categoryRepo.replaceAll([])

    await categoryRepo.replaceAll(payload.categories)
    await productRepo.replaceAll(payload.products)
    await skuRepo.replaceAll(payload.skus)
    await stockLogRepo.replaceAll(payload.stockLogs)
  })

  return summarize(payload)
}

/**
 * 清空全部业务数据。危险操作，UI 必须二次确认后才准调。
 * 分类清空后会把预置分类写回去 —— 否则清完一次，录入页连分类都没得选。
 */
export async function wipeAll(): Promise<void> {
  await transaction(async () => {
    await stockLogRepo.replaceAll([])
    await skuRepo.replaceAll([])
    await productRepo.replaceAll([])
    await categoryRepo.replaceAll([])
    for (const name of DEFAULT_CATEGORIES) {
      await categoryRepo.createCategory(name)
    }
  })
}
