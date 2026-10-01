import { load, ShieldLabsError, type ShieldLabsAgent } from '@shieldlabs-ai/js';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createApp, defineComponent, h, nextTick, shallowRef, type App, type Component } from 'vue';
import {
  createShieldLabs,
  useIdentify,
  useShieldLabs,
  type ShieldLabsOptions,
  type ShieldLabsPlugin,
  type UseIdentifyReturn,
  type UseShieldLabsReturn,
} from '../src/index';
import { createAgent, createBusyAgent, deferred, PUBLIC_KEY, USER_HID } from './support/agent';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs-ai/js')>();
  return { ...actual, load: vi.fn() };
});

const mockedLoad = vi.mocked(load);

/** Renders `status` (and the error code) of the app. */
const StatusView = defineComponent({
  setup() {
    const { status, error } = useShieldLabs();
    return () => h('p', error.value ? status.value + ':' + error.value.code : status.value);
  },
});

const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});

function mountApp(root: Component, ...plugins: ShieldLabsPlugin[]): { app: App; element: HTMLElement } {
  const app = createApp(root);
  for (const plugin of plugins) app.use(plugin);
  const element = document.createElement('div');
  app.mount(element);
  apps.push(app);
  return { app, element };
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected a throw.');
}

function silenceWarnings(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

function warnings(spy: MockInstance<typeof console.warn>): string {
  return spy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
}

describe('createShieldLabs()', () => {
  it('throws invalid_options without an options object', () => {
    for (const value of [undefined, null, PUBLIC_KEY]) {
      const error = thrown(() => createShieldLabs(value as unknown as ShieldLabsOptions));
      expect(error).toBeInstanceOf(ShieldLabsError);
      expect(error).toMatchObject({ code: 'invalid_options' });
    }
  });

  it('throws invalid_options for a checkOnLoad that is not true, false or { userId }', () => {
    for (const checkOnLoad of ['yes', 1, { userId: 42 }]) {
      const error = thrown(() => createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad } as unknown as ShieldLabsOptions));
      expect(error).toMatchObject({ code: 'invalid_options', message: expect.stringContaining('checkOnLoad') as unknown });
    }
  });

  it('does not touch the agent before the app is mounted, then loads it once', () => {
    mockedLoad.mockResolvedValue(createAgent().agent);
    const app = createApp(StatusView);
    app.use(createShieldLabs({ publicKey: PUBLIC_KEY }));
    expect(mockedLoad).not.toHaveBeenCalled();

    const element = document.createElement('div');
    const root = app.mount(element);
    apps.push(app);
    expect(root.$el).toBe(element.firstChild);
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(mockedLoad).toHaveBeenCalledWith({ publicKey: PUBLIC_KEY });
  });

  it('passes only the load options to @shieldlabs-ai/js and copies them', () => {
    mockedLoad.mockResolvedValue(createAgent().agent);
    const options: ShieldLabsOptions = {
      publicKey: PUBLIC_KEY,
      environment: 'development',
      scriptUrl: 'https://cdn.example.com/agent.js',
      timeout: 5000,
      checkOnLoad: true,
    };
    const plugin = createShieldLabs(options);
    options.publicKey = 'changed-later';
    mountApp(StatusView, plugin);
    expect(mockedLoad).toHaveBeenCalledWith({
      publicKey: PUBLIC_KEY,
      environment: 'development',
      scriptUrl: 'https://cdn.example.com/agent.js',
      timeout: 5000,
    });
  });

  it('moves status from loading to ready', async () => {
    const pending = deferred<ShieldLabsAgent>();
    mockedLoad.mockReturnValue(pending.promise);
    const wrapper = mount(StatusView, { global: { plugins: [createShieldLabs({ publicKey: PUBLIC_KEY })] } });
    await flushPromises();
    expect(wrapper.text()).toBe('loading');

    pending.resolve(createAgent().agent);
    await flushPromises();
    expect(wrapper.text()).toBe('ready');
    wrapper.unmount();
  });

  it('reports a failed load and loads again on the next identify()', async () => {
    const failure = new ShieldLabsError('load_failed', 'Could not load the ShieldLabs agent.');
    const { agent, identify } = createAgent();
    mockedLoad.mockRejectedValueOnce(failure).mockResolvedValueOnce(agent);
    let api!: ReturnType<typeof useShieldLabs>;
    const View = defineComponent({
      setup() {
        api = useShieldLabs();
        return () => h('p', api.error.value ? api.status.value + ':' + api.error.value.code : api.status.value);
      },
    });
    const { element } = mountApp(View, createShieldLabs({ publicKey: PUBLIC_KEY }));
    await flushPromises();
    expect(element.textContent).toBe('error:load_failed');
    expect(api.error.value).toBe(failure);

    const result = await api.identify();
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(identify).toHaveBeenCalledTimes(1);
    expect(mockedLoad).toHaveBeenCalledTimes(2);
    await flushPromises();
    expect(element.textContent).toBe('ready');
  });

  it('wraps a rejection that is not a ShieldLabsError in load_failed', async () => {
    const cause = new TypeError('Failed to fetch dynamically imported module');
    mockedLoad.mockRejectedValue(cause);
    let api!: ReturnType<typeof useShieldLabs>;
    const View = defineComponent({
      setup() {
        api = useShieldLabs();
        return () => h('p', api.status.value);
      },
    });
    mountApp(View, createShieldLabs({ publicKey: PUBLIC_KEY }));
    await flushPromises();
    expect(api.status.value).toBe('error');
    expect(api.error.value).toBeInstanceOf(ShieldLabsError);
    expect(api.error.value).toMatchObject({ code: 'load_failed', cause });
  });

  it('warns about load options that @shieldlabs-ai/js rejects', async () => {
    const warn = silenceWarnings();
    mockedLoad.mockRejectedValue(new ShieldLabsError('invalid_options', 'publicKey must match ^[A-Za-z0-9_-]{1,128}$.'));
    const { element } = mountApp(StatusView, createShieldLabs({ publicKey: '' }));
    await flushPromises();
    expect(element.textContent).toBe('error:invalid_options');
    expect(warnings(warn)).toContain('[ShieldLabs] publicKey must match');
  });

  it('does not load again when more components mount after a failed load', async () => {
    mockedLoad.mockRejectedValue(new ShieldLabsError('load_failed', 'blocked'));
    const more = shallowRef(false);
    const Root = defineComponent({
      setup() {
        return () => h('div', [h(StatusView), more.value ? h(StatusView) : null]);
      },
    });
    const { element } = mountApp(Root, createShieldLabs({ publicKey: PUBLIC_KEY }));
    await flushPromises();
    more.value = true;
    await flushPromises();
    expect(element.textContent).toBe('error:load_failederror:load_failed');
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });

  it('is harmless to install twice: the same plugin', () => {
    const warn = silenceWarnings();
    mockedLoad.mockResolvedValue(createAgent().agent);
    const plugin = createShieldLabs({ publicKey: PUBLIC_KEY });
    const app = createApp(StatusView);
    app.use(plugin);
    app.use(plugin);
    app.mount(document.createElement('div'));
    apps.push(app);
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(warnings(warn)).toContain('already been applied');
  });

  it('is harmless to install twice: a second plugin is ignored', async () => {
    const warn = silenceWarnings();
    const { agent, check } = createAgent();
    mockedLoad.mockResolvedValue(agent);
    const { element } = mountApp(
      StatusView,
      createShieldLabs({ publicKey: PUBLIC_KEY }),
      createShieldLabs({ publicKey: 'fedcba9876543210fedcba9876543210', checkOnLoad: true }),
    );
    await flushPromises();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(mockedLoad).toHaveBeenCalledWith({ publicKey: PUBLIC_KEY });
    expect(check).not.toHaveBeenCalled();
    expect(element.textContent).toBe('ready');
    expect(warnings(warn)).toContain('[ShieldLabs] This app already has a ShieldLabs plugin');
  });

  it('gives each app its own state', async () => {
    mockedLoad
      .mockResolvedValueOnce(createAgent().agent)
      .mockRejectedValueOnce(new ShieldLabsError('load_failed', 'blocked'));
    const plugin = createShieldLabs({ publicKey: PUBLIC_KEY });
    const first = mountApp(StatusView, plugin);
    const second = mountApp(StatusView, plugin);
    await flushPromises();
    expect(first.element.textContent).toBe('ready');
    expect(second.element.textContent).toBe('error:load_failed');
  });

  it('loads when a component mounts, if the plugin was installed after the app was mounted', async () => {
    mockedLoad.mockResolvedValue(createAgent().agent);
    const show = shallowRef(false);
    const Root = defineComponent({
      setup() {
        return () => (show.value ? h(StatusView) : h('p', 'idle'));
      },
    });
    const { app, element } = mountApp(Root);
    app.use(createShieldLabs({ publicKey: PUBLIC_KEY }));
    expect(mockedLoad).not.toHaveBeenCalled();

    show.value = true;
    await nextTick();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(element.textContent).toBe('ready');
  });
});

