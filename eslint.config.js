import js         from '@eslint/js'
import globals    from 'globals'
import tsParser   from '@typescript-eslint/parser'
import tsPlugin   from '@typescript-eslint/eslint-plugin'
import reactPlugin from 'eslint-plugin-react'
import hooksPlugin from 'eslint-plugin-react-hooks'

export default [
  // ── Ignores ──────────────────────────────────────────────────────────────────
  {
    ignores: ['dist/**', 'node_modules/**', 'src/jarvis/**', 'coverage/**', '.claude/**'],
  },

  // ── Base JS rules for plain JS/JSX files ─────────────────────────────────────
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      ecmaVersion:  'latest',
      sourceType:   'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2020, ...globals.node },
    },
  },

  // ── JSX files — React variable usage (prevents false "unused" on JSX tags) ──
  {
    files: ['**/*.jsx'],
    plugins: { react: reactPlugin },
    rules: { 'react/jsx-uses-vars': 'error' },
  },

  // ── TypeScript + React (src + api) ───────────────────────────────────────────
  // Adds @typescript-eslint/parser so .ts/.tsx files are parsed correctly.
  {
    files: ['src/**/*.{ts,tsx}', 'api/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion:  'latest',
        sourceType:   'module',
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.es2020, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react:                reactPlugin,
      'react-hooks':        hooksPlugin,
    },
    rules: {
      // TypeScript — warn (not error) so existing codebase doesn't fail immediately
      '@typescript-eslint/no-explicit-any':    'warn',
      '@typescript-eslint/no-unused-vars':     ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // React hooks correctness
      'react-hooks/rules-of-hooks':  'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Turn off base rule replaced by TS variant
      'no-unused-vars': 'off',
    },
  },

  // ── src/modules — additional strict rules ────────────────────────────────────
  {
    files: ['src/modules/**/*.ts'],
    rules: {
      'no-debugger':          'error',
      'no-alert':             'error',
      'no-duplicate-imports': 'error',
      'prefer-const':         'error',
      'no-var':               'error',
    },
  },

  // ── Test files — relaxed rules ────────────────────────────────────────────────
  {
    files: ['src/__tests__/**/*.{ts,tsx}', 'api/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
        describe: 'readonly', it: 'readonly', expect: 'readonly',
        vi: 'readonly', beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly',
      },
    },
    rules: {
      'no-unused-expressions':                  'off',
      '@typescript-eslint/no-explicit-any':     'off',
      '@typescript-eslint/no-unused-vars':      'off',
    },
  },
]
