import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

const external = ['react', 'react/jsx-runtime'];

const plugins = [
  nodeResolve(),
  typescript({
    tsconfig: './tsconfig.build.json',
    declaration: false,
    declarationMap: false,
    declarationDir: undefined,
    outDir: 'dist',
    sourceMap: false,
  }),
];

const config = [
  // ─── Core: ESM ────────────────────────────────────────────────────────────
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.mjs',
      format: 'esm',
      sourcemap: false,
    },
    external,
    plugins,
  },

  // ─── Core: CJS ────────────────────────────────────────────────────────────
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.cjs',
      format: 'cjs',
      sourcemap: false,
      exports: 'named',
    },
    external,
    plugins,
  },

  // ─── Core: Type declarations ───────────────────────────────────────────────
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    external,
    plugins: [
      dts({ tsconfig: './tsconfig.build.json' }),
    ],
  },

  // ─── React: ESM ───────────────────────────────────────────────────────────
  {
    input: 'src/integrations/react.ts',
    output: {
      file: 'dist/react.mjs',
      format: 'esm',
      sourcemap: false,
    },
    external,
    plugins,
  },

  // ─── React: CJS ───────────────────────────────────────────────────────────
  {
    input: 'src/integrations/react.ts',
    output: {
      file: 'dist/react.cjs',
      format: 'cjs',
      sourcemap: false,
      exports: 'named',
    },
    external,
    plugins,
  },

  // ─── React: Type declarations ──────────────────────────────────────────────
  {
    input: 'src/integrations/react.ts',
    output: {
      file: 'dist/react.d.ts',
      format: 'esm',
    },
    external,
    plugins: [
      dts({ tsconfig: './tsconfig.build.json' }),
    ],
  },
];

export default config;
