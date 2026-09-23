import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Vant from 'vant'
import 'vant/lib/index.css'
import App from './App.vue'
import './style.css'
import { initDb } from './db/connection'

async function bootstrap() {
  try {
    await initDb()
    console.log('[shoestock] 数据库就绪')
  } catch (error) {
    // 数据库起不来也要把界面渲染出来，否则用户看到的是白屏，无从排查
    console.error('[shoestock] 数据库初始化失败：', error)
  }
  createApp(App).use(createPinia()).use(Vant).mount('#app')
}

bootstrap()
