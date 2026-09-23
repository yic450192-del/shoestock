import { describe, expect, it } from 'vitest'
import { parseUtterance, cnToNumber } from './nlu'

/**
 * 规则解析器的回归防线。
 * 每次修改 nlu.ts 的词表或正则，都必须保证这里全绿 ——
 * 语音改错库存的代价是真实的一笔账，不能靠"感觉没问题"。
 */

describe('中文数字转换', () => {
  it('能解析基础数字', () => {
    expect(cnToNumber('三')).toBe(3)
    expect(cnToNumber('十')).toBe(10)
    expect(cnToNumber('十五')).toBe(15)
    expect(cnToNumber('二十')).toBe(20)
    expect(cnToNumber('四十二')).toBe(42)
  })

  it('对非法输入返回 null', () => {
    expect(cnToNumber('鞋')).toBeNull()
    expect(cnToNumber('')).toBeNull()
  })
})

describe('语音指令解析', () => {
  const cases: Array<{ input: string; expect: Record<string, unknown> }> = [
    {
      input: '空军一号白色的42码卖了一双',
      expect: { action: 'OUT', colorHint: '白色', sizeTenth: 420, amount: 1, productHint: '空军一号' },
    },
    {
      input: '耐克空军一号黑42.5码入库三双',
      expect: { action: 'IN', colorHint: '黑', sizeTenth: 425, amount: 3, productHint: '耐克空军一号' },
    },
    {
      input: 'aj1 灰 39码 盘点 5双',
      expect: { action: 'SET', sizeTenth: 390, amount: 5, productHint: 'aj1' },
    },
    {
      input: '德训鞋米白36码出货两双',
      expect: { action: 'OUT', sizeTenth: 360, amount: 2 },
    },
    {
      input: '空军一号,四十二码,出了',
      expect: { action: 'OUT', sizeTenth: 420, amount: 1 },
    },
    // 口语里动作词和数字之间几乎必然夹着"了"，识别不到会让数字残留进款名
    {
      input: '空军一号42码卖了3',
      expect: { action: 'OUT', sizeTenth: 420, amount: 3, productHint: '空军一号' },
    },
    {
      input: '把空军一号42码改为8双',
      expect: { action: 'SET', sizeTenth: 420, amount: 8, productHint: '空军一号' },
    },
    {
      input: '空军一号42码补货',
      expect: { action: 'IN', sizeTenth: 420, amount: 1 },
    },
  ]

  for (const c of cases) {
    it(`解析「${c.input}」`, () => {
      const result = parseUtterance(c.input)
      expect(result.kind).toBe('ok')
      if (result.kind !== 'ok') return
      const command = result.command as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(c.expect)) {
        expect(command[key]).toBe(value)
      }
    })
  }
})

describe('防御性场景', () => {
  it('没有码数时拒绝执行，而不是猜', () => {
    const result = parseUtterance('空军一号卖了一双')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.reason).toContain('码数')
  })

  it('没有动作词时拒绝执行', () => {
    const result = parseUtterance('空军一号42码')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.reason).toContain('入库')
  })

  it('不会把说完一整句废话当成有效指令', () => {
    const result = parseUtterance('今天天气不错')
    expect(result.kind).toBe('error')
  })
})
