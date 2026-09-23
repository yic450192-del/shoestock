/**
 * 把各种来源的异常翻成人能读的一句话。
 * Capacitor 插件抛回来的东西很杂：有 Error、有 { message }、有纯字符串、也有 undefined，
 * 直接塞进 showToast 会显示成 "[object Object]"。
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const anyE = e as { message?: unknown; errorMessage?: unknown; error?: unknown }
    if (typeof anyE.message === 'string') return anyE.message
    if (typeof anyE.errorMessage === 'string') return anyE.errorMessage
    if (typeof anyE.error === 'string') return anyE.error
  }
  return String(e)
}
