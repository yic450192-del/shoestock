<script setup lang="ts">
import { computed } from 'vue'
import { useCatalogStore } from '@/stores/catalog'

const store = useCatalogStore()

const products = computed(() => store.products)
</script>

<template>
  <div>
    <van-nav-bar title="鞋库" />

    <div class="ss-card ss-row">
      <div style="text-align: center; flex: 1">
        <div class="ss-muted">款式</div>
        <div style="font-size: 20px; font-weight: 500">{{ store.totalKind }}</div>
      </div>
      <div style="text-align: center; flex: 1">
        <div class="ss-muted">库存合计</div>
        <div style="font-size: 20px; font-weight: 500">{{ store.totalPairs }} 双</div>
      </div>
      <div style="text-align: center; flex: 1">
        <div class="ss-muted">断码</div>
        <div style="font-size: 20px; font-weight: 500; color: var(--ss-warn)">
          {{ store.lowStock.length }}
        </div>
      </div>
    </div>

    <van-search
      v-model="store.keyword"
      placeholder="搜款式名 / 别名 / 拼音"
      @update:model-value="store.loadProducts()"
    />

    <van-empty v-if="products.length === 0" description="还没有录入鞋子，去「录入」页开工" />

    <div v-for="p in products" :key="p.id" class="ss-card" @click="store.openProduct(p.id)">
      <div class="ss-row">
        <div>
          <div style="font-size: 15px; font-weight: 500">{{ p.name }}</div>
          <div class="ss-muted">
            库存 {{ p.totalStock }} 双
            <span v-if="p.lowCount > 0" style="color: var(--ss-warn)">
              · {{ p.lowCount }} 个断码
            </span>
          </div>
        </div>
        <van-icon name="arrow" />
      </div>
    </div>
  </div>
</template>
