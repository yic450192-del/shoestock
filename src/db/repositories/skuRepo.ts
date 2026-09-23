/**
 * sku 表的数据访问（款 + 颜色 + 码数 -> 一个具体的库存单元）
 */
import { all, get, run } from '../connection'
import type { Sku } from '@/types'

export interface SkuRow {
  id: number
  product_id: number
  color: string
  size_tenth: number
  stock: number
  warn_level: number
  created_at: number
}

export interface SkuWithProduct extends Sku {
  productName: string
}

interface JoinedRow extends SkuRow {
  product_name: string
}

function toSku(row: SkuRow): Sku {
  return {
    id: row.id,
    productId: row.product_id,
    color: row.color,
    sizeTenth: row.size_tenth,
    stock: row.stock,
    warnLevel: row.warn_level,
    createdAt: row.created_at,
  }
}

export async function listByProduct(productId: number): Promise<Sku[]> {
  const rows = await all<SkuRow>(
    'SELECT * FROM sku WHERE product_id = ? ORDER BY color ASC, size_tenth ASC',
    [productId],
  )
  return rows.map(toSku)
}

/** 全量导出用 */
export async function listAll(): Promise<Sku[]> {
  const rows = await all<SkuRow>('SELECT * FROM sku ORDER BY id ASC')
  return rows.map(toSku)
}

export async function getSku(id: number): Promise<Sku | null> {
  const row = await get<SkuRow>('SELECT * FROM sku WHERE id = ?', [id])
  return row ? toSku(row) : null
}

/** 已知 skuId 时取带款式名的完整信息，供详情页的精确操作使用 */
export async function getWithProduct(id: number): Promise<SkuWithProduct | null> {
  const row = await get<JoinedRow>(
    `SELECT s.*, p.name AS product_name
     FROM sku s JOIN product p ON p.id = s.product_id
     WHERE s.id = ?`,
    [id],
  )
  return row ? { ...toSku(row), productName: row.product_name } : null
}

export async function findUnique(
  productId: number,
  color: string,
  sizeTenth: number,
): Promise<Sku | null> {
  const row = await get<SkuRow>(
    'SELECT * FROM sku WHERE product_id = ? AND color = ? AND size_tenth = ?',
    [productId, color, sizeTenth],
  )
  return row ? toSku(row) : null
}

/** 按颜色 × 码数的笛卡尔积批量建 SKU。已存在的跳过。 */
export async function bulkCreate(
  productId: number,
  colors: string[],
  sizesTenth: number[],
  warnLevel = 1,
): Promise<number> {
  let created = 0
  for (const color of colors) {
    for (const sizeTenth of sizesTenth) {
      const res = await run(
        `INSERT OR IGNORE INTO sku (product_id, color, size_tenth, stock, warn_level)
         VALUES (?, ?, ?, 0, ?)`,
        [productId, color, sizeTenth, warnLevel],
      )
      if (res.changes > 0) created += 1
    }
  }
  return created
}

/**
 * 语音/搜索的关键查询：用模糊的款式名去候选 SKU。
 * 同时匹配 product.name 和 product.search_key —— 后者存着别名和拼音，
 * 是识别率能上去的主要原因。
 */
export async function searchCandidates(
  productHint: string,
  colorHint?: string,
  sizeTenth?: number,
): Promise<SkuWithProduct[]> {
  const hint = productHint.trim()
  const like = `%${hint}%`
  const params: unknown[] = [like, like]
  let sql = `
    SELECT s.*, p.name AS product_name
    FROM sku s
    JOIN product p ON p.id = s.product_id
    WHERE (p.name LIKE ? OR p.search_key LIKE ?)
  `

  if (colorHint && colorHint.trim()) {
    sql += ' AND s.color LIKE ?'
    params.push(`%${colorHint.trim()}%`)
  }
  if (sizeTenth !== undefined && sizeTenth !== null) {
    sql += ' AND s.size_tenth = ?'
    params.push(sizeTenth)
  }
  sql += ' ORDER BY p.name ASC, s.color ASC, s.size_tenth ASC'

  const rows = await all<JoinedRow>(sql, params)
  return rows.map((row) => ({ ...toSku(row), productName: row.product_name }))
}

/** 直接改库存（不含流水！请一律通过 stockService.confirmApply 调用） */
export async function adjustStock(skuId: number, delta: number): Promise<void> {
  await run('UPDATE sku SET stock = stock + ? WHERE id = ?', [delta, skuId])
}

export async function setStock(skuId: number, value: number): Promise<void> {
  await run('UPDATE sku SET stock = ? WHERE id = ?', [value, skuId])
}

export async function setWarnLevel(skuId: number, level: number): Promise<void> {
  await run('UPDATE sku SET warn_level = ? WHERE id = ?', [level, skuId])
}

/** 断码清单：所有库存 <= 预警值的 SKU */
export async function listLowStock(): Promise<SkuWithProduct[]> {
  const rows = await all<JoinedRow>(
    `SELECT s.*, p.name AS product_name
     FROM sku s
     JOIN product p ON p.id = s.product_id
     WHERE s.stock <= s.warn_level
     ORDER BY s.stock ASC, p.name ASC`,
  )
  return rows.map((row) => ({ ...toSku(row), productName: row.product_name }))
}

export async function deleteByProduct(productId: number): Promise<void> {
  await run('DELETE FROM sku WHERE product_id = ?', [productId])
}

/** 备份恢复用：清空后整体重建，保留原始 id。必须在事务里调用 */
export async function replaceAll(rows: Sku[]): Promise<void> {
  await run('DELETE FROM sku')
  for (const row of rows) {
    await run(
      `INSERT INTO sku (id, product_id, color, size_tenth, stock, warn_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.productId, row.color, row.sizeTenth, row.stock, row.warnLevel, row.createdAt],
    )
  }
}
