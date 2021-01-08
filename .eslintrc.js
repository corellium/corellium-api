"use strict";

module.exports = {
  env: {
    node: true,
    es2021: true,
    mocha: true,
  },
  extends: ["eslint:recommended", "plugin:mocha/recommended"],
  parserOptions: {
    ecmaVersion: 12,
  },
  rules: {
    "no-constant-condition": "off",
    "no-empty": "off",
  },
  ignorePatterns: ["resumable.js"],
  plugins: ["mocha"],
};
