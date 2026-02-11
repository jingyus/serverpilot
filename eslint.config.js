import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: {
      'import-x': importX,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'import-x/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'never',
        },
      ],
    },
  },
  {
    ignores: [
      'dist/',
      '**/dist/**',
      'node_modules/',
      '**/node_modules/**',
      'coverage/**',
      'packages/dashboard/**',
      'packages/website/**',
      'openclaw-modules/',
      'openclaw-modules/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
);
