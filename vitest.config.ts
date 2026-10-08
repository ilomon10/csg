import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {test: {name: 'parts-schema', root: 'packages/parts-schema'}},
      {test: {name: 'shader-graph', root: 'packages/shader-graph'}},
      {test: {name: 'engine', root: 'packages/engine'}},
      {
        test: {
          name: 'web',
          root: 'apps/web',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {test: {name: 'tools', root: 'tools'}},
    ],
  },
});
