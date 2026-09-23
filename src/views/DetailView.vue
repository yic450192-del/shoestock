<script setup lang="ts">
/**
 * 款式详情：颜色 × 码数的库存矩阵。
 * 这里是日常操作最频繁的页面 —— 补货、卖出一双、盘点都在这。
 */
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useCatalogStore } from '@/stores/catalog'
import * as stockService from '@/services/stockService'
import { formatSize } from '@/types'
import type { Sku } from '@/types'

const store = useCatalogStore()

const product = computed(() =>
  store.products.find((p) => p.id === store.activeProductId) ?? null,
)

/** 按颜色分组，每组内按码数升序 —— 这就是鞋店老板熟悉的"尺码排" */
const groups = computed(() => {
  const map = new Map<string, Sku[]>()
  for (const sku of store.activeSkus) {
    const list = map.get(sku.color) ?? []
    list.push(sku)
    map.set(sku.color, list)
  }
  return [...map.entries()].map(([color, list]) => ({
    color,
    list: [...list].sort((a, b) => a.sizeTenth - b.sizeTenth),
  }))
})

/* ---------- 唯一的改库存通道 ---------- */

async function apply(skuId: number, action: stockService.StockAction, amount: number) {
  const result = await stockService.applyCommand({ action, amount, skuId })

  if (result.kind === 'ok') {
    try {
      await showConfirmDialog({
        title: '确认修改库存',
        message: stockService.describe(result),
        confirmButtonText: '确认',
        cancelButtonText: '取消',
      })
    } catch {
      return // 用户取消，什么都不做
    }
    await stockService.confirmApply(result, 'manual')
    await store.refreshAll()
    showToast('已更新')
    return
  }

  if (result.kind === 'insufficient') {
    showToast(`库存不足：现存 ${result.current} 双，不能出库 ${result.required} 双`)
    return
  }
  if (result.kind === 'invalid') {
    showToast(result.reason)
    return
  }
  showToast('没有找到对应的库存记录')
}

/* ---------- 盘点：手动设置一个确切数量 ---------- */

const counting = ref<Sku | null>(null)
const countVisible = ref(false)
const countValue = ref(0)

function openCount(sku: Sku) {
  counting.value = sku
  countValue.value = sku.stock
  countVisible.value = true
}

async function submitCount() {
  const sku = counting.value
  if (!sku) return
  countVisible.value = false
  await apply(sku.id, 'SET', countValue.value)
}
</script>

<template>
  <div>
    <van-nav-bar :title="product?.name ?? '详情'" left-arrow @click-left="store.activeProductId = 0" />

    <div class="ss-card">
      <div class="ss-muted">
        进价 ¥{{ (product?.costCents ?? 0) / 100 }} · 售价 ¥{{ (product?.priceCents ?? 0) / 100 }}
      </div>
      <div v-if="product?.note" class="ss-muted" style="margin-top: 4px">{{ product.note }}</div>
      <div class="ss-muted" style="margin-top: 4px">别名：{{ product?.searchKey || '（无）' }}</div>
    </div>

    <div v-for="g in groups" :key="g.color" class="ss-card">
      <div style="font-weight: 500">{{ g.color }}</div>
      <div class="ss-matrix">
        <div
          v-for="sku in g.list"
          :key="sku.id"
          class="ss-cell"
          :class="{ 'ss-cell--low': sku.stock <= sku.warnLevel }"
        >
          <div class="ss-size">{{ formatSize(sku.sizeTenth) }} 码</div>
          <div
            class="ss-stock"
            :class="{ 'ss-stock--low': sku.stock <= sku.warnLevel }"
            @click="openCount(sku)"
          >
            {{ sku.stock }}
          </div>
          <van-button size="mini" type="primary" plain @click="apply(sku.id, 'IN', 1)">
            +1
          </van-button>
          <van-button size="mini" plain @click="apply(sku.id, 'OUT', 1)">-1</van-button>
        </div>
      </div>
    </div>

    <div class="ss-muted" style="text-align: center; padding: 12px">
      点数字可以盘点（手动设为某个值）
    </div>

    <!-- 盘点弹层 -->
    <van-popup v-model:show="countVisible" position="bottom" round>
      <div v-if="counting" style="padding: 20px">
        <div style="font-weight: 500; margin-bottom: 12px">
          {{ counting?.color }} {{ counting ? formatSize(counting.sizeTenth) : '' }} 码 · 盘点
        </div>
        <van-stepper v-model="countValue" :min="0" :step="1" integer input-width="80px" />
        <van-button block type="primary" style="margin-top: 16px" @click="submitCount">
          确认盘点
        </van-button>
      </div>
    </van-popup>
  </div>
</template>
