// Components that mount, unmount and mount again, and calls or loads that end after an unmount.
import { load, ShieldLabsError, type IdentifyResult, type ShieldLabsAgent } from '@shieldlabs-ai/js';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, shallowRef, type App, type Component } from 'vue';
import { createShieldLabs, useIdentify, useShieldLabs, type UseIdentifyReturn, type UseShieldLabsReturn } from '../src/index';
import { createAgent, deferred, PUBLIC_KEY, USER_HID } from './support/agent';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs-ai/js')>();
  return { ...actual, load: vi.fn() };
});

const mockedLoad = vi.mocked(load);
const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});

function mountApp(root: Component): { app: App; element: HTMLElement } {
  const app = createApp(root).use(createShieldLabs({ publicKey: PUBLIC_KEY }));
  const element = document.createElement('div');
  app.mount(element);
  apps.push(app);
  return { app, element };
}

/** Collects console warnings and errors, which none of these cases may produce. */
function watchConsole(): () => string {
  const warn = vi.spyOn(console, 'warn');
  const error = vi.spyOn(console, 'error');
  return () => [...warn.mock.calls, ...error.mock.calls].map((args) => args.map(String).join(' ')).join('\n');
}

describe('mounting and unmounting', () => {
  it('loads once while components mount, unmount and mount again', async () => {
    const fake = createAgent();
    mockedLoad.mockResolvedValue(fake.agent);
    const show = shallowRef(true);
    const Probe = defineComponent({
      setup() {
        const { status } = useShieldLabs();
        useIdentify();
        return () => h('p', status.value);
      },
    });
    const Root = defineComponent({
      setup() {
        return () => h('div', show.value ? [h(Probe), h(Probe)] : []);
      },
    });
    const { element } = mountApp(Root);
    await flushPromises();

    for (let round = 0; round < 4; round += 1) {
      show.value = !show.value;
      await flushPromises();
    }
    expect(element.textContent).toBe('readyready');
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(fake.identify).not.toHaveBeenCalled();
    expect(fake.check).not.toHaveBeenCalled();
  });

  it('runOnMount identifies once per mount, not when a kept-alive component is shown again', async () => {
    const fake = createAgent();
    mockedLoad.mockResolvedValue(fake.agent);
    const show = shallowRef(true);
    const CheckoutStep = defineComponent({
      setup() {
        const { result } = useIdentify({ runOnMount: true });
        return () => h('p', result.value?.requestId ?? '-');
      },
    });
    const Cart = defineComponent({
      setup() {
        return () => h('p', 'cart');
      },
    });
    const Root = defineComponent({
      setup() {
        return () => h(KeepAlive, null, { default: () => (show.value ? h(CheckoutStep) : h(Cart)) });
      },
    });
    const { element } = mountApp(Root);
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(1);
    const shown = element.textContent;
    expect(shown).toMatch(/^[0-9a-f-]{36}$/);

    show.value = false;
    await flushPromises();
    show.value = true;
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(1);
    expect(element.textContent).toBe(shown);
  });

  it('an identification that ends after its component unmounted resolves quietly', async () => {
    const logged = watchConsole();
    const fake = createAgent();
    const answer = deferred<IdentifyResult>();
    fake.identify.mockReturnValueOnce(answer.promise);
    mockedLoad.mockResolvedValue(fake.agent);
    let helper!: UseIdentifyReturn;
    const show = shallowRef(true);
    const SignupForm = defineComponent({
      setup() {
        helper = useIdentify({ userId: USER_HID });
        return () => h('form', helper.isLoading.value ? 'busy' : 'idle');
      },
    });
    const Root = defineComponent({
      setup() {
        return () => h('div', show.value ? [h(SignupForm)] : []);
      },
    });
    const { element } = mountApp(Root);
    await flushPromises();

    const call = helper.identify();
    show.value = false;
    await flushPromises();
    answer.resolve({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a', userId: USER_HID });
    await expect(call).resolves.toMatchObject({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a' });
    expect(helper.result.value).toMatchObject({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a' });
    expect(element.textContent).toBe('');
    expect(logged()).toBe('');
  });

  it('a load that ends after the app unmounted throws nothing, and waiting calls still settle', async () => {
    const logged = watchConsole();
    const agentLoaded = deferred<ShieldLabsAgent>();
    mockedLoad.mockReturnValue(agentLoaded.promise);
    const fake = createAgent();
    let api!: UseShieldLabsReturn;
    let helper!: UseIdentifyReturn;
    const View = defineComponent({
      setup() {
        api = useShieldLabs();
        helper = useIdentify();
        return () => h('p', api.status.value);
      },
    });
    const { app } = mountApp(View);
    const identified = helper.identify();
    const agent = api.getAgent();
    apps.splice(apps.indexOf(app), 1);
    app.unmount();

    agentLoaded.resolve(fake.agent);
    await expect(identified).resolves.toMatchObject({ userId: null });
    await expect(agent).resolves.toBe(fake.agent);
    expect(logged()).toBe('');
  });

  it('a load that fails after the app unmounted reaches the waiting calls without throwing', async () => {
    const logged = watchConsole();
    const agentLoaded = deferred<ShieldLabsAgent>();
    mockedLoad.mockReturnValue(agentLoaded.promise);
    let helper!: UseIdentifyReturn;
    const View = defineComponent({
      setup() {
        helper = useIdentify();
        return () => h('p', helper.error.value?.code ?? '-');
      },
    });
    const { app } = mountApp(View);
    const identified = helper.identify();
    apps.splice(apps.indexOf(app), 1);
    app.unmount();

    agentLoaded.reject(new ShieldLabsError('load_failed', 'blocked'));
    await expect(identified).resolves.toBeNull();
    expect(helper.error.value).toMatchObject({ code: 'load_failed' });
    expect(logged()).toBe('');
  });
});
