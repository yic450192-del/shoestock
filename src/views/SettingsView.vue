<script setup lang="ts">
/**
 * 设置页：数据备份与恢复
 *
 * 这个 app 没有服务端，所有数据只躺在手机本地。
 * 所以"导出备份"不是可有可无的设置项 —— 手机一丢或清一次应用数据，账就没了。
 */
import { onMounted, ref } from 'vue'
import { showConfirmDialog, showDialog, showToast } from 'vant'
import { useCatalogStore } from '@/stores/catalog'
import * as backup from '@/services/backup'
import * as skuRepo from '@/db/repositories/skuRepo'
import * as stockLogRepo from '@/db/repositories/stockLogRepo'
import * as asr from '@/services/asr'
import { describeError } from '@/utils/error'

const store = useCatalogStore()

const skuCount = ref(0)
const logCount = ref(0)
const busy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const asrInfo = ref<asr.AsrAvailability>({ available: false, reason: '检测中…' })

onMounted(async () => {
  await refreshCounts()
  asrInfo.value = await asr.checkAvailability()
})

async function refreshCounts() {
  const [skus, logs] = await Promise.all([skuRepo.listAll(), stockLogRepo.listAll()])
  skuCount.value = skus.length
  logCount.value = logs.length
}

/* ---------- 导出 ---------- */

async function exportJson() {
  busy.value = true
  try {
    const fileName = await backup.saveBackup()
    showDialog({
      title: '备份已导出',
      message: `文件名：${fileName}\n\n手机上在「文件管理 → 文档」里能找到；浏览器里会直接下载。`,
    })
  } catch (e) {
    showToast(`导出失败：${describeError(e)}`)
  } finally {
    busy.value = false
  }
}

async function exportCsv() {
  busy.value = true
  try {
    const fileName = await backup.saveCsv()
    showDialog({ title: '库存表已导出', message: `文件名：${fileName}\n\n可以直接用 Excel 打开。` })
  } catch (e) {
    showToast(`导出失败：${describeError(e)}`)
  } finally {
    busy.value = false
  }
}

/* ---------- 导入 ---------- */

function pickFile() {
  fileInput.value?.click()
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 先清空 value，否则连续选同一个文件不会再触发 change
  input.value = ''
  if (!file) return

  let payload: backup.BackupPayload
  try {
    payload = backup.parseBackup(await file.text())
  } catch (e) {
    showToast(e instanceof Error ? e.message : '文件解析失败')
    return
  }

  const summary = backup.summarize(payload)
  try {
    await showConfirmDialog({
      title: '确认导入',
      message:
        `这份备份含 ${summary.products} 个款、${summary.skus} 个 SKU、${summary.logs} 条流水。\n\n` +
        '导入会**完全替换**当前数据，现有的库存记录将被覆盖且无法恢复。确定继续吗？',
      confirmButtonText: '确定替换',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  busy.value = true
  try {
    await backup.restoreBackup(payload)
    await store.refreshAll()
    await refreshCounts()
    showToast('导入完成')
  } catch (e) {
    showToast(`导入失败：${describeError(e)}`)
  } finally {
    busy.value = false
  }
}

/* ---------- 清空 ---------- */

async function wipe() {
  try {
    await showConfirmDialog({
      title: '清空全部数据',
      message: '所有款、库存和流水都会被删除，且无法恢复。建议先导出一份备份。',
      confirmButtonText: '我已备份，继续',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  busy.value = true
  try {
    await backup.wipeAll()
    await store.refreshAll()
    await refreshCounts()
    showToast('已清空')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <van-nav-bar title="设置" />

    <div class="ss-card">
      <div style="font-weight: 500; margin-bottom: 8px">数据概览</div>
      <div class="ss-row"><span class="ss-muted">款式</span><span>{{ store.totalKind }}</span></div>
      <div class="ss-row"><span class="ss-muted">SKU（颜色 × 码数）</span><span>{{ skuCount }}</span></div>
      <div class="ss-row"><span class="ss-muted">总库存</span><span>{{ store.totalPairs }} 双</span></div>
      <div class="ss-row"><span class="ss-muted">流水记录</span><span>{{ logCount }}</span></div>
    </div>

    <div class="ss-card">
      <div style="font-weight: 500; margin-bottom: 8px">备份与导出</div>
      <div class="ss-muted" style="margin-bottom: 12px">
        数据只存在这台手机上，没有云端副本。建议每周导出一次。
      </div>
      <van-button block type="primary" :loading="busy" @click="exportJson">
        导出完整备份（JSON）
      </van-button>
      <van-button block plain style="margin-top: 8px" :loading="busy" @click="exportCsv">
        导出库存表（CSV，给 Excel 看）
      </van-button>
      <van-button block plain style="margin-top: 8px" @click="pickFile">从备份文件恢复</van-button>
      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        style="display: none"
        @change="onFilePicked"
      />
    </div>

    <div class="ss-card">
      <div style="font-weight: 500; margin-bottom: 8px">语音</div>
      <div class="ss-muted">
        {{ asrInfo.available ? '系统语音识别可用' : asrInfo.reason }}
      </div>
    </div>

    <div class="ss-card">
      <div style="font-weight: 500; margin-bottom: 8px; color: var(--ss-warn)">危险操作</div>
      <van-button block plain type="danger" :loading="busy" @click="wipe">
        清空全部数据
      </van-button>
    </div>

    <div class="ss-muted" style="text-align: center; padding: 12px">
      ShoeStock · 离线优先的鞋子库存管理
    </div>
  </div>
</template>
