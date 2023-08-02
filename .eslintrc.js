'use strict'

module.exports = {
  env: {
    node: true
  },
  extends: [
    'standard',
    'eslint:recommended'
  ],
  root: true,
  plugins: [
    'no-floating-promise'
  ],
  rules: {
    'no-empty': [
      'error',
      {
        allowEmptyCatch: false
      }
    ],
    'no-floating-promise/no-floating-promise': 'error',
    'no-return-await': 'off',
    'no-unused-vars': [
      'error',
      {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_'
      }
    ]
  }
}
