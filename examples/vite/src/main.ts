import { createShieldLabs } from '@shieldlabs-ai/vue';
import { createApp } from 'vue';
import App from './App.vue';

// The plugin loads the ShieldLabs agent once, after the app is mounted.
createApp(App)
  .use(createShieldLabs({ publicKey: import.meta.env.VITE_SHIELDLABS_PUBLIC_KEY }))
  .mount('#app');
