// The timeout of identify() and check() covers the whole call: the wait for the agent to load and the
// agent's answer. Fake timers control the clock.
import { load, ShieldLabsError, type IdentifyOptions, type ShieldLabsAgent } from '@shieldlabs-ai/js';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, type App } from 'vue';
import {
  createShieldLabs,
  useIdentify,
  useShieldLabs,
  type ShieldLabsOptions,
  type UseIdentifyReturn,
  type UseShieldLabsReturn,
} from '../src/index';
import { createAgent, createBusyAgent, deferred, PUBLIC_KEY, USER_HID } from './support/agent';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs-ai/js')>();
  return { ...actual, load: vi.fn() };
});

const mockedLoad = vi.mocked(load);
const apps: App[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  vi.useRealTimers();
});

/** Mounts an app whose agent loads when the test calls `finishLoad()`. */
function mountSlowAgent(options: Partial<ShieldLabsOptions> = {}, agent: ShieldLabsAgent = createAgent().agent) {
  const agentLoaded = deferred<ShieldLabsAgent>();
  mockedLoad.mockReturnValue(agentLoaded.promise);
  let shieldlabs!: UseShieldLabsReturn;
  let helper!: UseIdentifyReturn;
  const View = defineComponent({
    setup() {
      shieldlabs = useShieldLabs();
      helper = useIdentify({ userId: USER_HID });
      return () => h('p', shieldlabs.status.value);
    },
  });
  const app = createApp(View).use(createShieldLabs({ publicKey: PUBLIC_KEY, ...options }));
  const element = document.createElement('div');
  app.mount(element);
  apps.push(app);
  return {
    shieldlabs,
    helper,
    element,
    finishLoad: async (): Promise<void> => {
      agentLoaded.resolve(agent);
      await flushPromises();
    },
    failLoad: async (reason: unknown): Promise<void> => {
      agentLoaded.reject(reason);
      await flushPromises();
    },
  };
}

