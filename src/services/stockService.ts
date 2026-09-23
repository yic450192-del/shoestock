/**
 * 库存变动的唯一执行入口
 *
 * 设计要点（不要改坏）：
 * 1. applyCommand() 只做「查询 + 校验 + 算出将要发生什么」，不写库、不弹 UI。
 *    它的返回值用来渲染确认卡给用户看。
 * 2. confirmApply() 才真正写库。用户必须在确认卡上点头。
 *    两步分开是为了杜绝"语音误识别直接改账"这类事故。
 * 3. 写库时「更新 sku.stock」和「插入 stock_log」必须在同一个事务里，缺一不可。
 * 4. 语音、手动点击、将来的扫码/批量，都必须产出 StockCommand 再走这里。
 *    不要为任何一种入口另写一套改库存的代码。
 */
import { transaction } from '@/db/connection'
import * as skuRepo from '@/db/repositories/skuRepo'
import * as stockLogRepo from '@/db/repositories/stockLogRepo'
import type { SkuWithProduct } from '@/db/repositories/skuRepo'
import type { StockSource } from '@/types'

export type StockAction = 'IN' | 'OUT' | 'SET'

export interface StockCommand {
  action: StockAction
  /** 款式名片段，会同时匹配 product.name 和 product.search_key */
  productHint?: string
  colorHint?: string
  /** 十分之一码，425 = 42.5 */
  sizeTenth?: number
  /** 变动数量（SET 表示目标值） */
  amount: number
  /**
   * 已知确切 SKU 时的直达通道。
   * 详情页按钮点击是精确操作，不需要再做模糊匹配；
   * 语音/搜索解析不带这个字段，走 productHint 匹配。
   * 两者最终共用同一个 confirmApply 写库，写库的入口始终只有一个。
   */
  skuId?: number
}

export type ApplyResult =
  | {
      kind: 'ok'
      sku: SkuWithProduct
      plannedDelta: number
      nextStock: number
      action: StockAction
    }
  | { kind: 'ambiguous'; candidates: SkuWithProduct[]; command: StockCommand }
  | { kind: 'notFound'; command: StockCommand }
  | { kind: 'needSize'; candidates: SkuWithProduct[]; command: StockCommand }
  | { kind: 'insufficient'; sku: SkuWithProduct; current: number; required: number }
  | { kind: 'invalid'; reason: string }

/** 第一步：算出将要发生什么，返回给确认卡展示 */
export async function applyCommand(cmd: StockCommand): Promise<ApplyResult> {
  if (!cmd.action) {
    return { kind: 'invalid', reason: '没有识别出操作类型（入库/出库/盘点）' }
  }
  if (!Number.isFinite(cmd.amount) || cmd.amount < 0) {
    return { kind: 'invalid', reason: '数量不合法' }
  }
  if (cmd.action === 'SET' && cmd.amount < 0) {
    return { kind: 'invalid', reason: '盘点数量不能为负' }
  }

  // 精确模式：已知 skuId（详情页按钮点击）
  if (cmd.skuId) {
    const sku = await skuRepo.getWithProduct(cmd.skuId)
    if (!sku) return { kind: 'notFound', command: cmd }
    if (cmd.action === 'OUT' && cmd.amount > sku.stock) {
      return { kind: 'insufficient', sku, current: sku.stock, required: cmd.amount }
    }
    const delta =
      cmd.action === 'IN' ? cmd.amount : cmd.action === 'OUT' ? -cmd.amount : cmd.amount - sku.stock
    return { kind: 'ok', sku, plannedDelta: delta, nextStock: sku.stock + delta, action: cmd.action }
  }

  // 模糊模式：语音 / 搜索，靠款式名片段去匹配
  if (!cmd.productHint || !cmd.productHint.trim()) {
    return { kind: 'invalid', reason: '没有识别出款式名' }
  }

  const candidates = await skuRepo.searchCandidates(
    cmd.productHint,
    cmd.colorHint,
    cmd.sizeTenth,
  )

  if (candidates.length === 0) {
    // 可能只是没听出码数 —— 不带码数再查一次，给用户一个可选择的候选清单
    if (cmd.sizeTenth !== undefined) {
      const loose = await skuRepo.searchCandidates(cmd.productHint, cmd.colorHint)
      if (loose.length > 0) return { kind: 'needSize', candidates: loose, command: cmd }
    }
    return { kind: 'notFound', command: cmd }
  }

  if (candidates.length > 1) {
    return { kind: 'ambiguous', candidates, command: cmd }
  }

  const sku = candidates[0]

  if (cmd.action === 'OUT' && cmd.amount > sku.stock) {
    return { kind: 'insufficient', sku, current: sku.stock, required: cmd.amount }
  }

  const plannedDelta =
    cmd.action === 'IN' ? cmd.amount : cmd.action === 'OUT' ? -cmd.amount : cmd.amount - sku.stock

  return {
    kind: 'ok',
    sku,
    plannedDelta,
    nextStock: sku.stock + plannedDelta,
    action: cmd.action,
  }
}

/** 第二步：用户确认后真正落库 */
export async function confirmApply(
  result: Extract<ApplyResult, { kind: 'ok' }>,
  source: StockSource = 'manual',
  note = '',
): Promise<void> {
  await transaction(async () => {
    await skuRepo.adjustStock(result.sku.id, result.plannedDelta)
    await stockLogRepo.insert({
      skuId: result.sku.id,
      delta: result.plannedDelta,
      source,
      note,
    })
  })
}

/**
 * 注意：这里刻意不提供「传一个 SKU 直接写库」的便捷方法。
 * 用户从候选清单里挑中某个 SKU 后，正确做法是带上 skuId 重新调用 applyCommand()，
 * 让确认卡再走一遍（见 VoiceView 的 pickCandidate）。
 * 曾经有个 resolveWith() 干这件事，但它跳过了确认卡，违反了硬约束第 5 条，已删除。
 */

/**
 * 撤销一条流水。
 * 做法不是删除历史记录，而是插入一条反向 delta 的记录 —— 事件溯源的味道，
 * 这样账目永远能看到"改了 +1，后来撤销 -1"的完整轨迹。
 */
export async function undoLog(logId: number, logs: { id: number; skuId: number; delta: number }[]) {
  const target = logs.find((l) => l.id === logId)
  if (!target) throw new Error('找不到该条流水')
  await transaction(async () => {
    await skuRepo.adjustStock(target.skuId, -target.delta)
    await stockLogRepo.insert({
      skuId: target.skuId,
      delta: -target.delta,
      source: 'undo',
      note: `撤销流水 #${logId}`,
    })
  })
}

/** 把结果翻译成一句人话，直接给确认卡用 */
export function describe(result: Extract<ApplyResult, { kind: 'ok' }>): string {
  const { sku, action, plannedDelta, nextStock } = result
  const label = action === 'IN' ? '入库' : action === 'OUT' ? '出库' : '盘点'
  const arrow = action === 'SET' ? '改为' : plannedDelta >= 0 ? `+${plannedDelta}` : String(plannedDelta)
  return `${sku.productName} ${sku.color} ${sku.sizeTenth / 10}码 · ${label} ${arrow} → 剩余 ${nextStock}`
}
