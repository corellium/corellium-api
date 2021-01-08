"use strict";

module.exports = {
    "**/*.+(json)": ["prettier --write"],
    "**/*.+(js|ts)": ["eslint --fix", "prettier --write"],
};