describe('the timeout of a call', () => {
  it('covers the wait for the agent: the agent gets the time left', async () => {
    const fake = createAgent();
    const { helper, finishLoad } = mountSlowAgent({}, fake.agent);
    const call = helper.identify({ timeout: 5000 });

    vi.advanceTimersByTime(4000);
    await finishLoad();
    expect(fake.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 1000 });
    await expect(call).resolves.toMatchObject({ userId: USER_HID });
  });

  it('defaults to the plugin timeout, then to 10 seconds', async () => {
    const withPluginTimeout = createAgent();
    const first = mountSlowAgent({ timeout: 6000 }, withPluginTimeout.agent);
    const checked = first.shieldlabs.check();
    vi.advanceTimersByTime(2500);
    await first.finishLoad();
    expect(withPluginTimeout.check).toHaveBeenCalledWith({ timeout: 3500 });
    await expect(checked).resolves.toMatchObject({ userId: null });

    const withDefault = createAgent();
    const second = mountSlowAgent({}, withDefault.agent);
    const identified = second.shieldlabs.identify({ userId: USER_HID });
    vi.advanceTimersByTime(2500);
    await second.finishLoad();
    expect(withDefault.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 7500 });
    await expect(identified).resolves.toMatchObject({ userId: USER_HID });
  });

  it('ends at its deadline when the agent loads too slowly, and the call never reaches the agent', async () => {
    const fake = createAgent();
    const { helper, shieldlabs, element, finishLoad } = mountSlowAgent({}, fake.agent);
    const fromHelper = helper.identify({ timeout: 3000 });
    const fromState = expect(shieldlabs.identify({ timeout: 3000 })).rejects.toMatchObject({ code: 'timeout' });
    const fromCheck = expect(shieldlabs.check({ timeout: 3000 })).rejects.toMatchObject({ code: 'timeout' });

    vi.advanceTimersByTime(2999);
    await flushPromises();
    expect(helper.isLoading.value).toBe(true);
    vi.advanceTimersByTime(1);
    await expect(fromHelper).resolves.toBeNull();
    expect(helper.error.value).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 3000 ms.' });
    await fromState;
    await fromCheck;

    // The agent arrives later: it is ready for the next call, and the calls that ended never run.
    await finishLoad();
    expect(element.textContent).toBe('ready');
    expect(fake.identify).not.toHaveBeenCalled();
    expect(fake.check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends when the agent is ready only at the deadline', async () => {
    const fake = createAgent();
    const { helper, finishLoad } = mountSlowAgent({}, fake.agent);
    const call = helper.identify({ timeout: 3000 });

    // The clock reaches the deadline before the timer runs, for example on a busy main thread.
    vi.setSystemTime(Date.now() + 3000);
    await finishLoad();
    await expect(call).resolves.toBeNull();
    expect(helper.error.value).toMatchObject({ code: 'timeout' });
    expect(fake.identify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps its timeout error when the load fails after the deadline', async () => {
    const { helper, element, failLoad } = mountSlowAgent();
    const call = helper.identify({ timeout: 1000 });
    vi.advanceTimersByTime(1000);
    await expect(call).resolves.toBeNull();

    await failLoad(new ShieldLabsError('load_failed', 'blocked'));
    expect(helper.error.value).toMatchObject({ code: 'timeout' });
    expect(element.textContent).toBe('error');
  });

  it('clears its timer when the load fails first', async () => {
    const failure = new ShieldLabsError('load_failed', 'blocked');
    const { helper, failLoad } = mountSlowAgent();
    const call = helper.identify();
    vi.advanceTimersByTime(500);

    await failLoad(failure);
    await expect(call).resolves.toBeNull();
    expect(helper.error.value).toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes the options as they are once the agent is ready', async () => {
    const fake = createAgent();
    const { helper, finishLoad } = mountSlowAgent({}, fake.agent);
    await finishLoad();
    vi.advanceTimersByTime(60000);

    await helper.identify({ timeout: 5000 });
    expect(fake.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 5000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes the time left alone without other options, and options @shieldlabs-ai/js rejects as they are', async () => {
    const fake = createAgent();
    const { shieldlabs, finishLoad } = mountSlowAgent({}, fake.agent);
    const calls = [
      shieldlabs.identify(),
      shieldlabs.identify(null as unknown as IdentifyOptions),
      shieldlabs.identify({ timeout: -1 }),
      shieldlabs.identify(USER_HID as unknown as IdentifyOptions),
    ];
    vi.advanceTimersByTime(1000);
    await finishLoad();
    await Promise.all(calls);
    expect(fake.identify.mock.calls).toEqual([[{ timeout: 9000 }], [{ timeout: 9000 }], [{ timeout: -1 }], [USER_HID]]);
  });

  it('with autoLoad: false, a call made after load() waits for the agent within its timeout', async () => {
    const fake = createAgent();
    const { helper, shieldlabs, finishLoad } = mountSlowAgent({ autoLoad: false }, fake.agent);
    vi.advanceTimersByTime(3000);
    shieldlabs.load();
    const call = helper.identify({ timeout: 8000 });

    vi.advanceTimersByTime(2000);
    await finishLoad();
    expect(fake.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 6000 });
    await expect(call).resolves.toMatchObject({ userId: USER_HID });
  });

  it('with autoLoad: false, fails fast before load(): no timer starts and nothing loads', async () => {
    const fake = createAgent();
    const { helper, shieldlabs } = mountSlowAgent({ autoLoad: false }, fake.agent);
    const fromHelper = helper.identify();
    const fromState = expect(shieldlabs.identify({ timeout: 2000 })).rejects.toMatchObject({ code: 'not_initialized' });
    const fromCheck = expect(shieldlabs.check({ timeout: 2000 })).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // All three settle without the clock moving.
    await expect(fromHelper).resolves.toBeNull();
    expect(helper.error.value).toMatchObject({
      code: 'not_initialized',
      message: 'The ShieldLabs agent is not loaded. With autoLoad: false it loads once load() is called.',
    });
    await fromState;
    await fromCheck;
    expect(mockedLoad).not.toHaveBeenCalled();
    expect(fake.identify).not.toHaveBeenCalled();
    expect(fake.check).not.toHaveBeenCalled();
  });

  it('with autoLoad: false, getAgent() waits for load() with no timeout of its own', async () => {
    const fake = createAgent();
    const { shieldlabs, finishLoad } = mountSlowAgent({ autoLoad: false, timeout: 1000 }, fake.agent);
    let settled = false;
    const agent = shieldlabs.getAgent().finally(() => {
      settled = true;
    });
    expect(vi.getTimerCount()).toBe(0);

    // Far beyond the plugin timeout, before and after load().
    vi.advanceTimersByTime(60000);
    await flushPromises();
    expect(settled).toBe(false);
    shieldlabs.load();
    vi.advanceTimersByTime(60000);
    await flushPromises();
    expect(settled).toBe(false);

    await finishLoad();
    await expect(agent).resolves.toBe(fake.agent);
  });

  it('stops counting a call that ended as in flight, so checkOnLoad runs', async () => {
    const fake = createBusyAgent();
    const { helper, finishLoad } = mountSlowAgent({ checkOnLoad: { userId: USER_HID } }, fake.agent);
    const call = helper.identify({ timeout: 1000 });
    vi.advanceTimersByTime(1000);
    await expect(call).resolves.toBeNull();

    await finishLoad();
    expect(fake.calls).toEqual(['check:' + USER_HID]);
  });
});
