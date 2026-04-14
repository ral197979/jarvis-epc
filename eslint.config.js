import js from '@eslint/js'
import globals from 'globals'

export default [
  // Base JS recommended rules
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
  },

  // TypeScript modules only — strict rules
  {
    files: ['src/modules/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    rules: {
      // Prevent accidental use of console.log in production modules
      // (slog() is the correct mechanism)
      'no-debugger': 'error',
      'no-alert':    'error',

      // Catch common bugs
      'no-duplicate-imports': 'error',
      'no-unused-expressions': 'error',
      'no-use-before-define': ['warn', { functions: false, classes: true }],

      // Code style
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Test files — more relaxed rules
  {
    files: ['src/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
        describe: 'readonly',
        it:       'readonly',
        expect:   'readonly',
        vi:       'readonly',
        beforeEach: 'readonly',
        afterEach:  'readonly',
        beforeAll:  'readonly',
        afterAll:   'readonly',
      },
    },
    rules: {
      'no-unused-expressions': 'off',
    },
  },

  // Ignore
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/jarvis/**', // JarvisCore monolith — not linted in Phase 3
      'coverage/**',
    ],
  },
]
