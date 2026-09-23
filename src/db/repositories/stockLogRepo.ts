/**
 * stock_log 表的数据访问（库存变动流水）
 *
 * 这张表是这个应用真正有价值的地方：
 * 月底盘货对不上账时能查出每一次变更是谁、什么时候、改了多少；
 * 语音改错时能通过插入反向记录来撤销，而不是直接删历史。
 */
import { all, run } from '../connection'
import type { StockLog, StockSource } from '@/types'

export interface StockLogWithName extends StockLog {
  productName: string
  color: string
  sizeTenth: number
}

interface JoinedRow {
  id: number
  sku_id: number
  delta: number
  source: string
  note: string
  created_at: number
  product_name: string
  color: string
  size_tenth: number
}

function toLog(row: JoinedRow): StockLogWithName {
  return {
    id: row.id,
    skuId: row.sku_id,
    delta: row.delta,
    source: (row.source ?? 'manual') as StockSource,
    note: row.note,
    createdAt: row.created_at,
    productName: row.product_name,
    color: row.color,
    sizeTenth: row.size_tenth,
  }
}

export async function insert(input: {
  skuId: number
  delta: number
  source?: StockSource
  note?: string
}): Promise<void> {
  await run('INSERT INTO stock_log (sku_id, delta, source, note) VALUES (?, ?, ?, ?)', [
    input.skuId,
    input.delta,
    input.source ?? 'manual',
    input.note ?? '',
  ])
}

/** 全量导出用。这里刻意不 join —— 导出的流水只存 sku_id，恢复时要的就是原始记录 */
export async function listAll(): Promise<StockLog[]> {
  interface LogRow {
    id: number
    sku_id: number
    delta: number
    source: string
    note: string
    created_at: number
  }
  const rows = await all<LogRow>('SELECT * FROM stock_log ORDER BY id ASC')
  return rows.map((row) => ({
    id: row.id,
    skuId: row.sku_id,
    delta: row.delta,
    source: (row.source ?? 'manual') as StockSource,
    note: row.note,
    createdAt: row.created_at,
  }))
}

/** 备份恢复用：清空后整体重建。流水是账目，必须原样还原而不是重放，否则时间全变成今天 */
export async function replaceAll(rows: StockLog[]): Promise<void> {
  await run('DELETE FROM stock_log')
  for (const row of rows) {
    await run(
      `INSERT INTO stock_log (id, sku_id, delta, source, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.skuId, row.delta, row.source, row.note, row.createdAt],
    )
  }
}

export async function recent(limit = 50): Promise<StockLogWithName[]> {
  const rows = await all<JoinedRow>(
    `SELECT l.*, p.name AS product_name, s.color, s.size_tenth
     FROM stock_log l
     JOIN sku s ON s.id = l.sku_id
     JOIN product p ON p.id = s.product_id
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ?`,
    [limit],
  )
  return rows.map(toLog)
}

export async function listBySku(skuId: number, limit = 20): Promise<StockLogWithName[]> {
  const rows = await all<JoinedRow>(
    `SELECT l.*, p.name AS product_name, s.color, s.size_tenth
     FROM stock_log l
     JOIN sku s ON s.id = l.sku_id
     JOIN product p ON p.id = s.product_id
     WHERE l.sku_id = ?
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ?`,
    [skuId, limit],
  )
  return rows.map(toLog)
}
