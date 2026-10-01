// @vitest-environment node
// Server-side rendering: no window, no document. The real @shieldlabs-ai/js load() runs (with call
// tracking), so any attempt to load on the server would show up.
import { load, ShieldLabsError } from '@shieldlabs-ai/js';
import { describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createShieldLabs, useIdentify, useShieldLabs } from '../src/index';
import { PUBLIC_KEY, USER_HID } from './support/agent';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs-ai/js')>();
  return { ...actual, load: vi.fn(actual.load) };
});

const mockedLoad = vi.mocked(load);

const Signup = defineComponent({
  setup() {
    const { status, error } = useShieldLabs();
    const identify = useIdentify({ userId: USER_HID, runOnMount: true });
    return () =>
      h('form', [
        h('p', status.value + (error.value ? ':' + error.value.code : '')),
        h('button', { disabled: identify.isLoading.value }, 'Sign up'),
        h('output', identify.result.value?.requestId ?? ''),
        h('small', identify.error.value?.code ?? ''),
      ]);
  },
});

const HTML = '<form><p>loading</p><button>Sign up</button><output></output><small></small></form>';

describe('server-side rendering', () => {
  it('runs without browser globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders loading and never loads, with the plugin installed', async () => {
    const app = createSSRApp(Signup).use(createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true }));
    await expect(renderToString(app)).resolves.toBe(HTML);
    await expect(renderToString(createSSRApp(Signup).use(createShieldLabs({ publicKey: PUBLIC_KEY })))).resolves.toBe(HTML);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('renders the same HTML without the plugin (a client-only plugin, as in Nuxt)', async () => {
    await expect(renderToString(createSSRApp(Signup))).resolves.toBe(HTML);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('without the plugin, identify() and check() report unsupported_environment', async () => {
    const app = createSSRApp(Signup);
    const shieldlabs = app.runWithContext(() => useShieldLabs());
    await expect(shieldlabs.identify()).rejects.toMatchObject({ code: 'unsupported_environment' });
    await expect(shieldlabs.check()).rejects.toBeInstanceOf(ShieldLabsError);

    const helper = app.runWithContext(() => useIdentify({ runOnMount: true }));
    await expect(helper.identify()).resolves.toBeNull();
    expect(helper.error.value).toMatchObject({ code: 'unsupported_environment' });
    expect(shieldlabs.status.value).toBe('loading');
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('treats a server runtime that defines window but no document as a server', async () => {
    // Some runtimes (and polyfills such as `globalThis.window = globalThis`) define only `window`.
    vi.stubGlobal('window', globalThis);
    expect(typeof document).toBe('undefined');

    await expect(renderToString(createSSRApp(Signup))).resolves.toBe(HTML);
    const withPlugin = createSSRApp(Signup).use(createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true }));
    await expect(renderToString(withPlugin)).resolves.toBe(HTML);

    // runOnMount outside a component identifies right away only in a browser.
    const app = createSSRApp(Signup);
    const helper = app.runWithContext(() => useIdentify({ runOnMount: true }));
    expect(helper.isLoading.value).toBe(false);
    await expect(helper.identify()).resolves.toBeNull();
    expect(helper.error.value).toMatchObject({ code: 'unsupported_environment' });
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('load() does nothing and getAgent() rejects with unsupported_environment', async () => {
    for (const options of [{ publicKey: PUBLIC_KEY }, { publicKey: PUBLIC_KEY, autoLoad: false }]) {
      const app = createSSRApp(Signup).use(createShieldLabs(options));
      const shieldlabs = app.runWithContext(() => useShieldLabs());
      shieldlabs.load();
      await expect(shieldlabs.getAgent()).rejects.toMatchObject({ code: 'unsupported_environment' });
      expect(shieldlabs.status.value).toBe('loading');
      await expect(renderToString(app)).resolves.toBe(HTML);
    }
    // getAgent() asks @shieldlabs-ai/js, which rejects on the server; load() never calls it.
    expect(mockedLoad).toHaveBeenCalledTimes(2);

    // The same without the plugin (a client-only plugin, as in Nuxt).
    const standIn = createSSRApp(Signup).runWithContext(() => useShieldLabs());
    standIn.load();
    await expect(standIn.getAgent()).rejects.toMatchObject({ code: 'unsupported_environment' });
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });

  it('with autoLoad: false, identify() and check() still report unsupported_environment', async () => {
    const app = createSSRApp(Signup).use(createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: false }));
    const shieldlabs = app.runWithContext(() => useShieldLabs());
    await expect(shieldlabs.identify()).rejects.toMatchObject({ code: 'unsupported_environment' });
    await expect(shieldlabs.check()).rejects.toMatchObject({ code: 'unsupported_environment' });
    const helper = app.runWithContext(() => useIdentify());
    await expect(helper.identify()).resolves.toBeNull();
    expect(helper.error.value).toMatchObject({ code: 'unsupported_environment' });
    expect(shieldlabs.status.value).toBe('loading');
  });

  it('with the plugin, identify() gets unsupported_environment from @shieldlabs-ai/js and the state stays', async () => {
    const app = createSSRApp(Signup).use(createShieldLabs({ publicKey: PUBLIC_KEY }));
    const shieldlabs = app.runWithContext(() => useShieldLabs());
    await expect(shieldlabs.identify({ userId: USER_HID })).rejects.toMatchObject({ code: 'unsupported_environment' });
    await expect(shieldlabs.check()).rejects.toMatchObject({ code: 'unsupported_environment' });
    expect(mockedLoad).toHaveBeenCalledTimes(2);
    expect(shieldlabs.status.value).toBe('loading');
    expect(shieldlabs.error.value).toBeNull();
    await expect(renderToString(app)).resolves.toBe(HTML);
  });
});
