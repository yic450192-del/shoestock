/**
 * 本地规则解析器：一句话 -> StockCommand
 *
 * 为什么不用大模型：这是一个高度封闭的领域（动作只有三种、颜色十几种、码数几十种），
 * 规则在这个范围里的准确率、延迟、成本全面优于调 LLM。
 * 而且它离线可用、零成本、可被单元测试覆盖 —— 换成 API 调用这三样全丢。
 *
 * 何时该换 LLM：当你发现用户说话的方式开始脱离"动作+颜色+码数+数量"这个骨架时
 * （例如"把上周进的那批空军一号里断码的都补三双"），那就超出了规则能覆盖的范围。
 * 到那一步请参考 docs/01-AI施工提示词.md 的 P4 改造，注意仍然要保留确认卡。
 */
import type { StockCommand } from './stockService'
import type { StockAction } from './stockService'

export type ParseResult =
  | { kind: 'ok'; command: StockCommand }
  | { kind: 'error'; reason: string }

/* ---------- 中文数字 ---------- */

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** 支持 "三" / "十" / "十五" / "二十" / "四十二"，不支持 "一百" 以上 */
export function cnToNumber(input: string): number | null {
  if (!input) return null
  if (input === '十') return 10

  let result = 0
  let section = 0
  let matched = false

  for (const ch of input) {
    if (ch === '十') {
      result += (section === 0 ? 1 : section) * 10
      section = 0
      matched = true
    } else if (CN_DIGITS[ch] !== undefined) {
      section = CN_DIGITS[ch]
      matched = true
    } else {
      return null
    }
  }
  return matched ? result + section : null
}

/* ---------- 词表 ---------- */

// 注意顺序：先判 SET，再判 OUT，最后 IN。否则"改成"可能被别的规则吃掉一半。
const ACTION_WORDS: Array<{ action: StockAction; words: string[] }> = [
  { action: 'SET', words: ['盘点', '改成', '改为', '设为', '调整为', '现在是', '还剩'] },
  { action: 'OUT', words: ['卖出', '卖了', '出货', '出库', '出了', '发了', '减少', '减去', '少'] },
  { action: 'IN', words: ['入库', '进货', '进了', '到货', '补货', '回来', '增加', '加', '入'] },
]

const COLOR_WORDS = [
  '米白色', '米白', '奶白', '白色', '藏青', '藏蓝', '酒红', '卡其', '浅灰', '深灰', '浅蓝', '深蓝',
  '黑色', '白', '黑', '灰', '红', '蓝', '绿', '棕', '咖', '紫', '粉', '米', '金', '银', '杏', '藏',
]

const QUANTIFIERS = ['双', '件', '个', '对', '只', '条']

/* ---------- 解析 ---------- */

function detectAction(text: string): StockAction | null {
  for (const { action, words } of ACTION_WORDS) {
    if (words.some((w) => text.includes(w))) return action
  }
  return null
}

/** 抽出码数，返回十分之一码。同时返回它在原文中的命中片段以便剔除。 */
function extractSize(text: string): { sizeTenth: number; matched: string } | null {
  // 逐个校验候选数：款式名里经常自带数字（aj1、361°、1985），
  // 只取第一个落在合理鞋码区间（10~60）里的数，不能看到第一个数字就采信。
  const arabicRe = /(\d{1,2}(?:[.．]\d)?)\s*(?:码|号|[.．]5)?/g
  let m: RegExpExecArray | null
  while ((m = arabicRe.exec(text)) !== null) {
    const value = Number(m[1].replace('．', '.'))
    if (value >= 10 && value <= 60) {
      return { sizeTenth: Math.round(value * 10), matched: m[0] }
    }
  }
  // 四十二码 / 三十九码
  const chinese = text.match(new RegExp(`([${Object.keys(CN_DIGITS).join('')}十]{2,4})\\s*(?:码|号)`))
  if (chinese) {
    const value = cnToNumber(chinese[1])
    if (value !== null && value >= 15 && value <= 60) {
      return { sizeTenth: value * 10, matched: chinese[0] }
    }
  }
  return null
}

