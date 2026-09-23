import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.violet.shoestock',
  appName: 'ShoeStock',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorSQLite: {
      // 自用工具，暂不启用 SQLCipher 加密；开启后需要额外处理密钥存储
      androidIsEncryption: false,
    },
  },
}

export default config
