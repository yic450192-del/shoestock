<script setup lang="ts">
/**
 * 库存流水明细。
 * 撤销不是删除记录，而是插入一条反向记录 —— 账目必须留下完整的轨迹。
 */
import { onMounted, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import * as stockLogRepo from '@/db/repositories/stockLogRepo'
import { undoLog } from '@/services/stockService'
import { formatSize } from '@/types'
import type { StockLogWithName } from '@/db/repositories/stockLogRepo'

const logs = ref<StockLogWithName[]>([])

async function load() {
  logs.value = await stockLogRepo.recent(100)
}

onMounted(load)

const SOURCE_LABEL: Record<string, string> = { manual: '手动', voice: '语音', undo: '撤销' }

function timeText(seconds: number): string {
  const d = new Date(seconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function handleUndo(log: StockLogWithName) {
  try {
    await showConfirmDialog({
      title: '撤销这次变动？',
      message: `${log.productName} ${log.color} ${formatSize(log.sizeTenth)}码 ${log.delta > 0 ? '+' : ''}${log.delta}`,
    })
  } catch {
    return
  }
  await undoLog(log.id, logs.value)
  await load()
  showToast('已撤销')
}
</script>

<template>
  <div>
    <van-nav-bar title="最近流水" />

    <van-empty v-if="logs.length === 0" description="还没有任何库存变动" />

    <div v-for="log in logs" :key="log.id" class="ss-card">
      <div class="ss-row">
        <div>
          <div style="font-size: 14px">
            {{ log.productName }} · {{ log.color }} · {{ formatSize(log.sizeTenth) }} 码
          </div>
          <div class="ss-muted">
            {{ SOURCE_LABEL[log.source] ?? log.source }} · {{ timeText(log.createdAt) }}
          </div>
        </div>
        <div class="ss-row" style="gap: 10px">
          <span
            :style="{ color: log.delta >= 0 ? 'var(--ss-ok)' : 'var(--ss-warn)', fontWeight: 500 }"
          >
            {{ log.delta > 0 ? '+' : '' }}{{ log.delta }}
          </span>
          <van-button size="mini" plain @click="handleUndo(log)">撤销</van-button>
        </div>
      </div>
    </div>
  </div>
</template>
