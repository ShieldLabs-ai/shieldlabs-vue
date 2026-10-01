// @vitest-environment node
// Checks the files that ship in the package. `npm test` builds them first (the pretest script).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = (file: string): string => fileURLToPath(new URL(`../dist/${file}`, import.meta.url));
const read = (file: string): string => readFileSync(dist(file), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  dependencies?: Record<string, string>;
};

const EXPORTS = ['ShieldLabsError', 'VERSION', 'createShieldLabs', 'shieldLabsKey', 'useIdentify', 'useShieldLabs'];

beforeAll(() => {
  if (!existsSync(dist('index.js'))) {
    throw new Error('dist/ is missing. Run `npm test` (it builds first) or `npm run build`.');
  }
});

describe('package', () => {
  it('has no runtime dependencies; vue and @shieldlabs-ai/js are peers', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toEqual({ '@shieldlabs-ai/js': '^1.0.0', vue: '^3.3.0' });
    // Both peers are required: npm installs them with the package (npm 7 and later).
    expect(pkg.peerDependenciesMeta).toBeUndefined();
  });
});

describe('ESM and CJS builds', () => {
  it('the ESM build exports the public API', async () => {
    const esm = (await import(pathToFileURL(dist('index.js')).href)) as Record<string, unknown>;
    expect(Object.keys(esm).sort()).toEqual(EXPORTS);
    expect(esm.VERSION).toBe(pkg.version);
    // The same class as @shieldlabs-ai/js, so `instanceof` works with errors from either package.
    const core = await import('@shieldlabs-ai/js');
    expect(esm.ShieldLabsError).toBe(core.ShieldLabsError);
  });

  it('the CJS build exports the public API', () => {
    const require = createRequire(root);
    const cjs = require(dist('index.cjs')) as Record<string, unknown>;
    expect(Object.keys(cjs).sort()).toEqual(EXPORTS);
    expect(cjs.VERSION).toBe(pkg.version);
  });

  it.each(['index.js', 'index.cjs'])('%s imports vue and @shieldlabs-ai/js instead of bundling them', (file) => {
    const code = read(file);
    expect(code).toMatch(/(from |require\()['"]vue['"]/);
    expect(code).toMatch(/(from |require\()['"]@shieldlabs-ai\/js['"]/);
    // Neither the Vue runtime nor the agent loader is copied into the build.
    expect(code).not.toMatch(/createRenderer|cdn\.shieldlabs\.ai|import\(/);
  });

  it.each(['index.d.ts', 'index.d.cts'])('%s declares the public types', (file) => {
    const types = read(file);
    for (const name of [
      ...EXPORTS,
      'CheckOnLoadOption',
      'ShieldLabsContext',
      'ShieldLabsOptions',
      'ShieldLabsPlugin',
      'ShieldLabsStatus',
      'UseIdentifyOptions',
      'UseIdentifyReturn',
      'UseShieldLabsReturn',
      'IdentifyOptions',
      'IdentifyResult',
      'InteractionIdentifier',
      'LoadOptions',
      'ShieldLabsAgent',
      'ShieldLabsErrorCode',
    ]) {
      expect(types).toContain(name);
    }
  });
});
