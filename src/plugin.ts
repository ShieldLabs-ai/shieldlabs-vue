import { ShieldLabsError, type LoadOptions } from '@shieldlabs-ai/js';
import type { App } from 'vue';
import { createContext, shieldLabsKey, startContext } from './context';
import type { CheckOnLoadOption, ShieldLabsOptions, ShieldLabsPlugin } from './types';

/** Apps that already have a ShieldLabs plugin: a second one is ignored. */
const installedApps = new WeakSet<App>();

function invalidOptions(message: string): ShieldLabsError {
  return new ShieldLabsError('invalid_options', message);
}

function checkCheckOnLoad(value: unknown): CheckOnLoadOption {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  if (typeof value === 'object' && value !== null) {
    const userId = (value as { userId?: unknown }).userId;
    if (userId === undefined || userId === null) return {};
    if (typeof userId === 'string') return { userId };
  }
  throw invalidOptions('checkOnLoad must be true, false or { userId }.');
}

/**
 * Creates the ShieldLabs plugin for `app.use()`. The plugin loads the agent once per app, after the
 * app is mounted in the browser (with `autoLoad: false`, when `load()` from `useShieldLabs()` is
 * called): never during server-side rendering and never before hydration.
 * The load options (`publicKey`, `environment`, `scriptUrl`, `timeout`) are checked by
 * `@shieldlabs-ai/js` when the agent loads; a problem shows up in `status` and `error`.
 *
 * @example
 * createApp(App)
 *   .use(createShieldLabs({ publicKey: import.meta.env.VITE_SHIELDLABS_PUBLIC_KEY }))
 *   .mount('#app');
 */
export function createShieldLabs(options: ShieldLabsOptions): ShieldLabsPlugin {
  const candidate: unknown = options;
  if (typeof candidate !== 'object' || candidate === null) {
    throw invalidOptions('createShieldLabs() needs an options object with the Public Key of your domain: createShieldLabs({ publicKey }).');
  }
  const checkOnLoad = checkCheckOnLoad(options.checkOnLoad);
  const autoLoad: unknown = options.autoLoad ?? true;
  if (typeof autoLoad !== 'boolean') throw invalidOptions('autoLoad must be true or false.');
  // A copy: changing the options object later does not change the plugin.
  const loadOptions: LoadOptions = { publicKey: options.publicKey };
  if (options.environment !== undefined) loadOptions.environment = options.environment;
  if (options.scriptUrl !== undefined) loadOptions.scriptUrl = options.scriptUrl;
  if (options.timeout !== undefined) loadOptions.timeout = options.timeout;

  return {
    install(app: App): void {
      if (installedApps.has(app)) {
        console.warn('[ShieldLabs] This app already has a ShieldLabs plugin; the second one is ignored.');
        return;
      }
      installedApps.add(app);
      const context = createContext(loadOptions, checkOnLoad, autoLoad);
      app.provide(shieldLabsKey, context);

      // Load once the app is mounted. The server renderer never mounts, and in the browser the
      // first render (or hydration) is done by the time mount() returns.
      const mount = app.mount.bind(app);
      app.mount = (...args: Parameters<App['mount']>) => {
        const root = mount(...args);
        startContext(context);
        return root;
      };
    },
  };
}
