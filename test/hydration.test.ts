// Hydration of server HTML in the browser. The agent can become ready before a lazy component
// hydrates; the component's first render must still match the server HTML.
import { load, type ShieldLabsAgent } from '@shieldlabs-ai/js';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineAsyncComponent, defineComponent, h, type Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createShieldLabs, useIdentify, useShieldLabs } from '../src/index';
import { createAgent, deferred, PUBLIC_KEY } from './support/agent';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs-ai/js')>();
  return { ...actual, load: vi.fn() };
});

const mockedLoad = vi.mocked(load);

const SERVER_HTML = '<main><p data-busy="false">loading</p></main>';

const Status = defineComponent({
  setup() {
    const { status } = useShieldLabs();
    const { isLoading } = useIdentify();
    return () => h('p', { 'data-busy': String(isLoading.value) }, status.value);
  },
});

function page(lazy: () => Promise<Component>): Component {
  const Lazy = defineAsyncComponent(lazy);
  return { render: () => h('main', [h(Lazy)]) };
}

/** The DOM a browser builds from SERVER_HTML, created node by node. */
function serverDom(): HTMLElement {
  const container = document.createElement('div');
  const main = document.createElement('main');
  const paragraph = document.createElement('p');
  paragraph.setAttribute('data-busy', 'false');
  paragraph.textContent = 'loading';
  main.append(paragraph);
  container.append(main);
  return container;
}

describe('hydration', () => {
  it('matches the server HTML when the agent is ready before a lazy component hydrates', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');

    const html = await renderToString(
      createSSRApp(page(() => Promise.resolve(Status))).use(createShieldLabs({ publicKey: PUBLIC_KEY })),
    );
    expect(html).toBe(SERVER_HTML);
    expect(mockedLoad).not.toHaveBeenCalled();

    const agentReady = deferred<ShieldLabsAgent>();
    mockedLoad.mockReturnValue(agentReady.promise);
    const chunk = deferred<Component>();
    const container = serverDom();
    const paragraph = container.querySelector('p');
    const app = createSSRApp(page(() => chunk.promise)).use(createShieldLabs({ publicKey: PUBLIC_KEY }));
    app.mount(container);
    expect(mockedLoad).toHaveBeenCalledTimes(1);

    // The agent is ready first, then the code of the lazy component arrives.
    agentReady.resolve(createAgent().agent);
    await flushPromises();
    chunk.resolve(Status);
    await flushPromises();

    // Hydration kept the server element and only then showed the app status.
    expect(container.querySelector('p')).toBe(paragraph);
    expect(paragraph?.textContent).toBe('ready');
    expect(paragraph?.getAttribute('data-busy')).toBe('false');
    const logged = [...warn.mock.calls, ...error.mock.calls].map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).not.toMatch(/mismatch/i);
    app.unmount();
  });
});
