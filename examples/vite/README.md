# Vue + Vite example

A signup form in Vue 3. `src/main.ts` installs the plugin from `createShieldLabs()` once;
`src/components/SignupForm.vue` calls `identify()` from `useIdentify()` on submit and sends the
`requestId` to your backend with the signup request.

## Run it

From this example directory, install the published packages from npm:

```bash
npm install
cp .env.example .env   # then set VITE_SHIELDLABS_PUBLIC_KEY
npm run dev
```

Open the URL Vite prints (for example <http://localhost:5173>). The form posts JSON to
`/api/signup`. In development, Vite forwards `/api/*` to `http://localhost:3000` without the
`/api` prefix: that is where the `node:http` example of
[`@shieldlabs-ai/node`](https://github.com/ShieldLabs-ai/shieldlabs-node) serves `POST /signup` and
reads the verdict for `requestId` with `identifications.get(requestId)`. Point the proxy at your
own server otherwise.

ShieldLabs accepts identifications only from registered domains. On `localhost` the request ID
still reaches the page, but no identification is recorded. Serve the example from a registered
development domain to see results in the [analytics dashboard](https://app.shieldlabs.ai).

## Build against local copies of the packages

Use the published loader and a tarball of this checkout to test changes to the Vue binding:

```bash
# in the root of this repository
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0'
npm run build && npm pack
cd examples/vite
npm install --no-save --no-package-lock ../../shieldlabs-ai-vue-1.0.0.tgz
npm run build
```

Adjust the tarball filename if the package version changes. To test a loader change as well,
build and pack it in its own checkout and pass that tarball to both install commands in place of
the published loader (include it in the example install too). Never commit a tarball or a `file:`
dependency.
