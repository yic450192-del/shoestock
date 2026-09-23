/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// 本项目不需要任何环境变量或 API 凭证：
// 数据存在手机本地 SQLite，语音走系统原生识别。
// 如果将来要接云端服务（多机同步等），在这里补 ImportMetaEnv 的声明。
