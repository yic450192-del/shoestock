<script setup lang="ts">
import { onMounted } from 'vue'
import { useCatalogStore } from '@/stores/catalog'
import HomeView from '@/views/HomeView.vue'
import AddView from '@/views/AddView.vue'
import LogView from '@/views/LogView.vue'
import DetailView from '@/views/DetailView.vue'
import VoiceView from '@/views/VoiceView.vue'
import SettingsView from '@/views/SettingsView.vue'
import { ref } from 'vue'

const store = useCatalogStore()
const tab = ref<'home' | 'voice' | 'add' | 'log' | 'me'>('home')

onMounted(() => store.refreshAll())
</script>

<template>
  <div class="ss-page">
    <DetailView v-if="store.activeProductId" />

    <template v-else>
      <HomeView v-if="tab === 'home'" />
      <VoiceView v-else-if="tab === 'voice'" />
      <AddView v-else-if="tab === 'add'" />
      <LogView v-else-if="tab === 'log'" />
      <SettingsView v-else-if="tab === 'me'" />

      <van-tabbar v-model="tab">
        <van-tabbar-item name="home" icon="home-o">库存</van-tabbar-item>
        <van-tabbar-item name="voice" icon="volume-o">语音</van-tabbar-item>
        <van-tabbar-item name="add" icon="plus">录入</van-tabbar-item>
        <van-tabbar-item name="log" icon="orders-o">流水</van-tabbar-item>
        <van-tabbar-item name="me" icon="setting-o">设置</van-tabbar-item>
      </van-tabbar>
    </template>
  </div>
</template>
