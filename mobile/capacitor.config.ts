import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dwelligence.app',
  appName: 'Dwelligence',
  webDir: 'public',
  server: {
    url: 'https://dwelligence.vercel.app',
    cleartext: false,
    allowNavigation: [
      'dwelligence.vercel.app',
      '*.supabase.co',
      '*.supabase.io',
      'accounts.google.com',
      '*.googleusercontent.com',
    ],
  },
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      overlaysWebView: false,
    },
  },
};

export default config;
