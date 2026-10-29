import eslint from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const disableTypeChecked = tseslint.configs.disableTypeChecked;

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/drizzle/**',
      '**/playwright-report/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Register plugins so existing `eslint-disable` comments resolve.
    // Keep Next/react-hooks rules off here — enabling them floods CI with false positives.
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      '@next/next/no-img-element': 'off',
      '@next/next/no-html-link-for-pages': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'error',
      // Neon catch/rethrow and draft reassignment patterns are intentional.
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'no-constant-binary-expression': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Web Neon/BFF code is full of `unknown` SQL rows and FormData — type-aware
    // unsafe-* / no-base-to-string dominate CI without matching Nest/package risk.
    files: ['apps/web/**/*.{ts,tsx}'],
    ...disableTypeChecked,
    rules: {
      ...disableTypeChecked.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.config.ts', '**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts', '**/e2e/**/*.ts'],
    ...disableTypeChecked,
    rules: {
      ...disableTypeChecked.rules,
    },
  },
);