describe('autoLoad', () => {
  /** An app whose component exposes useShieldLabs() and useIdentify(). */
  function mountDeferred(options: Partial<ShieldLabsOptions> = {}) {
    let api!: UseShieldLabsReturn;
    let helper!: UseIdentifyReturn;
    const View = defineComponent({
      setup() {
        api = useShieldLabs();
        helper = useIdentify();
        return () => h('p', api.error.value ? api.status.value + ':' + api.error.value.code : api.status.value);
      },
    });
    const { element } = mountApp(View, createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: false, ...options }));
    return { api, helper, element };
  }

  it('false loads nothing until load(): not on mount, and not on identify(), check() or getAgent()', async () => {
    const fake = createBusyAgent();
    mockedLoad.mockResolvedValue(fake.agent);
    const { api, helper, element } = mountDeferred();
    await flushPromises();

    // Before load(), identify() and check() fail fast instead of waiting, and getAgent() waits.
    const agent = api.getAgent();
    await expect(helper.identify()).resolves.toBeNull();
    expect(helper.error.value).toBeInstanceOf(ShieldLabsError);
    expect(helper.error.value).toMatchObject({
      code: 'not_initialized',
      message: 'The ShieldLabs agent is not loaded. With autoLoad: false it loads once load() is called.',
    });
    expect(helper.isLoading.value).toBe(false);
    await expect(api.identify({ userId: USER_HID })).rejects.toMatchObject({ code: 'not_initialized' });
    await expect(api.check({ userId: USER_HID })).resolves.toBeNull();
    await flushPromises();
    expect(mockedLoad).not.toHaveBeenCalled();
    // The app state is not an error: the agent simply has not loaded yet.
    expect(element.textContent).toBe('loading');

    // For example after consent: getAgent() resolves once the agent is ready, and calls go ahead.
    api.load();
    api.load();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    await expect(agent).resolves.toBe(fake.agent);
    await flushPromises();
    expect(element.textContent).toBe('ready');
    expect(fake.calls).toEqual([]);
    await expect(helper.identify()).resolves.toMatchObject({ userId: null });
    await expect(api.check({ userId: USER_HID })).resolves.toMatchObject({ userId: USER_HID });
    expect(fake.calls).toEqual(['identify:anonymous', 'check:' + USER_HID]);

    api.load();
    await api.getAgent();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });

  it('false: runOnMount ends with not_initialized unless load() was called before the mount', async () => {
    const fake = createAgent();
    mockedLoad.mockResolvedValue(fake.agent);
    const view: { api?: UseIdentifyReturn } = {};
    const Checkout = defineComponent({
      setup() {
        const api = useIdentify({ runOnMount: true });
        view.api = api;
        return () => h('p', api.result.value?.requestId ?? api.error.value?.code ?? '-');
      },
    });

    const { app: early, element } = mountApp(Checkout, createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: false }));
    await flushPromises();
    expect(element.textContent).toBe('not_initialized');
    expect(view.api?.isLoading.value).toBe(false);
    expect(fake.identify).not.toHaveBeenCalled();
    // A later load() loads the agent, but the identification does not run again by itself.
    early.runWithContext(() => useShieldLabs()).load();
    await flushPromises();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(fake.identify).not.toHaveBeenCalled();
    expect(element.textContent).toBe('not_initialized');

    // A visitor who already gave consent: load() before mount(), so the identification waits for the agent.
    const app = createApp(Checkout).use(createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: false }));
    apps.push(app);
    app.runWithContext(() => useShieldLabs()).load();
    const consented = document.createElement('div');
    app.mount(consented);
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(1);
    expect(view.api?.result.value).toMatchObject({ userId: null });
    expect(consented.textContent).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });

  it('false: a failed first load reaches a waiting getAgent(), and the next load() loads again', async () => {
    const fake = createAgent();
    const failure = new ShieldLabsError('load_failed', 'blocked');
    mockedLoad.mockRejectedValueOnce(failure).mockResolvedValueOnce(fake.agent);
    const { api, element } = mountDeferred();
    const agent = api.getAgent();

    api.load();
    await expect(agent).rejects.toBe(failure);
    await flushPromises();
    expect(element.textContent).toBe('error:load_failed');

    api.load();
    await expect(api.getAgent()).resolves.toBe(fake.agent);
    await flushPromises();
    expect(element.textContent).toBe('ready');
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });

  it('false: after load(), calls load again after a failed load, like the default', async () => {
    const fake = createAgent();
    mockedLoad.mockRejectedValueOnce(new ShieldLabsError('load_failed', 'blocked')).mockResolvedValueOnce(fake.agent);
    const { api, helper } = mountDeferred();
    api.load();
    await flushPromises();

    await expect(helper.identify()).resolves.toMatchObject({ userId: null });
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });

  it('true (the default) loads once after mount, also when load() was called before', async () => {
    mockedLoad.mockResolvedValue(createAgent().agent);
    const app = createApp(StatusView).use(createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: true }));
    apps.push(app);
    app.runWithContext(() => useShieldLabs()).load();
    expect(mockedLoad).toHaveBeenCalledTimes(1);

    const element = document.createElement('div');
    app.mount(element);
    await flushPromises();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(element.textContent).toBe('ready');
  });

  it('throws invalid_options when it is not a boolean', () => {
    const error = thrown(() => createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: 'no' } as unknown as ShieldLabsOptions));
    expect(error).toMatchObject({ code: 'invalid_options', message: 'autoLoad must be true or false.' });
  });
});

