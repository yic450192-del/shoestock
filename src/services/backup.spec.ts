import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT_VERSION, parseBackup, summarize } from './backup'
import type { BackupPayload } from './backup'

/**
 * 备份校验的回归测试。
 * 导入是"覆盖式"操作 —— 一旦开始写库就没有回头路，
 * 所以宁可在解析阶段多拒几次，也不能让一份坏数据把库存冲掉。
 */

function makePayload(): BackupPayload {
  return {
    app: 'shoestock',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: 1700000000000,
    categories: [{ id: 1, name: '运动鞋', createdAt: 1 }],
    products: [
      {
        id: 1,
        categoryId: 1,
        name: '空军一号',
        searchKey: 'af1',
        costCents: 32500,
        priceCents: 49900,
        note: '',
        createdAt: 1,
      },
    ],
    skus: [
      { id: 1, productId: 1, color: '白色', sizeTenth: 420, stock: 3, warnLevel: 1, createdAt: 1 },
    ],
    stockLogs: [{ id: 1, skuId: 1, delta: 3, source: 'voice', note: '', createdAt: 1 }],
  }
}

describe('备份解析', () => {
  it('能正确解析一份合法备份', () => {
    const payload = parseBackup(JSON.stringify(makePayload()))
    expect(payload.products).toHaveLength(1)
    expect(payload.skus[0].sizeTenth).toBe(420)
  })

  it('JSON 语法错误时给出可读提示', () => {
    expect(() => parseBackup('{ 这不是 json')).toThrow(/合法的 JSON/)
  })

  it('拒绝非本项目的文件', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'other', version: 1 }))).toThrow(
      /不是 ShoeStock/,
    )
  })

  it('拒绝版本高于当前支持的备份', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'shoestock', version: 99 }))).toThrow(
      /版本不兼容/,
    )
  })

  it('缺少关键表时拒绝，而不是当成空数据导入', () => {
    const broken = makePayload() as unknown as Record<string, unknown>
    delete broken.skus
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/skus/)
  })

  it('summary 统计各表条数', () => {
    expect(summarize(makePayload())).toEqual({
      categories: 1,
      products: 1,
      skus: 1,
      logs: 1,
    })
  })
})
