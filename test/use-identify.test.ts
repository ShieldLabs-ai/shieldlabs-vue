import { load, ShieldLabsError, type IdentifyOptions, type IdentifyResult, type ShieldLabsAgent } from '@shieldlabs-ai/js';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, defineComponent, h, isProxy, nextTick, shallowRef, type App } from 'vue';
import {
  createShieldLabs,
  shieldLabsKey,
  useIdentify,
  useShieldLabs,
  type ShieldLabsContext,
  type ShieldLabsOptions,
  type UseIdentifyOptions,
  type UseIdentifyReturn,
} from '../src/index';
import { createAgent, deferred, PUBLIC_KEY, USER_HID } from './support/agent';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs-ai/js')>();
  return { ...actual, load: vi.fn() };
});

const mockedLoad = vi.mocked(load);
const OTHER_HID = '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae';
const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  vi.useRealTimers();
});

/** Renders the refs of useIdentify() as "<busy|idle> <requestId|-> <error code|->". */
function describeState(api: UseIdentifyReturn): string {
  return [api.isLoading.value ? 'busy' : 'idle', api.result.value?.requestId ?? '-', api.error.value?.code ?? '-'].join(' ');
}

function mountIdentify(options?: UseIdentifyOptions, pluginOptions: Partial<ShieldLabsOptions> = {}) {
  let api!: UseIdentifyReturn;
  const label = shallowRef('signup');
  const View = defineComponent({
    setup() {
      api = useIdentify(options);
      return () => h('p', label.value + ' ' + describeState(api));
    },
  });
  const app = createApp(View).use(createShieldLabs({ publicKey: PUBLIC_KEY, ...pluginOptions }));
  const element = document.createElement('div');
  app.mount(element);
  apps.push(app);
  return { api, element, app, label };
}

function withAgent() {
  const fake = createAgent();
  mockedLoad.mockResolvedValue(fake.agent);
  return fake;
}

/** A stand-in context provided under `shieldLabsKey`: `ready`, with the given `identify()`. */
function standIn(identify: ShieldLabsContext['identify']): ShieldLabsContext {
  return {
    status: shallowRef('ready' as const),
    error: shallowRef(null),
    identify,
    check: vi.fn(() => Promise.resolve(null)),
    load: vi.fn(),
    getAgent: vi.fn(() => Promise.reject(new ShieldLabsError('load_failed', 'No agent in this test.'))),
  };
}