describe('checkOnLoad', () => {
  async function mountWith(options: Partial<ShieldLabsOptions>) {
    const fake = createAgent();
    mockedLoad.mockResolvedValue(fake.agent);
    const result = mountApp(StatusView, createShieldLabs({ publicKey: PUBLIC_KEY, ...options }));
    await flushPromises();
    return { ...fake, ...result };
  }

  it('does not check by default', async () => {
    const { check, identify } = await mountWith({});
    expect(check).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
  });

  it('true runs one anonymous check() when the agent is ready', async () => {
    const { check, identify } = await mountWith({ checkOnLoad: true });
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(undefined);
    expect(identify).not.toHaveBeenCalled();
  });

  it('{ userId } runs check() for that User HID', async () => {
    const { check } = await mountWith({ checkOnLoad: { userId: USER_HID } });
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith({ userId: USER_HID });
  });

  it('{} and { userId: null } run an anonymous check()', async () => {
    const first = await mountWith({ checkOnLoad: {} });
    expect(first.check).toHaveBeenCalledWith(undefined);
    const second = await mountWith({ checkOnLoad: { userId: null } });
    expect(second.check).toHaveBeenCalledWith(undefined);
  });

  it('warns when @shieldlabs-ai/js rejects the checkOnLoad options', async () => {
    const warn = silenceWarnings();
    const fake = createAgent();
    fake.check.mockRejectedValue(new ShieldLabsError('invalid_options', 'userId "anonymous" is reserved.'));
    mockedLoad.mockResolvedValue(fake.agent);
    mountApp(StatusView, createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: { userId: 'anonymous' } }));
    await flushPromises();
    expect(warnings(warn)).toContain('[ShieldLabs] checkOnLoad: userId "anonymous" is reserved.');
  });

  it('stays quiet when the check itself fails', async () => {
    const warn = silenceWarnings();
    const fake = createAgent();
    fake.check
      .mockRejectedValueOnce(new ShieldLabsError('timeout', 'The agent did not answer within 10000 ms.'))
      .mockImplementationOnce(() => {
        throw new Error('unexpected');
      });
    mockedLoad.mockResolvedValue(fake.agent);
    mountApp(StatusView, createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true }));
    mountApp(StatusView, createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true }));
    await flushPromises();
    expect(fake.check).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('runs once per app', async () => {
    const fake = createBusyAgent();
    mockedLoad.mockResolvedValue(fake.agent);
    let api!: ReturnType<typeof useShieldLabs>;
    const View = defineComponent({
      setup() {
        api = useShieldLabs();
        return () => h('p', api.status.value);
      },
    });
    const Root = defineComponent({
      setup() {
        return () => h('div', [h(View), h(StatusView)]);
      },
    });
    mountApp(Root, createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true }));
    await flushPromises();
    expect(fake.calls).toEqual(['check:anonymous']);

    fake.finish();
    await expect(api.identify()).resolves.toMatchObject({ userId: null });
    fake.finish();
    await api.identify();
    await flushPromises();
    expect(fake.calls).toEqual(['check:anonymous', 'identify:anonymous', 'identify:anonymous']);
  });

  /** A component whose identify helper the test can call. */
  function identifyView(options?: Parameters<typeof useIdentify>[0]) {
    const view: { api?: UseIdentifyReturn } = {};
    const View = defineComponent({
      setup() {
        const api = useIdentify(options);
        view.api = api;
        return () => h('p', api.result.value?.requestId ?? api.error.value?.code ?? '-');
      },
    });
    return { View, view };
  }

  it('is skipped when runOnMount waits for the first load: the identification goes first', async () => {
    const fake = createBusyAgent();
    const pending = deferred<ShieldLabsAgent>();
    mockedLoad.mockReturnValue(pending.promise);
    const { View, view } = identifyView({ runOnMount: true });
    const { element } = mountApp(View, createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true }));
    await flushPromises();
    expect(fake.calls).toEqual([]);

    pending.resolve(fake.agent);
    await flushPromises();
    expect(fake.calls).toEqual(['identify:anonymous']);
    expect(view.api?.result.value).toMatchObject({ userId: null });
    expect(element.textContent).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('runs alongside a call for another User HID', async () => {
    const fake = createBusyAgent();
    const pending = deferred<ShieldLabsAgent>();
    mockedLoad.mockReturnValue(pending.promise);
    const { View, view } = identifyView({ runOnMount: true });
    mountApp(View, createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: { userId: USER_HID } }));
    await flushPromises();

    pending.resolve(fake.agent);
    await flushPromises();
    expect(fake.calls).toEqual(['check:' + USER_HID, 'identify:anonymous']);
    expect(view.api?.result.value).toMatchObject({ userId: null });
  });

  /** An app with autoLoad: false and checkOnLoad for USER_HID, and a helper for that User HID. */
  async function mountConsentApp() {
    const fake = createBusyAgent();
    mockedLoad.mockResolvedValue(fake.agent);
    const { View, view } = identifyView({ userId: USER_HID });
    let api!: UseShieldLabsReturn;
    const Root = defineComponent({
      setup() {
        api = useShieldLabs();
        return () => h(View);
      },
    });
    mountApp(Root, createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: false, checkOnLoad: { userId: USER_HID } }));
    await flushPromises();
    return { fake, api, view };
  }

  it('is skipped when an identify() for the same User HID waits for the agent after load() (autoLoad: false)', async () => {
    const { fake, api, view } = await mountConsentApp();
    api.load();
    const identified = view.api?.identify();

    await expect(identified).resolves.toMatchObject({ userId: USER_HID });
    await flushPromises();
    expect(fake.calls).toEqual(['identify:' + USER_HID]);
  });

  it('runs after load() when an identify() for the same User HID failed fast before it (autoLoad: false)', async () => {
    const { fake, api, view } = await mountConsentApp();
    const identified = view.api?.identify();
    api.load();

    // The call ended at once with not_initialized, so it is not in flight when the agent is ready.
    await expect(identified).resolves.toBeNull();
    expect(view.api?.error.value).toMatchObject({ code: 'not_initialized' });
    await flushPromises();
    expect(fake.calls).toEqual(['check:' + USER_HID]);
  });

  it('runs when load() makes the agent ready and no call waits (autoLoad: false)', async () => {
    const fake = createBusyAgent();
    mockedLoad.mockResolvedValue(fake.agent);
    let api!: UseShieldLabsReturn;
    const View = defineComponent({
      setup() {
        api = useShieldLabs();
        return () => h('p', api.status.value);
      },
    });
    mountApp(View, createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: false, checkOnLoad: true }));
    await flushPromises();
    expect(fake.calls).toEqual([]);

    api.load();
    await flushPromises();
    expect(fake.calls).toEqual(['check:anonymous']);
  });

  it('is skipped when identify() retries a failed load, and stays skipped', async () => {
    const fake = createBusyAgent();
    mockedLoad.mockRejectedValueOnce(new ShieldLabsError('load_failed', 'blocked')).mockResolvedValue(fake.agent);
    const { View, view } = identifyView();
    const { element } = mountApp(View, createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true }));
    await flushPromises();
    expect(fake.calls).toEqual([]);

    // The protected action loads the agent again; its identification is not refused.
    await expect(view.api?.identify()).resolves.toMatchObject({ userId: null });
    await flushPromises();
    expect(fake.calls).toEqual(['identify:anonymous']);
    expect(element.textContent).toMatch(/^[0-9a-f-]{36}$/);

    fake.finish();
    await view.api?.identify();
    await flushPromises();
    expect(fake.calls).toEqual(['identify:anonymous', 'identify:anonymous']);
  });

  it('is skipped when check() retries a failed load', async () => {
    const fake = createBusyAgent();
    mockedLoad.mockRejectedValueOnce(new ShieldLabsError('load_failed', 'blocked')).mockResolvedValue(fake.agent);
    let api!: ReturnType<typeof useShieldLabs>;
    const View = defineComponent({
      setup() {
        api = useShieldLabs();
        return () => h('p', api.status.value);
      },
    });
    mountApp(View, createShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: { userId: USER_HID } }));
    await flushPromises();

    await expect(api.check({ userId: USER_HID })).resolves.toMatchObject({ userId: USER_HID });
    await flushPromises();
    expect(fake.calls).toEqual(['check:' + USER_HID]);
  });
});
