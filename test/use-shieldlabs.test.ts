import { load, ShieldLabsError, type ShieldLabsAgent } from '@shieldlabs-ai/js';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, shallowRef, type App } from 'vue';
import { createShieldLabs, useShieldLabs, type InteractionIdentifier, type UseShieldLabsReturn } from '../src/index';
import { createAgent, deferred, PUBLIC_KEY, USER_HID } from './support/agent';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs-ai/js')>();
  return { ...actual, load: vi.fn() };
});

const mockedLoad = vi.mocked(load);
const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  vi.useRealTimers();
});

/** Mounts a component that calls useShieldLabs() and hands back what it returned. */
function mountUse(): { api: UseShieldLabsReturn; element: HTMLElement; app: App; rerender: () => Promise<void> } {
  let api!: UseShieldLabsReturn;
  const tick = shallowRef(0);
  const View = defineComponent({
    setup() {
      api = useShieldLabs();
      return () => h('p', api.status.value + ' ' + String(tick.value));
    },
  });
  const app = createApp(View).use(createShieldLabs({ publicKey: PUBLIC_KEY }));
  const element = document.createElement('div');
  app.mount(element);
  apps.push(app);
  const rerender = async (): Promise<void> => {
    tick.value += 1;
    await nextTick();
  };
  return { api, element, app, rerender };
}

