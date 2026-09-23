/**
 * 数据库 schema 与版本化迁移
 *
 * 迁移策略：不用插件自带的 addUpgradeStatement，而是自己维护 PRAGMA user_version。
 * 这样做的好处是只依赖 execute/query 两个最稳定的 API，
 * 不受 @capacitor-community/sqlite 版本间 API 变动影响。
 *
 * 增加新版本的规则：
 *   1. 在 MIGRATIONS 数组末尾追加 { version: 当前最大版本+1, statements: [...] }
 *   2. 永远不要修改已经存在的历史 statements —— 已经安装在用户手机上的库会跳过它们
 */

export interface Migration {
  version: number
  statements: string[]
}

export const DB_NAME = 'shoestock.db'

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS category (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`,

      `CREATE TABLE IF NOT EXISTS product (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER,
        name TEXT NOT NULL,
        search_key TEXT NOT NULL DEFAULT '',
        cost_cents INTEGER NOT NULL DEFAULT 0,
        price_cents INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (category_id) REFERENCES category(id) ON DELETE SET NULL
      )`,

      `CREATE TABLE IF NOT EXISTS sku (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        color TEXT NOT NULL DEFAULT '',
        size_tenth INTEGER NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        warn_level INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE CASCADE
      )`,

      // 核心约束：同一款 + 同一颜色 + 同一码数，只能有一条 SKU
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_unique ON sku(product_id, color, size_tenth)`,
      `CREATE INDEX IF NOT EXISTS idx_sku_product ON sku(product_id)`,

      `CREATE TABLE IF NOT EXISTS stock_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku_id INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (sku_id) REFERENCES sku(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_log_sku ON stock_log(sku_id)`,
      `CREATE INDEX IF NOT EXISTS idx_log_time ON stock_log(created_at DESC)`,

      `CREATE INDEX IF NOT EXISTS idx_product_name ON product(name)`,
      `CREATE INDEX IF NOT EXISTS idx_product_search ON product(search_key)`,
    ],
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/** 预置分类，首次建库后自动写入 */
export const DEFAULT_CATEGORIES = ['运动鞋', '皮鞋', '休闲鞋', '凉鞋拖鞋', '靴子', '童鞋']
