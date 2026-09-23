/**
 * category 表的数据访问
 * 规则：整个项目里只有 src/db/repositories/ 下允许出现 SQL 语句。
 */
import { all, get, run } from '../connection'
import type { Category } from '@/types'

interface CategoryRow {
  id: number
  name: string
  created_at: number
}

function toCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, createdAt: row.created_at }
}

export async function listCategories(): Promise<Category[]> {
  const rows = await all<CategoryRow>('SELECT * FROM category ORDER BY id ASC')
  return rows.map(toCategory)
}

export async function getCategory(id: number): Promise<Category | null> {
  const row = await get<CategoryRow>('SELECT * FROM category WHERE id = ?', [id])
  return row ? toCategory(row) : null
}

/** 不存在则创建，返回已有或新建的分类 id */
export async function ensureCategory(name: string): Promise<number> {
  const trimmed = name.trim()
  if (!trimmed) return 0

  const existing = await get<CategoryRow>('SELECT * FROM category WHERE name = ?', [trimmed])
  if (existing) return existing.id

  const res = await run('INSERT INTO category (name) VALUES (?)', [trimmed])
  return res.lastId
}

export async function createCategory(name: string): Promise<number> {
  const res = await run('INSERT INTO category (name) VALUES (?)', [name.trim()])
  return res.lastId
}

export async function deleteCategory(id: number): Promise<void> {
  await run('DELETE FROM category WHERE id = ?', [id])
}

/**
 * 备份恢复用：清空后按给定数据整体重建。
 * 保留原始 id —— product.category_id / sku.product_id 都引用它，重排 id 会让关系全乱。
 * 必须在事务里调用（见 services/backup.ts）。
 */
export async function replaceAll(rows: Category[]): Promise<void> {
  await run('DELETE FROM category')
  for (const row of rows) {
    await run('INSERT INTO category (id, name, created_at) VALUES (?, ?, ?)', [
      row.id,
      row.name,
      row.createdAt,
    ])
  }
}
