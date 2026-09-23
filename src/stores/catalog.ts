/**
 * 商品目录的共享状态。
 * 放在这里而不是各个组件里，是因为库存会在 详情页 / 语音页 / 撤销 多处被修改，
 * 需要一处统一的 refresh() 让所有界面同时刷新。
 */
import { defineStore } from 'pinia'
import * as productRepo from '@/db/repositories/productRepo'
import * as skuRepo from '@/db/repositories/skuRepo'
import type { ProductWithStats } from '@/db/repositories/productRepo'
import type { Sku } from '@/types'
import { formatSize } from '@/types'

export const useCatalogStore = defineStore('catalog', {
  state: () => ({
    products: [] as ProductWithStats[],
    keyword: '' as string,
    loading: false as boolean,
    /** 当前查看的款 id，0 表示没有选中 */
    activeProductId: 0 as number,
    activeSkus: [] as Sku[],
    lowStock: [] as skuRepo.SkuWithProduct[],
  }),

  getters: {
    distinctSizes(state): number[] {
      const set = new Set<number>()
      for (const sku of state.activeSkus) set.add(sku.sizeTenth)
      return [...set].sort((a, b) => a - b)
    },
    distinctColors(state): string[] {
      const set = new Set<string>()
      for (const sku of state.activeSkus) set.add(sku.color)
      return [...set]
    },
    totalKind(state): number {
      return state.products.length
    },
    totalPairs(state): number {
      return state.products.reduce((sum, p) => sum + p.totalStock, 0)
    },
  },

  actions: {
    async loadProducts() {
      this.loading = true
      try {
        this.products = await productRepo.listProducts(this.keyword)
      } finally {
        this.loading = false
      }
    },

    async loadLowStock() {
      this.lowStock = await skuRepo.listLowStock()
    },

    async openProduct(id: number) {
      this.activeProductId = id
      this.activeSkus = await skuRepo.listByProduct(id)
    },

    async refreshAll() {
      await Promise.all([this.loadProducts(), this.loadLowStock()])
      if (this.activeProductId) {
        this.activeSkus = await skuRepo.listByProduct(this.activeProductId)
      }
    },

    sizeText(sizeTenth: number): string {
      return formatSize(sizeTenth)
    },
  },
})
