"use strict";

module.exports = {
    env: {
        es2021: true,
        mocha: true,
        node: true,
    },
    extends: ["eslint:recommended", "plugin:mocha/recommended"],
    ignorePatterns: ["docs/**/*", "resumable.js"],
    parserOptions: {
        ecmaVersion: 12,
    },
    plugins: ["mocha"],
    rules: {
        "mocha/no-setup-in-describe": "off",
        "no-unused-vars": [
            2,
            { vars: "all", args: "all", argsIgnorePattern: "^_", ignoreRestSiblings: false },
        ],
    },
};
