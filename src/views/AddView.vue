<script setup lang="ts">
/**
 * 录入新款式。核心是一次性按「颜色 × 码数」的笛卡尔积生成全部 SKU，
 * 而不是让使用者一个格子一个格子去加 —— 一双鞋两个颜色八个码就是十六条记录。
 */
import { onMounted, reactive, ref } from 'vue'
import { showSuccessToast, showToast } from 'vant'
import { useCatalogStore } from '@/stores/catalog'
import * as categoryRepo from '@/db/repositories/categoryRepo'
import * as productRepo from '@/db/repositories/productRepo'
import * as skuRepo from '@/db/repositories/skuRepo'
import { parseMoney, formatSize } from '@/types'
import type { Category } from '@/types'

const store = useCatalogStore()

const categories = ref<Category[]>([])
const form = reactive({
  name: '',
  searchKey: '',
  categoryId: null as number | null,
  costYuan: '',
  priceYuan: '',
  note: '',
  newCategory: '',
})

const PRESET_COLORS = ['白色', '黑色', '米白', '卡其', '藏青', '灰色', '棕色', '酒红']
const selectedColors = ref<string[]>([])
const customColor = ref('')

// 常见成人码范围，含半码
const SIZES = Array.from({ length: 24 }, (_, i) => 350 + i * 5)
const selectedSizes = ref<number[]>([])

onMounted(async () => {
  categories.value = await categoryRepo.listCategories()
})

function toggleAllSizes() {
  selectedSizes.value = selectedSizes.value.length === SIZES.length ? [] : [...SIZES]
}

async function submit() {
  if (!form.name.trim()) {
    showToast('请填写款式名')
    return
  }

  const colors = [...selectedColors.value]
  if (customColor.value.trim()) colors.push(customColor.value.trim())
  if (colors.length === 0) {
    showToast('至少选一个颜色')
    return
  }
  if (selectedSizes.value.length === 0) {
    showToast('至少选一个码数')
    return
  }

  let categoryId = form.categoryId ?? null
  if (form.newCategory.trim()) {
    categoryId = await categoryRepo.ensureCategory(form.newCategory.trim())
  }

  const productId = await productRepo.createProduct({
    categoryId,
    name: form.name,
    searchKey: form.searchKey,
    costCents: parseMoney(form.costYuan || '0') ?? 0,
    priceCents: parseMoney(form.priceYuan || '0') ?? 0,
    note: form.note,
  })

  const created = await skuRepo.bulkCreate(productId, colors, selectedSizes.value)

  showSuccessToast(`已创建 ${created} 个库存单元`)
  reset()
  await store.refreshAll()
}

function reset() {
  form.name = ''
  form.searchKey = ''
  form.costYuan = ''
  form.priceYuan = ''
  form.note = ''
  form.newCategory = ''
  selectedColors.value = []
  selectedSizes.value = []
  customColor.value = ''
}
</script>

<template>
  <div>
    <van-nav-bar title="录入新款" />

    <van-form @submit="submit">
      <div class="ss-card">
        <van-field v-model="form.name" label="款式名" placeholder="例：Nike Air Force 1" required />
        <van-field v-model="form.searchKey" label="别名搜索串" placeholder="af1 kongjun 空军一号" />
        <div class="ss-muted" style="margin: 6px 0 0 16px">
          填别名和拼音后，语音说「空军一号」也能命中 —— 这是识别率的关键
        </div>
      </div>

      <div class="ss-card">
        <div style="font-weight: 500; margin-bottom: 8px">分类</div>
        <van-radio-group v-model="form.categoryId" direction="horizontal">
          <van-radio v-for="c in categories" :key="c.id" :name="c.id" style="margin-bottom: 8px">
            {{ c.name }}
          </van-radio>
        </van-radio-group>
        <van-field v-model="form.newCategory" placeholder="或者新建一个分类" style="padding-left: 0" />
      </div>

      <div class="ss-card">
        <van-field v-model="form.costYuan" label="进价(元)" type="number" placeholder="0" />
        <van-field v-model="form.priceYuan" label="售价(元)" type="number" placeholder="0" />
        <van-field v-model="form.note" label="备注" rows="2" autosize type="textarea" />
      </div>

      <div class="ss-card">
        <div style="font-weight: 500; margin-bottom: 8px">颜色</div>
        <van-checkbox-group v-model="selectedColors" direction="horizontal">
          <van-checkbox
            v-for="c in PRESET_COLORS"
            :key="c"
            :name="c"
            shape="square"
            style="margin: 0 8px 8px 0"
          >
            {{ c }}
          </van-checkbox>
        </van-checkbox-group>
        <van-field v-model="customColor" placeholder="其他颜色" style="padding-left: 0" />
      </div>

      <div class="ss-card">
        <div class="ss-row" style="margin-bottom: 8px">
          <div style="font-weight: 500">码数</div>
          <van-button size="small" plain type="primary" @click="toggleAllSizes">全选/清空</van-button>
        </div>
        <van-checkbox-group v-model="selectedSizes">
          <div class="ss-matrix" style="grid-template-columns: repeat(4, 1fr)">
            <van-checkbox
              v-for="s in SIZES"
              :key="s"
              :name="s"
              shape="square"
              style="font-size: 13px"
            >
              {{ formatSize(s) }}
            </van-checkbox>
          </div>
        </van-checkbox-group>
      </div>

      <div style="padding: 12px">
        <van-button block type="primary" native-type="submit">创建款式</van-button>
      </div>
    </van-form>
  </div>
</template>
