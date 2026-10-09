// ESLint flat config: gts (Google TypeScript Style) plus the architecture rules from
// docs/architecture.md section 1.2 and 4.9. Every local override below is deliberate.
import {readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {defineConfig} from 'eslint/config';
import {createTypeScriptImportResolver} from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import {ignores} from './eslint.ignores.js';

const require = createRequire(import.meta.url);
/** gts shared flat config (CommonJS). */
const gts = require('gts');

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'OffscreenCanvas',
  'requestAnimationFrame',
].map(name => ({name, message: 'DOM-free package (architecture.md rule 2).'}));

const THREE = {
  group: ['three', 'three/*'],
  message: 'Only @csg/engine and @csg/shader-graph/tsl import three.',
};
const REACT = {
  group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  message: 'React is only allowed in apps/web.',
};
const APPS = {
  group: ['@csg/web', '@csg/web/*', '@csg/site', '@csg/site/*', '@csg/tools'],
  message: 'Nothing depends on apps/* or tools/ (architecture.md rule 1).',
};
const ANY_CSG = {
  group: ['@csg/*'],
  message: 'This package may not depend on other workspace packages.',
};

const ENGINE_TOOLS_MSG =
  'Import DOM-free engine modules (@csg/engine/rig, /retarget), not the barrel.';

/** Local rules. */
const csgPlugin = {
  rules: {
    'no-keydown-listener': {
      meta: {
        type: 'suggestion',
        schema: [],
        messages: {
          keydown:
            'Register shortcuts in src/shared/shortcuts instead of adding keydown listeners.',
        },
      },
      create: context => ({
        CallExpression(node) {
          const callee = node.callee;
          const first = node.arguments[0];
          if (
            callee.type === 'MemberExpression' &&
            callee.property.name === 'addEventListener' &&
            first?.type === 'Literal' &&
            first.value === 'keydown'
          ) {
            context.report({node, messageId: 'keydown'});
          }
        },
      }),
    },
  },
};

/** @param {...{group: string[], message: string}} patterns */
const restrict = (...patterns) => ({
  'no-restricted-imports': ['error', {patterns}],
});

// Feature folders are discovered at config load so a new folder is isolated automatically.
const FEATURES = readdirSync(
  new URL('./apps/web/src/features', import.meta.url),
  {withFileTypes: true},
)
  .filter(d => d.isDirectory())
  .map(d => d.name);
const featureDir = f => `./apps/web/src/features/${f}`;

const XSS_SYNTAX = [
  ...['innerHTML', 'outerHTML'].map(name => ({
    selector: `AssignmentExpression[left.property.name='${name}']`,
    message: `Assigning ${name} is banned (XSS); build DOM nodes or React elements.`,
  })),
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'insertAdjacentHTML is banned (XSS).',
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is banned (XSS).',
  },
];

