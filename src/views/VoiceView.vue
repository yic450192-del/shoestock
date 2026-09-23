<script setup lang="ts">
/**
 * 语音指令页：说一句话 → 改库存
 *
 * 【这个页面最重要的设计】
 * 语音在这条链路里只承担「输入一句话」这一件事。从文本往后 ——
 * 解析成指令、模糊匹配 SKU、弹确认卡、写库记流水 —— 与手动输入走的是完全相同的代码。
 * 所以麦克风不可用（国产 ROM 没语音引擎、没权限、环境太吵）时，
 * 下面那个输入框不是"降级方案"，而是同一条路上的另一入口。
 *
 * 【三条不能破的规矩】
 * 1. 原始识别文本必须显示出来，且可编辑。识别错了用户得看得见、改得动。
 * 2. 确认卡一步都不能省，也不能有"总是执行"的勾选。改错一次账要人工翻流水，代价远高于多点一下。
 * 3. 匹配到多个 SKU 时给候选列表让用户挑，绝不替他猜。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useCatalogStore } from '@/stores/catalog'
import * as asr from '@/services/asr'
import { describeError } from '@/utils/error'
import { parseUtterance } from '@/services/nlu'
import * as stockService from '@/services/stockService'
import { formatSize } from '@/types'
import type { SkuWithProduct } from '@/db/repositories/skuRepo'

const store = useCatalogStore()

const availability = ref<asr.AsrAvailability>({ available: false, reason: '正在检测语音服务…' })
const listening = ref(false)
const starting = ref(false)
const partialText = ref('')
/** 最终指令文本。语音结果会填进来，但用户可以改 —— 这是纠错的最后一道防线 */
const text = ref('')

/* ---------- 候选选择（匹配到多个 SKU 时） ---------- */
const candidates = ref<SkuWithProduct[]>([])
const pendingCommand = ref<stockService.StockCommand | null>(null)
const candidateVisible = ref(false)

const EXAMPLES = [
  '空军一号白色的42码卖了一双',
  '耐克空军一号黑42.5码入库三双',
  '德训鞋米白36码盘点五双',
]

onMounted(async () => {
  availability.value = await asr.checkAvailability()
})

onUnmounted(() => {
  // 页面离开时如果还在听，必须停掉，否则麦克风一直占着
  if (listening.value) void asr.cancelListening()
})

/* ---------- 录音 ---------- */

async function startListen() {
  if (!availability.value.available) {
    showToast(availability.value.reason)
    return
  }
  partialText.value = ''
  starting.value = true
  try {
    await asr.startListening({
      onPartial: (t) => {
        partialText.value = t
      },
      onError: (message) => {
        showToast(message)
        listening.value = false
      },
    })
    listening.value = true
  } catch (e) {
    showToast(`无法开始录音：${describeError(e)}`)
  } finally {
    starting.value = false
  }
}

async function stopListen() {
  const finalText = await asr.stopListening(partialText.value)
  listening.value = false
  if (finalText) {
    text.value = finalText
  } else {
    showToast('没听清，请再说一次，或直接在下面手写')
  }
  partialText.value = ''
}

async function toggleListen() {
  if (listening.value) await stopListen()
  else await startListen()
}

/* ---------- 执行 ---------- */

/**
 * 所有结果的统一出口。
 * 只有 'ok' 分支会写库，而且写之前必须经过 showConfirmDialog。
 */
async function handleResult(result: stockService.ApplyResult) {
  switch (result.kind) {
    case 'ok': {
      try {
        await showConfirmDialog({
          title: '确认执行',
          message: stockService.describe(result),
          confirmButtonText: '确认',
          cancelButtonText: '取消',
        })
      } catch {
        return // 用户取消，一个字都不写
      }
      await stockService.confirmApply(result, 'voice', text.value.trim())
      await store.refreshAll()
      showToast('已更新')
      text.value = ''
      return
    }
    case 'ambiguous':
    case 'needSize': {
      candidates.value = result.candidates
      pendingCommand.value = result.command
      candidateVisible.value = true
      return
    }
    case 'insufficient':
      showToast(`库存不足：现存 ${result.current} 双，不能出库 ${result.required} 双`)
      return
    case 'invalid':
      showToast(result.reason)
      return
    case 'notFound':
      showToast('库里没有匹配的鞋。先确认这款的款名/颜色/码数是否已经录入')
      return
  }
}

