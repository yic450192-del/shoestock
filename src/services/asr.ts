/**
 * 语音识别通道：一句话进，一段文本出。
 *
 * 【这个文件刻意只做一件事】
 * 它只负责「把声音变成文字」，不碰业务、不碰数据库。
 * 产出的文本会交给 nlu.ts 解析成 StockCommand，再交给 stockService 执行。
 * 这样分层的好处是：语音不可用时（国产 ROM 没预装语音引擎、没给麦克风权限、
 * 仓库里太吵），只要换成手动输入一行字，后面的链路一行都不用改。
 *
 * 【为什么选系统原生识别而不是百度/讯飞 REST】
 * 1. 免费、无需 key、无需实名 —— 你不用为这个自用工具去申请任何账号。
 * 2. 不走网络（useOnDeviceRecognition 时），仓库/地下室没信号也能用。
 * 3. 绕开了 Capacitor WebView 的 CORS 限制：从 https://localhost 直接 fetch 百度接口
 *    会被浏览器同源策略拦掉，要接云端识别必须额外引入原生 HTTP 通道，不值得。
 * 代价：国内部分 ROM 没有语音引擎会直接不可用。所以 available() 必须先探测，
 * 且 UI 必须给出「手动输入指令」的等价通道 —— 这不是降级，是一等公民路径。
 */
import { Capacitor } from '@capacitor/core'
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition'
import type { PluginListenerHandle } from '@capacitor/core'
import { describeError } from '@/utils/error'

export { describeError }

/** 固定中文普通话。改这里可以支持其他语种 */
export const ASR_LANGUAGE = 'zh-CN'

export interface AsrAvailability {
  available: boolean
  /** 不可用时的原因，直接展示给用户看，不要吞掉 */
  reason: string
}

export interface ListenHandlers {
  /** 实时部分结果，用于让用户看到"它听懂到哪了" */
  onPartial?: (text: string) => void
  onError?: (message: string) => void
}

/* ---------- 可用性探测 ---------- */

/**
 * 必须在 UI 渲染前调用一次。
 * 不要假设"装了插件就能用" —— Android 的 SpeechRecognizer 依赖系统语音引擎，
 * 很多国产 ROM 精简掉了，此时调 start() 只会拿到一个空错误。
 */
export async function checkAvailability(): Promise<AsrAvailability> {
  if (!Capacitor.isNativePlatform()) {
    return {
      available: false,
      reason:
        '当前是浏览器环境，系统语音识别不可用。请打包成 APK 到手机上使用；在浏览器里你可以直接用下面的「手动输入指令」，后面的流程完全一样。',
    }
  }

  try {
    const perm = await SpeechRecognition.requestPermissions()
    if (perm.speechRecognition !== 'granted') {
      return {
        available: false,
        reason: '没有麦克风权限。请到系统设置里给 ShoeStock 打开麦克风，否则无法语音录入。',
      }
    }
  } catch (e) {
    return { available: false, reason: `申请麦克风权限失败：${describeError(e)}` }
  }

  try {
    const { available } = await SpeechRecognition.available()
    if (!available) {
      return {
        available: false,
        reason:
          '这台设备的系统语音服务不可用（常见于精简过的国产 ROM）。不影响使用 —— 用下面的「手动输入指令」输入同样的话即可。',
      }
    }
  } catch (e) {
    return { available: false, reason: `语音服务探测失败：${describeError(e)}` }
  }

  return { available: true, reason: '' }
}

/* ---------- 录音与转写 ---------- */

let partialHandle: PluginListenerHandle | null = null
let errorHandle: PluginListenerHandle | null = null
/** start() 的 promise。partialResults 模式下它会立刻 resolve，所以不能靠它拿最终结果 */
let startPromise: Promise<unknown> | null = null

/**
 * 开始听。partialResults 打开，用户能边说边看到文字在长 ——
 * 这不是花哨效果：说错了能立刻发现，比说完等两秒才知道要强得多。
 */
export async function startListening(handlers: ListenHandlers = {}): Promise<void> {
  await releaseListeners()

  partialHandle = await SpeechRecognition.addListener('partialResults', (event) => {
    // 三种来源的优先级：本轮 matches > 累积文本 > 早期累积字段
    const text = event.matches?.[0] ?? event.accumulatedText ?? event.accumulated ?? ''
    if (text.trim()) handlers.onPartial?.(text.trim())
  })

  errorHandle = await SpeechRecognition.addListener('error', (event) => {
    handlers.onError?.(event.message || event.code || '识别出错')
  })

  startPromise = SpeechRecognition.start({
    language: ASR_LANGUAGE,
    partialResults: true,
    maxResults: 3,
    // popup:false 才是在 app 内联识别；true 会弹出系统对话框，破坏界面一致性
    popup: false,
  })
  // 不 await：partialResults 模式下它会在识别结束前就 resolve，
  // 但即使它 reject（比如没听清）也不该影响"用户手动停止"这条路径
  startPromise.catch(() => {})
}

/**
 * 停止听并返回最终文本。
 * 策略：优先用 stop() 之后的最后一次缓存结果，其次用过程中累积的 partial 文本。
 * 两者都拿不到就返回空串 —— 由调用方决定怎么提示，这里不瞎编内容。
 */
export async function stopListening(accumulated = ''): Promise<string> {
  try {
    await SpeechRecognition.stop()
  } catch {
    // stop 失败也要继续清理，否则下次 start 会残留监听器
  }

  let finalText = ''
  try {
    const last = await SpeechRecognition.getLastPartialResult()
    if (last?.available && last.text?.trim()) finalText = last.text.trim()
    else if (last?.matches?.length) finalText = last.matches[0]
  } catch {
    // 某些 ROM 没实现这个兜底接口，忽略即可
  }

  await releaseListeners()
  return finalText || accumulated.trim()
}

/** 放弃这一次识别（用户取消） */
export async function cancelListening(): Promise<void> {
  try {
    await SpeechRecognition.stop()
  } catch {
    /* 同上，失败也要清理 */
  }
  await releaseListeners()
}

async function releaseListeners(): Promise<void> {
  try {
    await partialHandle?.remove()
  } catch {
    /* 已失效 */
  }
  try {
    await errorHandle?.remove()
  } catch {
    /* 已失效 */
  }
  partialHandle = null
  errorHandle = null
  startPromise = null
}
