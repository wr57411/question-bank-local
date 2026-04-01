import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.questionbank.local',
  appName: '本地题库',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https'
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scrollEnabled: true
  },
  android: {
    allowMixedContent: true,
    captureInput: true
  }
};

export default config;