async function execute() {
  const raw = text.value.trim()
  if (!raw) {
    showToast('先说一句话，或者手动输入一条指令')
    return
  }

  const parsed = parseUtterance(raw)
  if (parsed.kind === 'error') {
    showToast(parsed.reason)
    return
  }

  await handleResult(await stockService.applyCommand(parsed.command))
}

/** 用户从候选里挑中一个：带上明确的 skuId 重新走一遍 —— 确认卡仍然会出现 */
async function pickCandidate(sku: SkuWithProduct) {
  candidateVisible.value = false
  const command = pendingCommand.value
  if (!command) return
  await handleResult(await stockService.applyCommand({ ...command, skuId: sku.id }))
}

function useExample(example: string) {
  text.value = example
}
</script>

<template>
  <div>
    <van-nav-bar title="语音改库存" />

    <!-- 语音可用性。不可用时不藏着，直接把原因说清楚 -->
    <div v-if="!availability.available" class="ss-card">
      <div style="font-weight: 500; margin-bottom: 6px">语音不可用</div>
      <div class="ss-muted">{{ availability.reason }}</div>
    </div>

    <div class="ss-card">
      <div class="ss-mic-wrap">
        <button
          class="ss-mic"
          :class="{ 'ss-mic--on': listening, 'ss-mic--off': !availability.available }"
          :disabled="starting"
          @click="toggleListen"
        >
          <van-icon :name="listening ? 'stop-circle-o' : 'phone-o'" />
        </button>
      </div>
      <div style="text-align: center; margin-top: 8px" class="ss-muted">
        {{ listening ? '正在听…说完后点一下结束' : '按住说话太容易误触，这里做成点一下开始 / 再点一下结束' }}
      </div>

      <!-- 实时部分结果：让用户看见"它听到哪了"，说错能立刻重说 -->
      <div v-if="listening && partialText" class="ss-partial">{{ partialText }}</div>
    </div>

    <div class="ss-card">
      <div style="font-weight: 500; margin-bottom: 8px">指令原文（可修改）</div>
      <van-field
        v-model="text"
        type="textarea"
        rows="2"
        autosize
        placeholder="例如：空军一号白色的42码卖了一双"
      />
      <div class="ss-preview">
        <span
          v-for="example in EXAMPLES"
          :key="example"
          class="ss-chip ss-example"
          @click="useExample(example)"
        >
          {{ example }}
        </span>
      </div>
      <van-button block type="primary" style="margin-top: 12px" @click="execute">
        解析并执行
      </van-button>
      <div class="ss-muted" style="margin-top: 8px; text-align: center">
        执行前一定会弹确认卡，识别错了直接改原文
      </div>
    </div>

    <!-- 候选选择：匹配到多个 SKU 时，让人来挑，不替他猜 -->
    <van-popup v-model:show="candidateVisible" position="bottom" round>
      <div style="padding: 16px">
        <div style="font-weight: 500; margin-bottom: 8px">
          匹配到 {{ candidates.length }} 个，选一个
        </div>
        <div
          v-for="sku in candidates"
          :key="sku.id"
          class="ss-card ss-candidate"
          @click="pickCandidate(sku)"
        >
          <div>{{ sku.productName }} · {{ sku.color }} · {{ formatSize(sku.sizeTenth) }} 码</div>
          <div class="ss-muted">现存 {{ sku.stock }} 双</div>
        </div>
      </div>
    </van-popup>
  </div>
</template>