export default defineConfig([
  {ignores},
  ...gts,
  {
    // gts points at ./tsconfig.json; this repo has one tsconfig per package.
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: null,
        projectService: {allowDefaultProject: ['vitest.config.ts']},
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {fixStyle: 'separate-type-imports'},
      ],
      // gts leaves these unset; unused args prefixed with _ are allowed.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
    },
  },
  {
    // Repo config files are ESM (root package.json has "type": "module").
    files: ['*.js', '*.mjs', 'tools/**/*.mjs'],
    languageOptions: {sourceType: 'module', globals: globals.node},
  },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    plugins: {'import-x': importX},
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      // ADR-0002: named exports only.
      'import-x/no-default-export': 'error',
      'import-x/no-namespace': 'off',
    },
  },
  {
    // Default-export exception (architecture.md 4.9): framework files and tool configs only.
    files: [
      '**/*.config.{ts,js,mjs,cjs}',
      '.prettierrc.js',
      'apps/site/app/**/{page,layout,template,loading,error,not-found}.tsx',
      'apps/site/app/**/route.ts',
      'apps/site/mdx-components.tsx',
    ],
    rules: {'import-x/no-default-export': 'off'},
  },
  {
    // No namespaces; no `any`. gts only warns on some of these.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {'@typescript-eslint/no-namespace': 'error'},
  },

  // ---- Architecture: dependency directions (docs/architecture.md 1.2) ----
  {
    // Rule 2: parts-schema is zod-only and DOM-free.
    files: ['packages/parts-schema/**/*.{ts,tsx}'],
    rules: {
      ...restrict(THREE, REACT, ANY_CSG),
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
    },
  },
  {
    // Rule 2: shader-graph root entry never imports three/React/DOM or other packages.
    files: ['packages/shader-graph/**/*.{ts,tsx}'],
    ignores: ['packages/shader-graph/src/tsl/**'],
    rules: {
      ...restrict(THREE, REACT, ANY_CSG),
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
    },
  },
  {
    // Rule 3: the TSL compiler may import three, never the engine, React or apps.
    files: ['packages/shader-graph/src/tsl/**/*.{ts,tsx}'],
    rules: restrict(REACT, ANY_CSG),
  },
  {
    // Engine: three allowed; never React, never apps/tools.
    files: ['packages/engine/**/*.{ts,tsx}'],
    rules: restrict(REACT, APPS),
  },
  {
    // Engine rig/retarget stay DOM-free so tools/ can import them (rule 6).
    files: [
      'packages/engine/src/rig/**/*.ts',
      'packages/engine/src/retarget/**/*.ts',
    ],
    rules: {
      ...restrict(REACT, APPS),
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
    },
  },
  {
    // Rule 4: apps/web renders through @csg/engine; three only as `import type`.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*'],
              allowTypeImports: true,
              message:
                'apps/web may only `import type` from three; render via @csg/engine.',
            },
            {
              group: ['@csg/shader-graph/tsl'],
              message: 'The TSL compiler is used by @csg/engine, not apps/web.',
            },
            {
              group: ['@csg/site', '@csg/site/*', '@csg/tools'],
              message: 'apps/web may not depend on apps/site or tools.',
            },
          ],
        },
      ],
    },
  },
  {
    // Rule 6: tools use DOM-free engine modules only (never the engine barrel), no React/apps.
    files: ['tools/**/*.{ts,tsx,mjs}'],
    rules: restrict(
      THREE,
      REACT,
      APPS,
      {
        // Matches the barrel and every subpath except rig and retarget.
        regex: '^@csg/engine(/(?!(rig|retarget)$).*)?$',
        message: ENGINE_TOOLS_MSG,
      },
      {
        group: ['@csg/shader-graph/tsl'],
        message: 'tools use the pure graph model.',
      },
    ),
  },
  {
    // Rule 5: the site has no runtime dependency on workspace packages.
    files: ['apps/site/**/*.{ts,tsx}'],
    rules: restrict(ANY_CSG),
  },
  {
    // Rule 1 (feature isolation) and shared/app layering inside apps/web.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            ...FEATURES.map(f => ({
              target: featureDir(f),
              from: FEATURES.filter(o => o !== f).map(featureDir),
              message: `features/${f} may not import other features; lift shared code to src/shared.`,
            })),
            {
              target: './apps/web/src/shared',
              from: ['./apps/web/src/features', './apps/web/src/app'],
              message:
                'src/shared is a leaf: it may not import features or app.',
            },
            {
              target: './apps/web/src/features',
              from: './apps/web/src/app',
              message: 'Features may not import the app shell.',
            },
          ],
        },
      ],
    },
  },
  {
    // Rule 7: engine export/ is DOM-free and three-free (pure encoders over pixel buffers).
    files: ['packages/engine/src/export/**/*.{ts,tsx}'],
    rules: {
      ...restrict(
        {
          group: ['three', 'three/*'],
          message: 'engine/export must not import three (architecture.md).',
        },
        REACT,
        APPS,
      ),
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
    },
  },
  {
    // Determinism (REQ-PIX): no wall clock or RNG in the pipeline, sampler or TSL compiler.
    files: [
      'packages/engine/src/pipeline/**/*.{ts,tsx}',
      'packages/engine/src/sampler/**/*.{ts,tsx}',
      'packages/shader-graph/src/tsl/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        ...[
          ['Date', 'now'],
          ['performance', 'now'],
          ['Math', 'random'],
        ].map(([object, property]) => ({
          object,
          property,
          message: 'Non-deterministic; pass time and seeds in explicitly.',
        })),
      ],
    },
  },
  {
    // XSS sinks: no raw HTML injection in the app or packages.
    files: ['apps/web/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    rules: {'no-restricted-syntax': ['error', ...XSS_SYNTAX]},
  },
  {
    // Workers parse untrusted data and must stay offline and static (security review M3/L1):
    // no network, no dynamic code loading or evaluation. Repeats the XSS selectors because a
    // later `no-restricted-syntax` entry replaces the one above.
    files: ['**/*.worker.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'fetch',
          'importScripts',
          'WebSocket',
          'EventSource',
          'XMLHttpRequest',
        ].map(name => ({
          name,
          message: `${name} is banned in workers (offline, static).`,
        })),
        ...['eval', 'Function'].map(name => ({
          name,
          message: `${name} is banned in workers (no dynamic code).`,
        })),
      ],
      'no-restricted-syntax': [
        'error',
        ...XSS_SYNTAX,
        {
          selector: 'ImportExpression',
          message: 'Dynamic import() is banned in workers.',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'new Function is banned in workers.',
        },
        {
          selector: "CallExpression[callee.name='Function']",
          message: 'Function() is banned in workers.',
        },
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'eval is banned in workers.',
        },
      ],
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'off',
    },
  },
  {
    // Shortcuts go through the registry so they are listed, rebindable and conflict-checked.
    // A local rule (not no-restricted-syntax) so it can warn without replacing the XSS rule above.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/shared/shortcuts/**'],
    plugins: {csg: csgPlugin},
    rules: {'csg/no-keydown-listener': 'warn'},
  },
  {
    files: ['**/*.test.{ts,tsx}', 'apps/web/e2e/**'],
    languageOptions: {globals: globals.node},
  },
]);
