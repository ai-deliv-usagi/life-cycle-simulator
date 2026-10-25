import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // シードで人生を再現するため、乱数は src/engine/rng.ts 経由のみ
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: '乱数は src/engine/rng.ts を使う' },
      ],
    },
  },
  {
    // engine は DOM・localStorage・UI を参照しない
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'engine から DOM を参照しない' },
        { name: 'document', message: 'engine から DOM を参照しない' },
        { name: 'localStorage', message: 'engine から localStorage を参照しない' },
        { name: 'sessionStorage', message: 'engine から sessionStorage を参照しない' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/ui/**', 'chart.js'], message: 'engine から UI を参照しない' }] },
      ],
    },
  },
);
