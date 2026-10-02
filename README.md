# @shieldlabs-ai/vue

Vue 3 and Nuxt bindings for ShieldLabs device intelligence: a plugin that loads the agent once and
composables that return a request ID with loading and error state.

[![CI](https://github.com/ShieldLabs-ai/shieldlabs-vue/actions/workflows/ci.yml/badge.svg)](https://github.com/ShieldLabs-ai/shieldlabs-vue/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@shieldlabs-ai/vue)](https://www.npmjs.com/package/@shieldlabs-ai/vue)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

`@shieldlabs-ai/vue` builds on [`@shieldlabs-ai/js`](https://github.com/ShieldLabs-ai/shieldlabs-js), the
browser loader that imports the hosted ShieldLabs agent from `https://cdn.shieldlabs.ai` at
runtime. It adds a Vue plugin, composables with refs, and safe server-side rendering for Vue SSR
and Nuxt 3.

New to ShieldLabs? [Start free](https://app.shieldlabs.ai), then copy the Public Key of your domain
from Integration > API keys in the analytics dashboard (the Install tab also shows a ready snippet
that contains it).

## How it fits

1. **Browser.** `@shieldlabs-ai/vue` loads the agent and runs an identification. Your component
   receives a `requestId`.
2. **Your backend.** It receives the `requestId` with the protected action (signup, login,
   checkout) and reads the verdict for it from the History API with a ShieldLabs server SDK, or
   receives it in a signed `identification.scored` webhook.
3. **Decision.** Your backend acts on the Risk Score (bands: trusted 0-29, suspicious 30-59,
   dangerous 60-100), the detection flags and identifiers such as the device ID.

The browser only ever gets the request ID. The Risk Score, risk signals, detection flags, visitor ID
and device ID are read on your server.

Webhooks: today each identification is delivered once, with a 1 second timeout and no retries.
Make your webhook handler idempotent on `data.request_id`, because future retries will resend
identical bytes, and read the History API when you need a guaranteed result.

## Install

```bash
npm install @shieldlabs-ai/vue @shieldlabs-ai/js
# or
yarn add @shieldlabs-ai/vue @shieldlabs-ai/js
# or
pnpm add @shieldlabs-ai/vue @shieldlabs-ai/js
```

`vue` (3.3 or later) and `@shieldlabs-ai/js` are peer dependencies: your app provides one copy of each.

## Quick start

Install the plugin once:

```ts
// src/main.ts
import { createShieldLabs } from '@shieldlabs-ai/vue';
import { createApp } from 'vue';
import App from './App.vue';

createApp(App)
  .use(createShieldLabs({ publicKey: import.meta.env.VITE_SHIELDLABS_PUBLIC_KEY }))
  .mount('#app');
```

Identify when the user submits a protected form, and send the `requestId` with the request:

```vue
<script setup lang="ts">
import { useIdentify } from '@shieldlabs-ai/vue';
import { ref } from 'vue';

const email = ref('');
const { identify, isLoading } = useIdentify();

async function onSubmit() {
  const result = await identify(); // null when there is no identification
  await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.value, requestId: result?.requestId ?? null }),
  });
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <input v-model="email" type="email" required />
    <button :disabled="isLoading">Sign up</button>
  </form>
</template>
```

On your server, read the verdict for `requestId` with a ShieldLabs server SDK, for example
`identifications.get(requestId)` in [`@shieldlabs-ai/node`](https://github.com/ShieldLabs-ai/shieldlabs-node),
which waits until the identification has been scored. The History row appears about 1-3 seconds
after `identify()` resolves and can be refined for up to about 10 seconds as follow-up checks
finish. To keep that wait off the submit, start the identification when the user begins the action
(see [Start on the first interaction with the form](#start-on-the-first-interaction-with-the-form)).
Server SDKs:
[Node.js](https://github.com/ShieldLabs-ai/shieldlabs-node),
[Python](https://github.com/ShieldLabs-ai/shieldlabs-python),
[Go](https://github.com/ShieldLabs-ai/shieldlabs-go),
[PHP](https://github.com/ShieldLabs-ai/shieldlabs-php),
[Java](https://github.com/ShieldLabs-ai/shieldlabs-java) and
[.NET](https://github.com/ShieldLabs-ai/shieldlabs-dotnet).

> **Keep the page alive after `identify()` resolves.** The agent posts the identification right
> after it hands over the request ID. Send your request with `fetch()` as above, and start a full
> page navigation (`location.href = ...`, a classic form post) only after it has been sent.
> Client-side navigation with Vue Router keeps the page alive. Details:
> [`@shieldlabs-ai/js` Quick start](https://github.com/ShieldLabs-ai/shieldlabs-js#quick-start).

A complete app is in [`examples/vite`](examples/vite).

## Guide

### Protect a form with `useIdentify()`

`useIdentify()` gives each component its own identify helper:

- `identify(options?)` runs a fresh identification and resolves `{ requestId, userId }`, or `null`
  when there is no identification (the reason is in `error`). It never rejects, so your submit
  handler always goes on to send the protected action: test the resolved value for `null` instead
  of catching. Your backend treats a request without `requestId` as unverified (step-up or review),
  never as clean.
- `result`, `isLoading` and `error` are refs for the latest call; `reset()` clears them.

One identification authorizes one protected action. Call `identify()` for each submission and keep
the submit button disabled while `isLoading` is `true`, as in the Quick start. A new call clears
`result`. While a call with the same `userId` and `timeout` is in flight, `identify()` returns that
call instead of starting another identification, so a double submit costs one identification: the
agent runs one identification at a time for a User HID and would refuse the second one with
`not_initialized`. A call without `timeout` counts as one with the plugin's `timeout` (10 seconds by
default), so with the default `identify()` and `identify({ timeout: 10000 })` share one
identification. Calls are shared within one `useIdentify()` helper, also after `reset()`, which only
clears the refs. On the server, accept each request ID once and only within your freshness window
(the server SDK examples use 5 minutes).

### Signed-in users: pass a User HID

```vue
<script setup lang="ts">
import { useIdentify } from '@shieldlabs-ai/vue';

const props = defineProps<{ userHid: string }>(); // computed on your server
const { identify } = useIdentify({ userId: () => props.userHid });
</script>
```

`userId` accepts a string, a ref or a getter, and is read when `identify()` runs: changing it never
starts an identification. `null` and `undefined` mean anonymous. Compute the User HID on your
server from your account ID with a secret key, for example with the `userHid()` helper of the
server SDKs (HMAC-SHA256, 64 hex characters). Never pass a raw email address, phone number or
database ID. `@shieldlabs-ai/js` rejects the reserved values `"anonymous"`, `"fail"`, `"-1"` and
`"unknown"`, and warns once about values that look like an email address or contain `/`, `?`, `#`
or `%`, which are hard to search in the History API (see
[Signed-in users](https://github.com/ShieldLabs-ai/shieldlabs-js#signed-in-users-pass-a-user-hid)).

Options passed to `identify()` override the composable for that call: `identify({ userId: hid })`,
`identify({ userId: undefined })` for an anonymous identification, or `identify({ timeout: 5000 })`
for a shorter wait (milliseconds). The timeout bounds the whole call: the wait for the agent to load
and the agent's answer together. Without one, the plugin's `timeout` applies (10 seconds by
default). A call whose timeout ends before the agent is ready resolves `null` with a `timeout`
error and never reaches the agent.

### Identify once when a component mounts

`useIdentify({ runOnMount: true })` calls `identify()` once, after the component is mounted and the
agent is ready. Every identification is billed: use it in a component that mounts once per
protected flow (for example a checkout step), not in a layout or in a component that remounts on
every route change. With `autoLoad: false`, call `load()` before the component mounts (see
[Wait for consent](#wait-for-consent-with-autoload-false)); otherwise that identification ends right
away with `not_initialized`, like `identify()`, and it does not run again by itself after `load()`.

### Passive monitoring with `checkOnLoad`

```ts
app.use(createShieldLabs({ publicKey, checkOnLoad: true })); // anonymous visitor
app.use(createShieldLabs({ publicKey, checkOnLoad: { userId: hid } })); // signed-in user
```

`checkOnLoad` runs the agent's limited `check()` once, when the agent becomes ready. The agent runs
at most one such check per visit every five minutes, shared across tabs. The page does not need its
request ID: your backend sees the identification in the History API. For later background checks,
call `check()` from `useShieldLabs()`; it resolves `null` when the agent skipped the check.

The agent runs one identification at a time for a User HID, which shapes how the check fits in:

- When an `identify()` or `check()` for the same User HID is already in flight as the agent becomes
  ready (for example `runOnMount`, a submit while the agent loads, or the call that loads the agent
  again after a failed load), the plugin skips the check. That call identifies the visit, and a
  check sent ahead of it would make the agent refuse it. Calls for another User HID do not stop
  the check.
- While the check is in progress, an `identify()` for the same User HID can get `not_initialized`
  (`useIdentify()` resolves `null`). Use `checkOnLoad` on pages without an immediate protected
  action; on a signup, login or checkout page, the `identify()` on submit already covers the visit.

### Agent state with `useShieldLabs()`

```vue
<script setup lang="ts">
import { useShieldLabs } from '@shieldlabs-ai/vue';

const { status, error } = useShieldLabs();
</script>

<template>
  <p v-if="status === 'error'">Identification is unavailable ({{ error?.code }}). You can still sign up.</p>
</template>
```

- `status` is `'loading'`, `'ready'` or `'error'`. In a component it stays `'loading'` until the
  component is mounted, as during server-side rendering, so hydration always matches the server
  HTML.
- `error` is the `ShieldLabsError` of the last failed load, otherwise `null`. The next
  `identify()`, `check()`, `getAgent()` or `load()` loads the agent again.
- `identify(options?)` and `check(options?)` are the agent methods of `@shieldlabs-ai/js` and wait for
  the agent within their timeout. Unlike `useIdentify()`, this `identify()` rejects with a
  `ShieldLabsError` when there is no identification. With `autoLoad: false` they do not wait before
  `load()` is called: `identify()` rejects with `not_initialized` and `check()` resolves `null` right
  away.
- `load()` starts loading the agent now, unless it is loaded or loading, and loads again after a
  failed load. With `autoLoad: false` nothing loads before it (see
  [Wait for consent](#wait-for-consent-with-autoload-false)).
- `getAgent()` resolves the `@shieldlabs-ai/js` agent once it has loaded, for example for
  `identifyOnInteraction()` (see
  [Start on the first interaction with the form](#start-on-the-first-interaction-with-the-form)).
  It loads the agent when needed (with `autoLoad: false` it waits for `load()`, with no timeout of
  its own) and rejects with the `ShieldLabsError` of a failed load.

Nothing needs to wait for `'ready'`: `identify()` waits for the agent itself (with `autoLoad: false`,
once `load()` has been called).

### Nuxt 3

Add the Public Key to the public runtime config and set it with an environment variable:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      shieldlabsPublicKey: '', // NUXT_PUBLIC_SHIELDLABS_PUBLIC_KEY
    },
  },
});
```

```bash
# .env
NUXT_PUBLIC_SHIELDLABS_PUBLIC_KEY=0123456789abcdef0123456789abcdef
```

Install the plugin in the browser only, with a `.client` plugin file:

```ts
// plugins/shieldlabs.client.ts
import { createShieldLabs } from '@shieldlabs-ai/vue';

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();
  nuxtApp.vueApp.use(createShieldLabs({ publicKey: config.public.shieldlabsPublicKey }));
});
```

Use the composables in pages and components as in any Vue app. During server rendering they render
the initial state (`status` `'loading'`, no result) without the plugin and never load anything; in
the browser the plugin loads the agent once, after hydration.

```vue
<!-- pages/signup.vue -->
<script setup lang="ts">
import { useIdentify } from '@shieldlabs-ai/vue';

const email = ref('');
const { identify, isLoading } = useIdentify();

async function onSubmit() {
  const result = await identify();
  await $fetch('/api/signup', { method: 'POST', body: { email: email.value, requestId: result?.requestId ?? null } });
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <input v-model="email" type="email" required />
    <button :disabled="isLoading">Sign up</button>
  </form>
</template>
```

The matching server route reads the verdict with `@shieldlabs-ai/node`:

```ts
// server/api/signup.post.ts
import { ShieldLabs, evaluateIdentification } from '@shieldlabs-ai/node';

const shieldlabs = new ShieldLabs({ apiKey: process.env.SHIELDLABS_API_KEY! });
const usedRequestIds = new Set<string>(); // use a shared store such as Redis in production

export default defineEventHandler(async (event) => {
  const { requestId } = await readBody<{ email: string; requestId: string | null }>(event);
  const identification = requestId ? await shieldlabs.identifications.get(requestId) : null;
  const verdict = evaluateIdentification(identification, {
    isReplay: (id) => usedRequestIds.has(id), // your store of request IDs already used
  });
  if (!verdict.ok) throw createError({ statusCode: 403, statusMessage: 'Signup refused' });
  usedRequestIds.add(identification!.request_id);
  // Create the account.
});
```

### Server-side rendering and hydration

- Importing the package and installing the plugin on the server is safe: nothing touches `window`
  or `document` during setup or render.
- The plugin loads the agent in the browser after the app is mounted. The server renderer never
  mounts an app, so the server never loads the agent, and `runOnMount` and `checkOnLoad` run only
  in the browser.
- `status` is `'loading'` during server rendering and in the first render of every component, so
  hydration matches the server HTML even when a lazy component hydrates after the agent is ready.
- Without the plugin on the server (a client-only plugin, as in the Nuxt guide) the composables
  render the same initial state. Calling `identify()` there rejects with `unsupported_environment`
  (`useIdentify()` resolves `null` and sets `error`).
- On the server `load()` does nothing and `getAgent()` rejects with `unsupported_environment`, with
  or without the plugin.

### Wait for consent with `autoLoad: false`

The agent does not read your consent banner. Where your policy or applicable law requires consent
before identification, create the plugin with `autoLoad: false`. Nothing loads until you call
`load()` from `useShieldLabs()`, for example when the visitor accepts:

```ts
// src/main.ts
import { createShieldLabs, useShieldLabs } from '@shieldlabs-ai/vue';
import { createApp } from 'vue';
import App from './App.vue';

const app = createApp(App).use(
  createShieldLabs({ publicKey: import.meta.env.VITE_SHIELDLABS_PUBLIC_KEY, autoLoad: false }),
);
// A returning visitor who already gave consent (hasConsent() reads your consent storage). Call
// load() before mount(), so that identifications started on mount wait for the agent.
if (hasConsent()) app.runWithContext(() => useShieldLabs().load());
app.mount('#app');
```

```vue
<!-- ConsentBanner.vue -->
<script setup lang="ts">
import { useShieldLabs } from '@shieldlabs-ai/vue';

const { load } = useShieldLabs();

function accept() {
  saveConsent(); // your consent storage
  load();
}
</script>
```

Until `load()` is called, `status` stays `'loading'` and `getAgent()` waits for it, with no timeout
of its own. `identify()` and `check()` do not wait: `useIdentify()` resolves `null` right away with a
`not_initialized` error, so the protected action goes ahead unverified, and from `useShieldLabs()`,
`identify()` rejects with `not_initialized` and `check()` resolves `null`. A `runOnMount`
identification that starts then ends the same way, and `load()` does not start it again. Once
`load()` has been called, calls wait for the agent within their timeout as usual. `checkOnLoad` runs
once the agent is ready after `load()`. See
[Consent](https://github.com/ShieldLabs-ai/shieldlabs-js#consent) for the cookie ID the agent keeps.

### Start on the first interaction with the form

An identification takes a moment, and the agent posts it right after it hands over the request ID.
For a classic full-page form post, start the identification on the first interaction with the form
with `identifyOnInteraction()` of the agent from `getAgent()`. By the time the user submits, it has
normally finished, so the page can navigate right away:

```vue
<script setup lang="ts">
import { useShieldLabs, type InteractionIdentifier } from '@shieldlabs-ai/vue';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const form = ref<HTMLFormElement | null>(null);
const requestId = ref('');
const { getAgent } = useShieldLabs();
let identifier: InteractionIdentifier | undefined;
let unmounted = false;

onMounted(() => {
  getAgent()
    .then((agent) => {
      if (!unmounted && form.value) identifier = agent.identifyOnInteraction(form.value);
    })
    .catch(() => {
      // No agent: the form is posted without a requestId.
    });
});

onBeforeUnmount(() => {
  unmounted = true;
  identifier?.dispose();
});

async function onSubmit() {
  // The identification for this submission (none while the agent has not loaded); take() re-arms
  // for the next one.
  const result = await identifier?.take().catch(() => null);
  requestId.value = result?.requestId ?? '';
  await nextTick(); // the hidden field now holds the request ID
  form.value?.submit();
}
</script>

<template>
  <form ref="form" action="/signup" method="post" @submit.prevent="onSubmit">
    <input name="email" type="email" required />
    <input type="hidden" name="requestId" :value="requestId" />
    <button>Sign up</button>
  </form>
</template>
```

`getAgent()` resolves once the agent has loaded (with `autoLoad: false`, after `load()`), and the
plugin loads the agent only once. `take()` hands out the early identification only while it is
fresh and otherwise starts a new one, and `form.submit()` does not trigger the submit handler
again. If users can submit without interacting first (for example autofill and a single click),
prefer sending the form with `fetch()` as in the Quick start, which keeps the page alive. Details:
[Protect a form](https://github.com/ShieldLabs-ai/shieldlabs-js#protect-a-form).

### Test your components

Provide a stand-in context under `shieldLabsKey`, so component tests need no agent. With the form
from the Quick start in `SignupForm.vue`:

```ts
import { shieldLabsKey, type ShieldLabsContext, type ShieldLabsStatus } from '@shieldlabs-ai/vue';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import { ref } from 'vue';
import SignupForm from './SignupForm.vue';

it('sends the request ID with the signup', async () => {
  const identify = vi.fn(async () => ({ requestId: '6f1c2e8a-3b5d-4c7e-8f9a-0b1c2d3e4f5a', userId: null }));
  const shieldlabs: ShieldLabsContext = {
    status: ref<ShieldLabsStatus>('ready'),
    error: ref(null),
    identify,
    check: vi.fn(async () => null),
    load: vi.fn(),
    getAgent: vi.fn(() => Promise.reject(new Error('No agent in component tests.'))),
  };
  const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);

  const wrapper = mount(SignupForm, {
    global: { provide: { [shieldLabsKey as symbol]: shieldlabs } },
  });
  await wrapper.find('form').trigger('submit');
  await flushPromises();

  expect(identify).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/signup', expect.objectContaining({ method: 'POST' }));
});
```

### Call budget, Content Security Policy and consent

Every identification that runs is billed and uses part of a small per-IP ingest budget. Call
`identify()` once per protected action, never on every render or route change: the plugin and the
composables identify only when you call them, plus `runOnMount` and `checkOnLoad` when you turn
them on. Before going live, read these sections of the `@shieldlabs-ai/js` README:

- [Call budget](https://github.com/ShieldLabs-ai/shieldlabs-js#call-budget): limits per visitor IP
  and the agent's own background checks.
- [Content Security Policy](https://github.com/ShieldLabs-ai/shieldlabs-js#content-security-policy):
  the `script-src` and `connect-src` origins the agent needs.
- [Consent](https://github.com/ShieldLabs-ai/shieldlabs-js#consent): the agent's first-party cookie
  ID and when to load.

## Reference

| Export | Description |
|---|---|
| `createShieldLabs(options)` | Returns the Vue plugin for `app.use()`. One per app; loads the agent once |
| `useShieldLabs()` | `{ status, error, identify, check, load, getAgent }` of the app |
| `useIdentify(options?)` | `{ identify, result, isLoading, error, reset }`, an identify helper per component |
| `shieldLabsKey` | `InjectionKey<ShieldLabsContext>` under which the plugin provides its context |
| `ShieldLabsError` | The error class of `@shieldlabs-ai/js` (re-exported). Has `code` and optional `cause` |
| `VERSION` | The package version, for example `"1.0.0"` |
| Types | `ShieldLabsOptions`, `CheckOnLoadOption`, `ShieldLabsPlugin`, `ShieldLabsContext`, `ShieldLabsStatus`, `UseShieldLabsReturn`, `UseIdentifyOptions`, `UseIdentifyReturn`, and from `@shieldlabs-ai/js`: `LoadOptions`, `IdentifyOptions`, `IdentifyResult`, `ShieldLabsAgent`, `InteractionIdentifier`, `ShieldLabsErrorCode` |

`createShieldLabs(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `publicKey` | `string` | required | Public Key of your domain. `@shieldlabs-ai/js` checks it when the agent loads |
| `environment` | `'production' \| 'development'` | `'production'` | Which ShieldLabs CDN to load the agent from |
| `scriptUrl` | `string` | | Advanced: agent module URL override (`https`, or `http` on `localhost` and `127.0.0.1`) |
| `timeout` | `number` | `10000` | Milliseconds to wait for the agent to load, and the default timeout of each call (the wait for the agent plus its answer) |
| `checkOnLoad` | `boolean \| { userId?: string \| null }` | `false` | Runs `check()` once when the agent becomes ready, unless an `identify()` or `check()` for the same User HID is in flight |
| `autoLoad` | `boolean` | `true` | Loads the agent right after the app is mounted; with `false`, nothing loads until `load()` from `useShieldLabs()` is called, and until then `identify()` fails fast with `not_initialized`, `check()` resolves `null` and `getAgent()` waits |

`createShieldLabs()` throws a `ShieldLabsError` with code `invalid_options` for a missing options
object or an invalid `checkOnLoad` or `autoLoad`. A second ShieldLabs plugin on the same app is
ignored with a warning.

`useShieldLabs()`

| Member | Type | Description |
|---|---|---|
| `status` | `Readonly<Ref<'loading' \| 'ready' \| 'error'>>` | Agent state. `'loading'` during server rendering and a component's first render |
| `error` | `Readonly<Ref<ShieldLabsError \| null>>` | Why the last load failed |
| `identify(options?)` | `Promise<IdentifyResult>` | Fresh identification with a new request ID; `timeout` covers the wait for the agent and its answer. Rejects with a `ShieldLabsError`; with `autoLoad: false`, with `not_initialized` right away until `load()` is called |
| `check(options?)` | `Promise<IdentifyResult \| null>` | Background check, `null` when the agent skipped it (and right away with `autoLoad: false` until `load()` is called). Waits like `identify()` |
| `load()` | `void` | Starts loading the agent unless it is loaded or loading; loads again after a failed load. Does nothing during server rendering |
| `getAgent()` | `Promise<ShieldLabsAgent>` | The agent once it has loaded, for `identifyOnInteraction()`. Loads when needed (with `autoLoad: false`, waits for `load()` with no timeout of its own); rejects with the load's `ShieldLabsError` |

`useIdentify(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `userId` | `MaybeRefOrGetter<string \| null \| undefined>` | | User HID computed on your server, read when `identify()` runs |
| `runOnMount` | `boolean` | `false` | Calls `identify()` once after the component is mounted. With `autoLoad: false`, call `load()` before the mount: a run that starts before `load()` resolves `null` with `not_initialized` and does not run again |

| Member | Type | Description |
|---|---|---|
| `identify(options?)` | `Promise<IdentifyResult \| null>` | Fresh identification. Never rejects: `null` and `error` when there is none (`not_initialized` right away with `autoLoad: false` until `load()` is called). Returns this helper's call in flight with the same `userId` and `timeout` (an omitted `timeout` counts as the plugin's) instead of starting another |
| `result` | `Readonly<Ref<IdentifyResult \| null>>` | Result of the latest call |
| `isLoading` | `Readonly<Ref<boolean>>` | `true` while the latest call runs |
| `error` | `Readonly<Ref<ShieldLabsError \| null>>` | Why the latest call returned `null` |
| `reset()` | `void` | Clears `result`, `error` and `isLoading` |

`IdentifyOptions` is `{ userId?: string; timeout?: number }` and `IdentifyResult` is
`{ requestId: string; userId: string | null }`, as in `@shieldlabs-ai/js`. In this package `timeout`
bounds the whole call: the wait for the agent to load and the agent's answer.

Composables called outside `setup()` (or `app.runWithContext()`), or in the browser without the
plugin, throw an `Error` that names the fix. In the Options API, call them in `setup()`; outside
components (for example in a router guard), use `app.runWithContext(() => useShieldLabs())`.

## Errors and retries

Every identification error is a `ShieldLabsError`. Branch on `error.code`:

| `code` | When | What to do |
|---|---|---|
| `invalid_options` | An option failed validation, for example an empty `publicKey` because the environment variable is missing (the plugin also logs this with `console.warn`) or a reserved `userId` | Fix the configuration or the call; retrying does not help |
| `unsupported_environment` | Server-side rendering, a worker, or a page that is not a secure context | Identify in the browser; serve the page over HTTPS (`localhost` and `127.0.0.1` also work over `http`) |
| `load_failed` | The agent could not be imported: network error, content blocker, Content Security Policy | Continue without an identification. The next `identify()`, `check()`, `getAgent()` or `load()` loads again |
| `not_initialized` | The agent did not start an identification, for example because another one is running in this or another tab. With `autoLoad: false`, also an `identify()` made before `load()` is called | Continue without an identification, or retry once later (with `autoLoad: false`, after `load()`) |
| `timeout` | The agent did not load and answer within the call's timeout (default 10 seconds) | Continue without an identification. A call that timed out while waiting for the agent never reaches it, and a late answer is ignored |

- The plugin reports a failed load in `status` (`'error'`) and `error`. A failed load is not kept:
  the next `identify()`, `check()`, `getAgent()` or `load()` tries again. Mounting more components
  does not.
- Identifications are never retried automatically, because every identification is billed. Call
  `identify()` again on the next submission.
- Whenever there is no identification, send the protected action anyway without a `requestId`:
  your backend treats a missing identification as unverified, never as clean.

More detail: [`@shieldlabs-ai/js` Errors](https://github.com/ShieldLabs-ai/shieldlabs-js#errors).

## Compatibility

- Vue 3.3 or later (tested with 3.3 and 3.5), with Vue SSR (`createSSRApp` and
  `vue/server-renderer`) and Nuxt 3.
- Browsers: as `@shieldlabs-ai/js`, current browsers with ES modules, dynamic `import()` and
  WebCrypto, on a secure context (HTTPS, or `localhost` and `127.0.0.1` during development).
- Output: ES2019 syntax as ESM and CommonJS with TypeScript declarations. No runtime dependencies;
  peer dependencies `vue` `^3.3.0` and `@shieldlabs-ai/js` `^1.0.0`.
- Server runtimes (Node.js 18+, Bun, Deno, edge): safe to import and render.

## Development

From the repository root, install the development tools and the published loader. No sibling
repository is required. Repeat the loader install after each `npm ci`.

```bash
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0'
npm run typecheck
npm run lint
npm test -- --coverage   # builds first, then runs the tests
npm run build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup details and testing local changes. Documentation:
<https://docs.shieldlabs.ai>. Analytics dashboard: <https://app.shieldlabs.ai>. Support:
<contact@shieldlabs.ai>.

## License

[MIT](./LICENSE), Copyright (c) 2026 ShieldLabs Inc.
