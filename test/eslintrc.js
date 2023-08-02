module.exports = {
  env: {
    mocha: true
  },
  extends: [
    'plugin:mocha/recommended'
  ],
  rules: {
    'mocha/no-sibling-hooks': 'off'
  }
}