/** 抽出数量。没说数量时返回 null（由调用方决定是否兜底为 1） */
function extractAmount(text: string): { amount: number; matched: string } | null {
  const arabicWithUnit = text.match(/(\d{1,4})\s*[双件个对只条]/)
  if (arabicWithUnit) return { amount: Number(arabicWithUnit[1]), matched: arabicWithUnit[0] }

  const chineseWithUnit = text.match(
    new RegExp(`([${Object.keys(CN_DIGITS).join('')}十]{1,3})\\s*[双件个对只条]`),
  )
  if (chineseWithUnit) {
    const value = cnToNumber(chineseWithUnit[1])
    if (value !== null && value > 0) return { amount: value, matched: chineseWithUnit[0] }
  }

  // "减了3" / "卖了3" 这类无量词说法：只在中日数字前面紧跟动作词时采信，避免把码数当数量。
  // 动作词和数字之间允许隔着"了/着/过"这类虚词 —— 中文口语几乎必然这么说。
  const bareArabic = text.match(/(?:加|减|补|进|出|卖|入)[了着过]?\s*(\d{1,3})(?![码号双件个对只条])/)
  if (bareArabic) return { amount: Number(bareArabic[1]), matched: bareArabic[0] }

  return null
}

function extractColor(text: string): string | null {
  // 长词优先，避免"米白色"被先识别成"白"
  const sorted = [...COLOR_WORDS].sort((a, b) => b.length - a.length)
  for (const color of sorted) {
    if (text.includes(color)) return color
  }
  return null
}

/**
 * 主入口。
 * 输入："空军一号白色的42码卖了一双"
 * 输出：{ action:'OUT', productHint:'空军一号', colorHint:'白色', sizeTenth:420, amount:1 }
 */
export function parseUtterance(raw: string): ParseResult {
  let text = raw.trim()
  if (!text) return { kind: 'error', reason: '没有听到内容' }

  const action = detectAction(text)
  if (!action) {
    return { kind: 'error', reason: '没听懂要做什么，请说「入库 / 出库 / 盘点」' }
  }

  const size = extractSize(text)
  if (!size) {
    return { kind: 'error', reason: '没有识别出码数，请说明是多少码' }
  }
  text = text.replace(size.matched, ' ')

  const amountInfo = extractAmount(text)
  const amount = amountInfo ? amountInfo.amount : 1
  if (amountInfo) text = text.replace(amountInfo.matched, ' ')

  const colorHint = extractColor(text) ?? undefined

  // 剩下的就是款式名：把动作词、修饰词、标点全部清掉
  let hint = text
  for (const group of ACTION_WORDS) {
    for (const word of group.words) hint = hint.split(word).join(' ')
  }
  for (const word of COLOR_WORDS) hint = hint.split(word).join(' ')
  for (const word of QUANTIFIERS) hint = hint.split(word).join(' ')
  hint = hint.replace(/[的了着过再还有把给我在]/g, ' ')
  // 清掉"独立成块"的残留数字。例如「42码卖了3」里 3 已被 amount 消费，
  // 但识别不到时它会留在款名里，导致 LIKE '%空军一号 3%' 匹配落空。
  // 只删前后是空格/边界的数字，这样 aj1、361° 这类款名自带的数字不会被误删。
  hint = hint.replace(/(^|\s)\d+(\.\d+)?(?=\s|$)/g, ' ')
  hint = hint.replace(/[,，。、！？.!?\s]+/g, ' ').trim()

  if (!hint) {
    return { kind: 'error', reason: '没有识别出款式名' }
  }

  return {
    kind: 'ok',
    command: { action, productHint: hint, colorHint, sizeTenth: size.sizeTenth, amount },
  }
}
