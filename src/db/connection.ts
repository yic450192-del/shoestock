/**
 * SQLite 连接封装
 *
 * 原生平台（Android）：走 @capacitor-community/sqlite 的原生实现
 * Web 平台（浏览器调试）：降级为 jeep-sqlite + sql.js(WASM)，数据在 IndexedDB
 *
 * 这样做是为了让开发阶段可以在浏览器里 npm run dev 快速迭代，
 * 而不是每改一行都要重新打包 APK 装到手机上。
 */
import { Capacitor } from '@capacitor/core'
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import { DB_NAME, DEFAULT_CATEGORIES, MIGRATIONS } from './schema'

let conn: SQLiteDBConnection | null = null
let initPromise: Promise<void> | null = null

async function setupWebStore(connection: SQLiteConnection): Promise<void> {
  const { defineCustomElements } = await import('jeep-sqlite/loader')
  defineCustomElements(window as unknown as Window & typeof globalThis)
  await new Promise<void>((resolve) => {
    customElements.whenDefined('jeep-sqlite').then(() => resolve())
  })
  const el = document.createElement('jeep-sqlite')
  document.body.appendChild(el)
  await connection.initWebStore()
}

async function openConnection(): Promise<SQLiteDBConnection> {
  const connection = new SQLiteConnection(CapacitorSQLite)

  if (Capacitor.getPlatform() === 'web') {
    await setupWebStore(connection)
  }

  let db: SQLiteDBConnection
  try {
    const consistency = await connection.checkConnectionsConsistency()
    const existing = await connection.isConnection(DB_NAME, false)
    if (consistency.result && existing.result) {
      db = await connection.retrieveConnection(DB_NAME, false)
    } else {
      db = await connection.createConnection(DB_NAME, false, 'no-encryption', 1, false)
    }
  } catch {
    db = await connection.createConnection(DB_NAME, false, 'no-encryption', 1, false)
  }

  await db.open()
  // SQLite 的外键约束默认是关闭的，必须每条连接都显式打开
  await db.execute('PRAGMA foreign_keys = ON')
  return db
}

async function runMigrations(db: SQLiteDBConnection): Promise<void> {
  const res = await db.query('PRAGMA user_version')
  const current = Number(res.values?.[0]?.user_version ?? 0)

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    for (const statement of migration.statements) {
      await db.execute(statement)
    }
    await db.execute(`PRAGMA user_version = ${migration.version}`)
  }

  if (current === 0) {
    for (const name of DEFAULT_CATEGORIES) {
      await db.run('INSERT OR IGNORE INTO category (name) VALUES (?)', [name])
    }
  }
}

export async function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      conn = await openConnection()
      await runMigrations(conn)
    })()
  }
  return initPromise
}

async function ensureDb(): Promise<SQLiteDBConnection> {
  await initDb()
  if (!conn) throw new Error('数据库尚未初始化')
  return conn
}

/* ---------- 对外的最小数据访问接口 ---------- */

/** 执行单条不返回结果的 SQL（DDL / INSERT / UPDATE / DELETE） */
export async function exec(sql: string, params: unknown[] = []): Promise<void> {
  const db = await ensureDb()
  if (params.length === 0) {
    await db.execute(sql)
  } else {
    await db.run(sql, params as any[])
  }
}

/** INSERT / UPDATE / DELETE，返回影响行数与自增 id */
export async function run(
  sql: string,
  params: unknown[] = [],
): Promise<{ changes: number; lastId: number }> {
  const db = await ensureDb()
  const res = await db.run(sql, params as any[])
  return {
    changes: res.changes?.changes ?? 0,
    lastId: res.changes?.lastId ?? 0,
  }
}

/** 查询多行 */
export async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await ensureDb()
  const res = await db.query(sql, params as any[])
  return (res.values ?? []) as unknown as T[]
}

/** 查询单行，无结果返回 null */
export async function get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await all<T>(sql, params)
  return rows.length > 0 ? rows[0] : null
}

/**
 * 事务。库存变动必须用它 —— 更新 sku.stock 和插入 stock_log 要么都成功，要么都不发生。
 */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const db = await ensureDb()
  await db.beginTransaction()
  try {
    const result = await fn()
    await db.commitTransaction()
    return result
  } catch (error) {
    try {
      await db.rollbackTransaction()
    } catch {
      // 回滚也失败时不覆盖原始错误
    }
    throw error
  }
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}
