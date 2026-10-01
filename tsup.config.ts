import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'es2019',
  tsconfig: 'tsconfig.build.json',
  treeshake: true,
  clean: true,
  // Peer dependencies stay imports: the app provides one copy of Vue and of @shieldlabs-ai/js.
  external: ['vue', '@shieldlabs-ai/js'],
});
