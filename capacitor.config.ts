import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.questionbank.local',
  appName: '本地题库',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    iosScheme: 'http'
  },
  ios: {
    contentInset: 'never',
    allowsLinkPreview: false,
    scrollEnabled: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