describe('useIdentify()', () => {
  it('throws a clear error when the plugin is missing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const View = defineComponent({
      setup() {
        useIdentify();
        return () => null;
      },
    });
    expect(() => mount(View)).toThrowError(/useIdentify\(\) found no ShieldLabs plugin/);
  });

  it('identify() resolves the result and updates the refs', async () => {
    const fake = withAgent();
    const answer = deferred<IdentifyResult>();
    fake.identify.mockReturnValueOnce(answer.promise);
    const { api, element } = mountIdentify();
    await flushPromises();
    expect(element.textContent).toBe('signup idle - -');

    const call = api.identify();
    expect(api.isLoading.value).toBe(true);
    await flushPromises();
    expect(element.textContent).toBe('signup busy - -');

    const value = { requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a', userId: null };
    answer.resolve(value);
    await expect(call).resolves.toEqual(value);
    await nextTick();
    expect(api.result.value).toEqual(value);
    expect(element.textContent).toBe('signup idle 6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a -');
  });

  it('identify() resolves null and sets error when there is no identification', async () => {
    const fake = withAgent();
    const failure = new ShieldLabsError('not_initialized', 'The agent did not start an identification.');
    fake.identify.mockResolvedValueOnce({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a', userId: null });
    fake.identify.mockRejectedValueOnce(failure);
    const { api } = mountIdentify();

    await api.identify();
    expect(api.result.value).not.toBeNull();
    // A new call clears the previous result: one request ID per protected action.
    await expect(api.identify()).resolves.toBeNull();
    expect(api.error.value).toBe(failure);
    expect(api.result.value).toBeNull();
    expect(api.isLoading.value).toBe(false);
  });

  it('identify() resolves null with the load error when the agent cannot load', async () => {
    mockedLoad.mockRejectedValue(new ShieldLabsError('load_failed', 'blocked'));
    const { api } = mountIdentify();
    await expect(api.identify()).resolves.toBeNull();
    expect(api.error.value).toMatchObject({ code: 'load_failed' });
  });

  it('reads userId from a string, a ref or a getter when identify() runs', async () => {
    const fake = withAgent();
    const hid = shallowRef<string | undefined>(undefined);

    // Each app waits for its agent first, so the calls pass their options to the agent as they are.
    const fromRef = mountIdentify({ userId: hid }).api;
    await flushPromises();
    await fromRef.identify();
    expect(fake.identify).toHaveBeenLastCalledWith({});
    hid.value = USER_HID;
    await nextTick();
    // Changing userId never starts an identification.
    expect(fake.identify).toHaveBeenCalledTimes(1);
    await fromRef.identify();
    expect(fake.identify).toHaveBeenLastCalledWith({ userId: USER_HID });

    const fromGetter = mountIdentify({ userId: () => hid.value }).api;
    const fromComputed = mountIdentify({ userId: computed(() => hid.value) }).api;
    const fromString = mountIdentify({ userId: OTHER_HID }).api;
    await flushPromises();
    await fromGetter.identify();
    expect(fake.identify).toHaveBeenLastCalledWith({ userId: USER_HID });

    await fromComputed.identify();
    expect(fake.identify).toHaveBeenLastCalledWith({ userId: USER_HID });

    await fromString.identify();
    expect(fake.identify).toHaveBeenLastCalledWith({ userId: OTHER_HID });
    await expect(fromString.identify()).resolves.toMatchObject({ userId: OTHER_HID });
  });

  it('treats a null userId as anonymous', async () => {
    const fake = withAgent();
    const { api } = mountIdentify({ userId: shallowRef<string | null>(null) });
    await flushPromises();
    await expect(api.identify()).resolves.toMatchObject({ userId: null });
    expect(fake.identify).toHaveBeenLastCalledWith({});
  });

  it('lets identify() options override userId and add a timeout', async () => {
    const fake = withAgent();
    const { api } = mountIdentify({ userId: USER_HID });
    await flushPromises();

    await api.identify({ userId: OTHER_HID });
    expect(fake.identify).toHaveBeenLastCalledWith({ userId: OTHER_HID });
    await api.identify({ userId: undefined });
    expect(fake.identify).toHaveBeenLastCalledWith({});
    // null from plain JavaScript is anonymous as well, and no null reaches the agent.
    await expect(api.identify({ userId: null as unknown as string })).resolves.toMatchObject({ userId: null });
    expect(fake.identify).toHaveBeenLastCalledWith({});
    await api.identify({ timeout: 3000 });
    expect(fake.identify).toHaveBeenLastCalledWith({ userId: USER_HID, timeout: 3000 });
    await api.identify(null as unknown as IdentifyOptions);
    expect(fake.identify).toHaveBeenLastCalledWith({ userId: USER_HID });
  });

  it('works as a template event handler: the event is not taken for options', async () => {
    const fake = withAgent();
    const Form = defineComponent({
      setup() {
        const { identify, result } = useIdentify({ userId: USER_HID });
        return () =>
          h('form', { onSubmit: identify }, [h('output', result.value?.requestId ?? '-'), h('button', { type: 'submit' }, 'Sign up')]);
      },
    });
    const wrapper = mount(Form, { global: { plugins: [createShieldLabs({ publicKey: PUBLIC_KEY })] } });
    await flushPromises();
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(1);
    expect(fake.identify).toHaveBeenCalledWith({ userId: USER_HID });
    expect(wrapper.find('output').text()).toMatch(/^[0-9a-f-]{36}$/);
    wrapper.unmount();
  });

  it('hands a value that is not an options object to @shieldlabs-ai/js and never throws', async () => {
    const fake = withAgent();
    // @shieldlabs-ai/js rejects such options with invalid_options.
    fake.identify.mockImplementationOnce((options?: unknown) =>
      typeof options === 'object'
        ? Promise.resolve({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a', userId: null })
        : Promise.reject(new ShieldLabsError('invalid_options', 'options must be an object.')),
    );
    const { api } = mountIdentify({ userId: USER_HID });

    let call: Promise<IdentifyResult | null> | undefined;
    expect(() => {
      call = api.identify(USER_HID as unknown as IdentifyOptions);
    }).not.toThrow();
    await expect(call).resolves.toBeNull();
    expect(fake.identify).toHaveBeenLastCalledWith(USER_HID);
    expect(api.error.value).toMatchObject({ code: 'invalid_options' });

    // The rejected call is not shared with the next one.
    await expect(api.identify()).resolves.toMatchObject({ userId: USER_HID });
    expect(fake.identify).toHaveBeenCalledTimes(2);
  });

  it('never throws, even when a stand-in context throws synchronously', async () => {
    const stub = standIn(() => {
      throw new Error('not a promise');
    });
    let api!: UseIdentifyReturn;
    const View = defineComponent({
      setup() {
        api = useIdentify();
        return () => h('p', describeState(api));
      },
    });
    const wrapper = mount(View, { global: { provide: { [shieldLabsKey as symbol]: stub } } });
    let call: Promise<IdentifyResult | null> | undefined;
    expect(() => {
      call = api.identify();
    }).not.toThrow();
    await expect(call).resolves.toBeNull();
    expect(api.error.value).toMatchObject({ code: 'not_initialized', cause: new Error('not a promise') });
    wrapper.unmount();
  });

  it('shares one identification between identical calls that overlap (a double click)', async () => {
    const fake = withAgent();
    const answer = deferred<IdentifyResult>();
    fake.identify.mockReturnValueOnce(answer.promise);
    const { api } = mountIdentify({ userId: USER_HID });

    const first = api.identify();
    const second = api.identify();
    expect(second).toBe(first);
    answer.resolve({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a', userId: USER_HID });
    await expect(second).resolves.toMatchObject({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a' });
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(1);

    // Once it has finished, the next call is a new identification.
    await api.identify();
    expect(fake.identify).toHaveBeenCalledTimes(2);
  });

  it('shares only calls with the same userId and timeout', async () => {
    const fake = withAgent();
    const { api } = mountIdentify({ userId: USER_HID });
    await flushPromises();
    const answers = [deferred<IdentifyResult>(), deferred<IdentifyResult>(), deferred<IdentifyResult>()] as const;
    for (const answer of answers) fake.identify.mockReturnValueOnce(answer.promise);

    const base = api.identify();
    const otherUser = api.identify({ userId: OTHER_HID });
    const otherTimeout = api.identify({ timeout: 5000 });
    expect(new Set([base, otherUser, otherTimeout]).size).toBe(3);
    expect(fake.identify.mock.calls).toEqual([[{ userId: USER_HID }], [{ userId: OTHER_HID }], [{ userId: USER_HID, timeout: 5000 }]]);

    // The same keys again while all three are in flight: each returns its running call.
    expect(api.identify({ timeout: 5000 })).toBe(otherTimeout);
    expect(api.identify({ userId: OTHER_HID })).toBe(otherUser);
    expect(api.identify({ userId: USER_HID })).toBe(base);
    expect(fake.identify).toHaveBeenCalledTimes(3);

    answers[0].resolve({ requestId: '11111111-1111-4111-8111-111111111111', userId: USER_HID });
    answers[1].resolve({ requestId: '22222222-2222-4222-8222-222222222222', userId: OTHER_HID });
    answers[2].resolve({ requestId: '33333333-3333-4333-8333-333333333333', userId: USER_HID });
    await expect(Promise.all([base, otherUser, otherTimeout])).resolves.toMatchObject([
      { requestId: '11111111-1111-4111-8111-111111111111' },
      { requestId: '22222222-2222-4222-8222-222222222222' },
      { requestId: '33333333-3333-4333-8333-333333333333' },
    ]);
    // The refs show the call the latest identify() returned.
    expect(api.result.value).toMatchObject({ requestId: '11111111-1111-4111-8111-111111111111' });
  });

  it('keys on the effective userId: undefined or null in the call options is an anonymous call', async () => {
    const fake = withAgent();
    const { api } = mountIdentify({ userId: USER_HID });
    await flushPromises();
    fake.identify.mockReturnValue(deferred<IdentifyResult>().promise);

    const forUser = api.identify();
    const anonymous = api.identify({ userId: undefined });
    // The call options override the userId of the composable: an anonymous identification.
    expect(anonymous).not.toBe(forUser);
    expect(api.identify({ userId: null as unknown as string })).toBe(anonymous);
    // Only options without the key use the userId of the composable.
    expect(api.identify({})).toBe(forUser);
    expect(fake.identify.mock.calls).toEqual([[{ userId: USER_HID }], [{}]]);
  });

  it('counts a call without timeout as one with the plugin timeout, 10 seconds by default', async () => {
    const fake = withAgent();
    const byDefault = mountIdentify({ userId: USER_HID }).api;
    const configured = mountIdentify({ userId: USER_HID }, { timeout: 5000 }).api;
    await flushPromises();
    const answers = [deferred<IdentifyResult>(), deferred<IdentifyResult>(), deferred<IdentifyResult>()] as const;
    for (const answer of answers) fake.identify.mockReturnValueOnce(answer.promise);

    const first = byDefault.identify();
    expect(byDefault.identify({ timeout: 10000 })).toBe(first);
    const second = configured.identify({ timeout: 5000 });
    expect(configured.identify()).toBe(second);
    // 10 seconds is not the timeout of this plugin: another identification.
    const third = configured.identify({ timeout: 10000 });
    expect(third).not.toBe(second);
    // What the agent receives does not change: an omitted timeout stays omitted.
    expect(fake.identify.mock.calls).toEqual([
      [{ userId: USER_HID }],
      [{ userId: USER_HID, timeout: 5000 }],
      [{ userId: USER_HID, timeout: 10000 }],
    ]);

    answers[0].resolve({ requestId: '11111111-1111-4111-8111-111111111111', userId: USER_HID });
    answers[1].resolve({ requestId: '22222222-2222-4222-8222-222222222222', userId: USER_HID });
    answers[2].resolve({ requestId: '33333333-3333-4333-8333-333333333333', userId: USER_HID });
    await expect(Promise.all([first, second, third])).resolves.toMatchObject([
      { requestId: '11111111-1111-4111-8111-111111111111' },
      { requestId: '22222222-2222-4222-8222-222222222222' },
      { requestId: '33333333-3333-4333-8333-333333333333' },
    ]);
  });

  it('gives only an omitted timeout the default: a call with an invalid timeout is not shared', async () => {
    const fake = withAgent();
    const { api } = mountIdentify({ userId: USER_HID });
    await flushPromises();
    fake.identify.mockReturnValueOnce(deferred<IdentifyResult>().promise);
    // @shieldlabs-ai/js rejects such a timeout.
    fake.identify.mockRejectedValueOnce(new ShieldLabsError('invalid_options', 'timeout must be a number of milliseconds above 0.'));

    const running = api.identify();
    const invalid = api.identify({ timeout: null as unknown as number });
    expect(invalid).not.toBe(running);
    await expect(invalid).resolves.toBeNull();
    expect(api.error.value).toMatchObject({ code: 'invalid_options' });
    expect(fake.identify.mock.calls).toEqual([[{ userId: USER_HID }], [{ userId: USER_HID, timeout: null }]]);
  });

  it('counts a call without timeout as a 10 second call with a stand-in context', async () => {
    const answer = deferred<IdentifyResult>();
    const identify = vi.fn(() => answer.promise);
    const stub = standIn(identify);
    let api!: UseIdentifyReturn;
    const View = defineComponent({
      setup() {
        api = useIdentify();
        return () => h('p', describeState(api));
      },
    });
    const wrapper = mount(View, { global: { provide: { [shieldLabsKey as symbol]: stub } } });

    const first = api.identify({ timeout: 10000 });
    expect(api.identify()).toBe(first);
    expect(identify).toHaveBeenCalledTimes(1);
    answer.resolve({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a', userId: null });
    await expect(first).resolves.toMatchObject({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a' });
    wrapper.unmount();
  });

  it('shares calls within one helper only: another helper starts its own identification', async () => {
    const fake = withAgent();
    let checkout!: UseIdentifyReturn;
    let payment!: UseIdentifyReturn;
    const View = defineComponent({
      setup() {
        checkout = useIdentify({ userId: USER_HID });
        payment = useIdentify({ userId: USER_HID });
        return () => h('p', describeState(checkout) + ' / ' + describeState(payment));
      },
    });
    const app = createApp(View).use(createShieldLabs({ publicKey: PUBLIC_KEY }));
    app.mount(document.createElement('div'));
    apps.push(app);
    await flushPromises();
    fake.identify.mockReturnValueOnce(deferred<IdentifyResult>().promise);

    const fromCheckout = checkout.identify();
    const fromPayment = payment.identify();
    expect(fromPayment).not.toBe(fromCheckout);
    expect(checkout.identify()).toBe(fromCheckout);
    expect(fake.identify).toHaveBeenCalledTimes(2);
    await expect(fromPayment).resolves.toMatchObject({ userId: USER_HID });
  });

  it('returns any identical call still in flight, not only the latest, and the refs follow it', async () => {
    const fake = withAgent();
    const { api } = mountIdentify({ userId: USER_HID });
    await flushPromises();
    const forUser = deferred<IdentifyResult>();
    fake.identify.mockReturnValueOnce(forUser.promise);

    const first = api.identify();
    await api.identify({ userId: OTHER_HID });
    expect(api.result.value).toMatchObject({ userId: OTHER_HID });

    // The first identification still runs: a double submit for it returns it and shows it again.
    const again = api.identify();
    expect(again).toBe(first);
    expect(api.isLoading.value).toBe(true);
    expect(api.result.value).toBeNull();

    forUser.resolve({ requestId: '11111111-1111-4111-8111-111111111111', userId: USER_HID });
    await expect(again).resolves.toMatchObject({ requestId: '11111111-1111-4111-8111-111111111111' });
    expect(api.result.value).toMatchObject({ requestId: '11111111-1111-4111-8111-111111111111' });
    expect(api.isLoading.value).toBe(false);
    expect(fake.identify).toHaveBeenCalledTimes(2);
  });

  it('keys on the userId of the composable when identify() runs', async () => {
    const fake = withAgent();
    const hid = shallowRef<string | undefined>(USER_HID);
    const { api } = mountIdentify({ userId: hid });
    await flushPromises();
    fake.identify.mockReturnValueOnce(deferred<IdentifyResult>().promise);

    const forUser = api.identify();
    hid.value = OTHER_HID;
    const forOther = api.identify();
    expect(forOther).not.toBe(forUser);
    expect(fake.identify.mock.calls).toEqual([[{ userId: USER_HID }], [{ userId: OTHER_HID }]]);
    await expect(forOther).resolves.toMatchObject({ userId: OTHER_HID });
  });

  it('lets the latest call own the refs when overlapping calls differ', async () => {
    const fake = withAgent();
    const forUser = deferred<IdentifyResult>();
    const forOther = deferred<IdentifyResult>();
    fake.identify.mockReturnValueOnce(forUser.promise).mockReturnValueOnce(forOther.promise);
    const { api } = mountIdentify({ userId: USER_HID });

    const first = api.identify();
    const second = api.identify({ userId: OTHER_HID });
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(2);

    // The older call finishing first does not touch the refs.
    forUser.resolve({ requestId: '11111111-1111-4111-8111-111111111111', userId: USER_HID });
    await expect(first).resolves.toMatchObject({ userId: USER_HID });
    expect(api.isLoading.value).toBe(true);
    expect(api.result.value).toBeNull();

    forOther.resolve({ requestId: '22222222-2222-4222-8222-222222222222', userId: OTHER_HID });
    await expect(second).resolves.toMatchObject({ userId: OTHER_HID });
    expect(api.result.value).toMatchObject({ userId: OTHER_HID });
    expect(api.isLoading.value).toBe(false);

    // A stale failure is ignored as well.
    const late = deferred<IdentifyResult>();
    fake.identify.mockReturnValueOnce(late.promise);
    const third = api.identify();
    await api.identify({ userId: OTHER_HID });
    late.reject(new ShieldLabsError('timeout', 'The agent did not answer within 10000 ms.'));
    await expect(third).resolves.toBeNull();
    expect(api.error.value).toBeNull();
    expect(api.result.value).toMatchObject({ userId: OTHER_HID });
  });

  it('reset() clears the refs; a running call no longer updates them', async () => {
    const fake = withAgent();
    const answer = deferred<IdentifyResult>();
    fake.identify.mockReturnValueOnce(answer.promise);
    const { api } = mountIdentify();

    const running = api.identify();
    expect(api.isLoading.value).toBe(true);
    api.reset();
    expect(api.isLoading.value).toBe(false);

    answer.resolve({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a', userId: null });
    await expect(running).resolves.toMatchObject({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a' });
    expect(api.result.value).toBeNull();
    expect(api.error.value).toBeNull();
    expect(api.isLoading.value).toBe(false);

    fake.identify.mockRejectedValueOnce(new ShieldLabsError('timeout', 'The agent did not answer within 10000 ms.'));
    await api.identify();
    expect(api.error.value).toMatchObject({ code: 'timeout' });
    api.reset();
    expect(api.error.value).toBeNull();
  });

  it('after reset(), an identical call still returns the identification in flight', async () => {
    const fake = withAgent();
    const answer = deferred<IdentifyResult>();
    fake.identify.mockReturnValueOnce(answer.promise);
    const { api } = mountIdentify({ userId: USER_HID });

    const running = api.identify();
    api.reset();
    expect(api.isLoading.value).toBe(false);

    // The agent runs one identification at a time for a User HID: a second one would be refused.
    const again = api.identify();
    expect(again).toBe(running);
    expect(api.isLoading.value).toBe(true);
    answer.resolve({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a', userId: USER_HID });
    await expect(again).resolves.toMatchObject({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a' });
    expect(api.result.value).toMatchObject({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a' });
    expect(api.isLoading.value).toBe(false);
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(1);
  });

  it('exposes the result and the error objects themselves in read-only refs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = withAgent();
    const failure = new ShieldLabsError('timeout', 'The agent did not answer within 10000 ms.');
    fake.identify.mockRejectedValueOnce(failure);
    const { api } = mountIdentify();

    await api.identify();
    expect(api.error.value).toBe(failure);

    // The object @shieldlabs-ai/js returned, so it can go to postMessage(), BroadcastChannel or
    // IndexedDB as it is.
    const value = await api.identify();
    expect(value).not.toBeNull();
    expect(api.result.value).toBe(value);
    expect(isProxy(api.result.value)).toBe(false);

    (api.result as { value: unknown }).value = null;
    (api.isLoading as { value: boolean }).value = true;
    expect(api.result.value).toBe(value);
    expect(api.isLoading.value).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('runOnMount identifies once after mount, not on re-render', async () => {
    const fake = withAgent();
    let identifiedDuringSetup = true;
    const View = defineComponent({
      setup() {
        const api = useIdentify({ runOnMount: true });
        identifiedDuringSetup = fake.identify.mock.calls.length > 0 || api.isLoading.value;
        return () => h('p', describeState(api));
      },
    });
    const label = shallowRef(0);
    const Root = defineComponent({
      setup() {
        return () => h('div', { 'data-tick': label.value }, [h(View)]);
      },
    });
    const app = createApp(Root).use(createShieldLabs({ publicKey: PUBLIC_KEY }));
    const element = document.createElement('div');
    app.mount(element);
    apps.push(app);
    expect(identifiedDuringSetup).toBe(false);
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(1);
    expect(element.textContent).toMatch(/^idle [0-9a-f-]{36} -$/);

    label.value += 1;
    await flushPromises();
    label.value += 1;
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(1);
  });

  it('runOnMount waits until the agent is ready, within one timeout', async () => {
    vi.useFakeTimers();
    const pending = deferred<ShieldLabsAgent>();
    mockedLoad.mockReturnValue(pending.promise);
    const { agent, identify } = createAgent();
    const { api } = mountIdentify({ runOnMount: true, userId: USER_HID });
    await flushPromises();
    expect(api.isLoading.value).toBe(true);
    expect(identify).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    pending.resolve(agent);
    await flushPromises();
    expect(identify).toHaveBeenCalledTimes(1);
    // The wait counts: the agent gets what is left of the 10 second default.
    expect(identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 8500 });
    expect(api.result.value).toMatchObject({ userId: USER_HID });
  });

  it('does not identify on mount by default', async () => {
    const fake = withAgent();
    mountIdentify();
    await flushPromises();
    expect(fake.identify).not.toHaveBeenCalled();
    expect(fake.check).not.toHaveBeenCalled();
  });

  it('runOnMount outside a component identifies right away', async () => {
    const fake = withAgent();
    const app = createApp({ render: () => null }).use(createShieldLabs({ publicKey: PUBLIC_KEY }));
    const api = app.runWithContext(() => useIdentify({ runOnMount: true }));
    await flushPromises();
    expect(fake.identify).toHaveBeenCalledTimes(1);
    expect(api.result.value).not.toBeNull();
    expect(app.runWithContext(() => useIdentify()).isLoading.value).toBe(false);
  });

  it('runOnMount outside a component before load() with autoLoad: false ends with not_initialized and does not run again', async () => {
    const fake = withAgent();
    const app = createApp({ render: () => null }).use(createShieldLabs({ publicKey: PUBLIC_KEY, autoLoad: false }));
    const api = app.runWithContext(() => useIdentify({ runOnMount: true }));
    await flushPromises();
    expect(api.error.value).toBeInstanceOf(ShieldLabsError);
    expect(api.error.value).toMatchObject({ code: 'not_initialized' });
    expect(api.isLoading.value).toBe(false);
    expect(api.result.value).toBeNull();
    expect(mockedLoad).not.toHaveBeenCalled();

    app.runWithContext(() => useShieldLabs()).load();
    await flushPromises();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(fake.identify).not.toHaveBeenCalled();
    expect(api.error.value).toMatchObject({ code: 'not_initialized' });
  });

  it('works with a stand-in context provided under shieldLabsKey', async () => {
    const stub = standIn(vi.fn(() => Promise.reject(new Error('backend unavailable'))));
    let api!: UseIdentifyReturn;
    let status = '';
    const View = defineComponent({
      setup() {
        api = useIdentify();
        const shieldlabs = useShieldLabs();
        return () => {
          status = shieldlabs.status.value;
          return h('p', describeState(api));
        };
      },
    });
    const wrapper = mount(View, { global: { provide: { [shieldLabsKey as symbol]: stub } } });
    await flushPromises();
    expect(status).toBe('ready');
    await expect(api.identify()).resolves.toBeNull();
    // Anything that is not a ShieldLabsError is wrapped, with the original as `cause`.
    expect(api.error.value).toBeInstanceOf(ShieldLabsError);
    expect(api.error.value).toMatchObject({ code: 'not_initialized', cause: new Error('backend unavailable') });
    expect(mockedLoad).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
