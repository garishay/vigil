import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Hand-run capture tooling: it runs on Node, and reporting progress across a twenty-minute
    // capture is the point of the script rather than noise in the app.
    files: ['scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    // The scoring path's determinism guarantee, enforced rather than remembered. Same seed →
    // identical picture is an acceptance criterion (docs/mvp-scope.md §11), and it survives only
    // as long as nobody reaches for an unseeded source of variation inside the generator.
    files: ['src/lib/rng.ts', 'src/lib/injects.ts', 'src/config/scenario.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'The inject generator has no clock — take time as a parameter.' },
        { name: 'performance', message: 'The inject generator has no clock.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Unseedable. Use makeRng(seed) from src/lib/rng.ts.',
        },
        {
          object: 'crypto',
          property: 'getRandomValues',
          message: 'Nondeterministic by design. Use makeRng(seed) from src/lib/rng.ts.',
        },
      ],
    },
  },
  prettier,
)
