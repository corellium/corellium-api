"use strict";

exports.mochaHooks = {
    afterEach() {
        global.hookOrTestFailed = global.hookOrTestFailed || this.currentTest.state !== "passed";
    },
};