describe('useShieldLabs()', () => {
  it('throws a clear error when the plugin is missing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const View = defineComponent({
      setup() {
        useShieldLabs();
        return () => null;
      },
    });
    expect(() => mount(View)).toThrowError(/found no ShieldLabs plugin.*app\.use\(createShieldLabs\(\{ publicKey \}\)\)/);
  });

  it('throws a clear error outside setup()', () => {
    expect(() => useShieldLabs()).toThrowError(/useShieldLabs\(\) must be called inside setup\(\)/);
  });

  it('identify() waits for the agent and passes the options with the time left', async () => {
    vi.useFakeTimers();
    const pending = deferred<ShieldLabsAgent>();
    mockedLoad.mockReturnValue(pending.promise);
    const { agent, identify } = createAgent();
    const { api } = mountUse();

    const result = api.identify({ userId: USER_HID, timeout: 3000 });
    await flushPromises();
    expect(identify).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    pending.resolve(agent);
    await expect(result).resolves.toEqual({ requestId: expect.any(String) as unknown, userId: USER_HID });
    expect(identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 2000 });

    // Once the agent is ready, a call passes its options as they are.
    await api.identify({ userId: USER_HID, timeout: 3000 });
    expect(identify).toHaveBeenLastCalledWith({ userId: USER_HID, timeout: 3000 });
  });

  it('check() resolves the result, or null when the agent skipped it', async () => {
    const { agent, check } = createAgent();
    mockedLoad.mockResolvedValue(agent);
    const { api } = mountUse();

    await expect(api.check()).resolves.toMatchObject({ userId: null });
    check.mockResolvedValueOnce(null);
    await expect(api.check({ userId: USER_HID })).resolves.toBeNull();
    expect(check).toHaveBeenLastCalledWith({ userId: USER_HID });
  });

  it('identify() rejects with the reason when there is no identification', async () => {
    const failure = new ShieldLabsError('load_failed', 'blocked');
    mockedLoad.mockRejectedValue(failure);
    const { api } = mountUse();
    await expect(api.identify()).rejects.toBe(failure);

    const { agent, identify } = createAgent();
    identify.mockRejectedValue(new ShieldLabsError('timeout', 'The agent did not answer within 10000 ms.'));
    mockedLoad.mockResolvedValue(agent);
    await expect(api.identify()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('renders loading first in every component, then the app status after mount', async () => {
    mockedLoad.mockRejectedValueOnce(new ShieldLabsError('load_failed', 'blocked'));
    const renders: string[] = [];
    const Probe = defineComponent({
      setup() {
        const { status, error } = useShieldLabs();
        return () => {
          const text = status.value + ':' + (error.value?.code ?? 'none');
          renders.push(text);
          return h('span', text);
        };
      },
    });
    const show = shallowRef(false);
    const Root = defineComponent({
      setup() {
        return () => h('div', show.value ? [h(Probe)] : []);
      },
    });
    const app = createApp(Root).use(createShieldLabs({ publicKey: PUBLIC_KEY }));
    const element = document.createElement('div');
    app.mount(element);
    apps.push(app);
    await flushPromises();

    // The app state is already `error`; a component mounted now still renders `loading` first.
    show.value = true;
    await nextTick();
    await nextTick();
    // Vue 3.3 can render the final state twice; the first render is what matters for hydration.
    expect(renders[0]).toBe('loading:none');
    expect(new Set(renders.slice(1))).toEqual(new Set(['error:load_failed']));
    expect(element.textContent).toBe('error:load_failed');
  });

  it('returns the app state directly in app.runWithContext()', async () => {
    mockedLoad.mockResolvedValue(createAgent().agent);
    const { app } = mountUse();
    const api = app.runWithContext(() => useShieldLabs());
    expect(api.status.value).toBe('loading');
    await flushPromises();
    expect(api.status.value).toBe('ready');
    await expect(api.identify()).resolves.toMatchObject({ userId: null });
  });

  it('never identifies on its own: not on mount, re-render or navigation', async () => {
    const { agent, identify, check } = createAgent();
    mockedLoad.mockResolvedValue(agent);
    const { element, rerender } = mountUse();
    await flushPromises();
    await rerender();
    await rerender();
    history.pushState({}, '', '/checkout');
    history.replaceState({}, '', '/checkout?step=2');
    await flushPromises();
    expect(element.textContent).toBe('ready 2');
    expect(identify).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });

  it('getAgent() resolves the agent once it has loaded', async () => {
    const pending = deferred<ShieldLabsAgent>();
    mockedLoad.mockReturnValue(pending.promise);
    const { agent } = createAgent();
    const { api } = mountUse();

    const early = api.getAgent();
    pending.resolve(agent);
    await expect(early).resolves.toBe(agent);
    await expect(api.getAgent()).resolves.toBe(agent);
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });

  it('getAgent() rejects with a ShieldLabsError when the load fails; the next call loads again', async () => {
    const cause = new TypeError('Failed to fetch dynamically imported module');
    const { agent } = createAgent();
    mockedLoad.mockRejectedValueOnce(cause).mockResolvedValueOnce(agent);
    const { api, element } = mountUse();

    await expect(api.getAgent()).rejects.toMatchObject({ code: 'load_failed', cause });
    await flushPromises();
    expect(element.textContent).toBe('error 0');
    await expect(api.getAgent()).resolves.toBe(agent);
    expect(mockedLoad).toHaveBeenCalledTimes(2);
    await flushPromises();
    expect(element.textContent).toBe('ready 0');
  });

  it('getAgent() loads the agent when called before the app is mounted', async () => {
    const { agent } = createAgent();
    mockedLoad.mockResolvedValue(agent);
    const app = createApp({ render: () => null }).use(createShieldLabs({ publicKey: PUBLIC_KEY }));
    apps.push(app);
    const api = app.runWithContext(() => useShieldLabs());
    await expect(api.getAgent()).resolves.toBe(agent);

    // The load has started, so mounting does not load again.
    app.mount(document.createElement('div'));
    await flushPromises();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });

  it('getAgent() gives the agent for identifyOnInteraction() on a form', async () => {
    const fake = createAgent();
    mockedLoad.mockResolvedValue(fake.agent);
    let submit!: () => Promise<string | null>;
    const SignupForm = defineComponent({
      setup() {
        const form = shallowRef<HTMLFormElement | null>(null);
        const { getAgent } = useShieldLabs();
        let identifier: InteractionIdentifier | undefined;
        onMounted(() => {
          void getAgent().then((agent) => {
            if (form.value) identifier = agent.identifyOnInteraction(form.value);
          });
        });
        onBeforeUnmount(() => {
          identifier?.dispose();
        });
        submit = async () => {
          const result = await identifier?.take();
          return result?.requestId ?? null;
        };
        return () => h('form', { ref: form }, [h('input', { name: 'email' })]);
      },
    });
    const wrapper = mount(SignupForm, { global: { plugins: [createShieldLabs({ publicKey: PUBLIC_KEY })] } });
    await flushPromises();
    expect(fake.identifyOnInteraction).toHaveBeenCalledTimes(1);
    expect(fake.identifyOnInteraction).toHaveBeenCalledWith(wrapper.find('form').element);

    await expect(submit()).resolves.toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.interaction.take).toHaveBeenCalledTimes(1);
    expect(fake.identify).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(fake.interaction.dispose).toHaveBeenCalledTimes(1);
  });

  it('load() starts loading once, and again after a failed load', async () => {
    const { agent } = createAgent();
    mockedLoad.mockRejectedValueOnce(new ShieldLabsError('load_failed', 'blocked')).mockResolvedValueOnce(agent);
    const { api, element } = mountUse();
    // load() starts the load and returns nothing: the outcome shows in status and error.
    const start: () => unknown = api.load;
    expect(start()).toBeUndefined();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(element.textContent).toBe('error 0');

    api.load();
    api.load();
    expect(mockedLoad).toHaveBeenCalledTimes(2);
    await flushPromises();
    expect(element.textContent).toBe('ready 0');
    api.load();
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });

  it('load() does nothing in a runtime without a document', () => {
    mockedLoad.mockResolvedValue(createAgent().agent);
    const app = createApp({ render: () => null }).use(createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: false }));
    const api = app.runWithContext(() => useShieldLabs());
    vi.stubGlobal('document', undefined);
    api.load();
    vi.unstubAllGlobals();
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('exposes read-only refs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockedLoad.mockResolvedValue(createAgent().agent);
    const { app } = mountUse();
    const api = app.runWithContext(() => useShieldLabs());
    await flushPromises();
    (api.status as { value: string }).value = 'error';
    expect(api.status.value).toBe('ready');
    expect(warn).toHaveBeenCalled();
  });
});
