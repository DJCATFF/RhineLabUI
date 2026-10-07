import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/apps/api/src/**/*.ts', 'src/**/*.ts'],
  })),
  {
    files: ['**/apps/api/src/**/*.ts', 'src/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-empty-function': 'off' },
  },
];
