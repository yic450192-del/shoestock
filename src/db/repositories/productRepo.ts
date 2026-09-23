/**
 * product 表的数据访问（鞋款）
 * product 只存「款」级别的属性，库存数量在 sku 上。
 */
import { all, get, run } from '../connection'
import type { Product } from '@/types'

export interface CreateProductInput {
  categoryId: number | null
  name: string
  searchKey?: string
  costCents?: number
  priceCents?: number
  note?: string
}

export interface ProductWithStats extends Product {
  /** 该款下所有 SKU 的库存合计 */
  totalStock: number
  /** 有多少个 SKU 处于断码状态（库存 <= 预警值） */
  lowCount: number
}

interface ProductRow {
  id: number
  category_id: number | null
  name: string
  search_key: string
  cost_cents: number
  price_cents: number
  note: string
  created_at: number
  total_stock?: number
  low_count?: number
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    searchKey: row.search_key,
    costCents: row.cost_cents,
    priceCents: row.price_cents,
    note: row.note,
    createdAt: row.created_at,
  }
}

const STATS_SELECT = `
  SELECT p.*,
         COALESCE(SUM(s.stock), 0) AS total_stock,
         COALESCE(SUM(CASE WHEN s.stock <= s.warn_level THEN 1 ELSE 0 END), 0) AS low_count
  FROM product p
  LEFT JOIN sku s ON s.product_id = p.id
`

/**
 * 带统计信息的列表。keyword 同时匹配款名和别名，用于搜索框和语音匹配。
 * 数据量小时用 LIKE 足够；将来换 FTS5 只改这一个函数，UI 不用动。
 */
export async function listProducts(keyword = ''): Promise<ProductWithStats[]> {
  const kw = keyword.trim()
  let sql = `${STATS_SELECT} GROUP BY p.id ORDER BY p.created_at DESC`
  const params: unknown[] = []

  if (kw) {
    sql = `${STATS_SELECT}
           WHERE p.name LIKE ? OR p.search_key LIKE ? OR p.note LIKE ?
           GROUP BY p.id ORDER BY p.created_at DESC`
    const like = `%${kw}%`
    params.push(like, like, like)
  }

  const rows = await all<ProductRow>(sql, params)
  return rows.map((row) => ({
    ...toProduct(row),
    totalStock: Number(row.total_stock ?? 0),
    lowCount: Number(row.low_count ?? 0),
  }))
}

/** 全量导出用。不带统计信息，避免 GROUP BY 影响 id 顺序 */
export async function listAll(): Promise<Product[]> {
  const rows = await all<ProductRow>('SELECT * FROM product ORDER BY id ASC')
  return rows.map(toProduct)
}

export async function getProduct(id: number): Promise<Product | null> {
  const row = await get<ProductRow>('SELECT * FROM product WHERE id = ?', [id])
  return row ? toProduct(row) : null
}

export async function createProduct(input: CreateProductInput): Promise<number> {
  const res = await run(
    `INSERT INTO product (category_id, name, search_key, cost_cents, price_cents, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.categoryId,
      input.name.trim(),
      (input.searchKey ?? '').trim(),
      input.costCents ?? 0,
      input.priceCents ?? 0,
      input.note ?? '',
    ],
  )
  return res.lastId
}

export async function updateProduct(id: number, input: Partial<CreateProductInput>): Promise<void> {
  const fields: string[] = []
  const values: unknown[] = []

  if (input.categoryId !== undefined) { fields.push('category_id = ?'); values.push(input.categoryId) }
  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name.trim()) }
  if (input.searchKey !== undefined) { fields.push('search_key = ?'); values.push(input.searchKey.trim()) }
  if (input.costCents !== undefined) { fields.push('cost_cents = ?'); values.push(input.costCents) }
  if (input.priceCents !== undefined) { fields.push('price_cents = ?'); values.push(input.priceCents) }
  if (input.note !== undefined) { fields.push('note = ?'); values.push(input.note) }

  if (fields.length === 0) return
  values.push(id)
  await run(`UPDATE product SET ${fields.join(', ')} WHERE id = ?`, values)
}

/** 删除款会级联删除它的所有 SKU 和流水（依赖 ON DELETE CASCADE） */
export async function deleteProduct(id: number): Promise<void> {
  await run('DELETE FROM product WHERE id = ?', [id])
}

/** 备份恢复用：清空后整体重建，保留原始 id。必须在事务里调用 */
export async function replaceAll(rows: Product[]): Promise<void> {
  await run('DELETE FROM product')
  for (const row of rows) {
    await run(
      `INSERT INTO product (id, category_id, name, search_key, cost_cents, price_cents, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.categoryId,
        row.name,
        row.searchKey,
        row.costCents,
        row.priceCents,
        row.note,
        row.createdAt,
      ],
    )
  }
}
