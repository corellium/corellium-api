"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const stream = require("stream");

const wtfnode = require("wtfnode");

const Corellium = require("../src/corellium").Corellium;
const { Input } = require("../src/input");

const CONFIGURATION = require("./config.json");

/** @typedef {import('../src/instance.js')} Instance */
/** @typedef {import('../src/project.js')} Project */

process.title = "integration-tests";
process.on("SIGUSR2", () => wtfnode.dump());

global.hookOrTestFailed = false;

function setFlagIfHookFailedDecorator(fn) {
    return function () {
        return Promise.resolve(fn.apply(this, arguments)).catch((error) => {
            global.hookOrTestFailed = true;
            throw error;
        });
    };
}

async function turnOff(instance) {
    await instance.stop();
    await instance.waitForState("off");
    assert.strictEqual(instance.state, "off");
}

async function turnOn(instance) {
    await instance.start();
    await instance.waitForState("on");
    assert.strictEqual(instance.state, "on");
}

describe("Corellium API", function () {
    let BASE_LIFECYCLE_TIMEOUT = 0;
    let BASE_SNAPSHOT_TIMEOUT = 0;
    let INSTANCE_VERSIONS = [];
    if (CONFIGURATION.testFlavor === "ranchu") {
        this.slow(10000);
        this.timeout(20000);

        BASE_LIFECYCLE_TIMEOUT = 40000;
        BASE_SNAPSHOT_TIMEOUT = 20000;
        INSTANCE_VERSIONS = ["7.1.2", "8.1.0", "9.0.0", "10.0.0", "11.0.0"];
    } else {
        this.slow(40000);
        this.timeout(50000);

        BASE_LIFECYCLE_TIMEOUT = 700000;
        BASE_SNAPSHOT_TIMEOUT = 300000;
        INSTANCE_VERSIONS = ["10.3.3", "11.4.1", "12.4.1", "13.7", "14.1"];
    }

    const instanceMap = new Map();
    let corellium = null;
    let loggedIn = false;

    before(
        "should have a configuration",
        setFlagIfHookFailedDecorator(function () {
            if (
                CONFIGURATION.endpoint === undefined ||
                CONFIGURATION.password === undefined ||
                CONFIGURATION.project === undefined ||
                CONFIGURATION.testFlavor === undefined ||
                CONFIGURATION.username === undefined
            ) {
                throw new Error(
                    "The configuration must include endpoint, username, password, project and testFlavor properties.",
                );
            }
        }),
    );

    before(
        "should log in",
        setFlagIfHookFailedDecorator(async function () {
            corellium = new Corellium(CONFIGURATION);
            await corellium.login();

            const token = await corellium.token;
            assert(token && token.token, "Token was never set, login must have silently failed");

            loggedIn = true;
        }),
    );

    INSTANCE_VERSIONS.forEach((instanceVersion) => {
        after(
            setFlagIfHookFailedDecorator(async function () {
                this.timeout(80000);

                const instance = instanceMap.get(instanceVersion);
                if (!instance) {
                    return;
                }

                // To facilitate debugging, don't destroy instances if a test or hook failed.
                if (global.hookOrTestFailed) {
                    // Stop updating the instance. Otherwise the updater keeps at it and the
                    // integration tests don't terminate.
                    instance.project.updater.remove(instance);
                    return;
                }

                await instance.destroy();
                await instance.waitForState("deleted");
            }),
        );
    });

    describe("projects", function () {
        let project = /** @type {Project} */ (null);

        before(
            "should be logged in",
            setFlagIfHookFailedDecorator(function () {
                assert(loggedIn, "All tests will fail as login failed");
            }),
        );

        it("lists projects", async function () {
            project = await corellium.projects().then((projects) => {
                const foundProject = projects.find(
                    (project) => project.info.name === CONFIGURATION.project,
                );
                assert(
                    foundProject !== undefined,
                    new Error(
                        `Your test configuration specifies a project named "${CONFIGURATION.project}", but no such project was found on ${CONFIGURATION.endpoint}`,
                    ),
                );
                return foundProject;
            });
        });

        it(`has room for ${INSTANCE_VERSIONS.length} new VMs (get quota / quotasUsed)`, async function () {
            assert(project, "Unable to test as no project was returned from previous tests");
            assert(project.quotas !== project.quotasUsed);
            if (project.quotas - project.quotasUsed < 2 * INSTANCE_VERSIONS.length)
                throw new Error(
                    `no room for an extra device to be made, please free at least ${
                        2 * INSTANCE_VERSIONS.length
                    } cores`,
                );
        });

        INSTANCE_VERSIONS.forEach((instanceVersion) => {
            it(`can start create ${instanceVersion}`, async function () {
                assert(project, "Unable to test as no project was returned from previous tests");
                const name = `API Test ${instanceVersion}`;
                let instanceConfig = {};
                if (CONFIGURATION.testFlavor === "ranchu") {
                    instanceConfig = {
                        flavor: CONFIGURATION.testFlavor,
                        name: name,
                        os: instanceVersion,
                    };
                } else {
                    instanceConfig = {
                        flavor: CONFIGURATION.testFlavor,
                        name: name,
                        os: instanceVersion,
                        bootOptions: {
                            udid: "9564a02c6255d8c449a3f691aeb8296dd352f3d6",
                        },
                    };
                }
                const instance = await project.createInstance(instanceConfig);

                instanceMap.set(instanceVersion, instance);

                await instance.waitForState("creating");
                assert.strictEqual(instance.flavor, CONFIGURATION.testFlavor);
                assert.strictEqual(instance.name, name);
            });
        });

        it("can list supported devices", async function () {
            const supportedDevices = await corellium.supported();
            const firmware = supportedDevices.find(
                (device) => device.name === CONFIGURATION.testFlavor,
            );
            assert(firmware);
        });

        it("can get teams and users", async function () {
            let teamsAndUsers = await corellium.getTeamsAndUsers();
            teamsAndUsers.users.forEach((value, key) => {
                assert.strictEqual(value, corellium._users.get(key));
            });

            teamsAndUsers.teams.forEach((value, key) => {
                assert.strictEqual(value, corellium._teams.get(key));
            });
        });

        it("can get roles", async function () {
            const roles = await corellium.roles();
            assert(roles, "Roles should not be undefined, even if there have been no roles");
        });

        // Not visible to cloud users with one project:
        it("can add and remove keys", async function () {
            let keyInfo = await project
                .addKey(
                    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCqpvRmc/JQoH9P6XVlHnod0wRCg+7iSGfpyoBoe+nWwp2iEqPyM7A2RzW7ZIX2FZmlD5ldR6Oj5Z+LUR/GXfCFQvpQkidL5htzGMoI59SwntpSMvHlFLOcbyS7VmI4MKbdIF+UrelPCcCJjOaZIFOJfNtuLWDx0L14jW/4wflzcj6Fd1rBTVh2SB3mvhsraOuv9an74zr/PMSHtpFnt5m4SYWpE4HLTf0FJksEe/Qda9jQu5i86Mhu6ewSAVccUDLzgz6E4i8hvSqfctcYGT7asqxsubPTpTPfuOkc3WOxlqZYnnAbpGh8NvCu9uC+5gfWRcLoyRBE4J2Y3wcfOueP example-key",
                )
                .then((projectKey) => {
                    assert(
                        projectKey.label === "example-key",
                        "label defaults to public key comment",
                    );
                    assert(
                        projectKey.fingerprint ===
                            "9c:71:e5:40:08:fb:cd:88:1b:6d:8e:4f:c0:4c:0f:dd",
                    );
                    return projectKey;
                })
                .catch((error) => {
                    throw error;
                });

            const keys = await project.keys();
            assert(!!keys.find((key) => key.identifier === keyInfo.identifier));

            await project.deleteKey(keyInfo.identifier);
        });

        it("can refresh", async function () {
            let tempName = project.info.name;
            await project.refresh();
            assert(tempName === project.info.name);
        });

        INSTANCE_VERSIONS.forEach((instanceVersion) => {
            it(`can getInstance ${instanceVersion}`, async function () {
                const instanceFromMap = instanceMap.get(instanceVersion);
                const instance = await project.getInstance(instanceFromMap.id);
                assert(instance.id === instanceFromMap.id);
            });
        });

        it("can get openvpn profile", async function () {
            let expected = Buffer.from("client");

            await project
                .vpnConfig("ovpn", undefined)
                .then((profile) => {
                    assert(profile.length > expected.length);
                    assert(profile.compare(expected, 0, expected.length, 0, expected.length) === 0);
                    return profile;
                })
                .catch((error) => {
                    // Hack to ignore onsite installs for this test
                    if (!error.toString().includes("500 Internal Server Error")) {
                        throw error;
                    }
                    console.log(
                        "Forcing pass, this does not appear to be a server which supports vpns",
                    );
                    return undefined;
                });
        });

        it("can get tunnelblick profile", async function () {
            let expected = Buffer.from("504b0304", "hex");

            await project
                .vpnConfig("tblk", undefined)
                .then((profile) => {
                    assert(profile.length > expected.length);
                    assert(profile.compare(expected, 0, expected.length, 0, expected.length) === 0);
                    return profile;
                })
                .catch((error) => {
                    // Hack to ignore onsite installs for this test
                    if (!error.toString().includes("500 Internal Server Error")) {
                        throw error;
                    }
                    console.log(
                        "Forcing pass, this does not appear to be a server which supports vpns",
                    );
                    return undefined;
                });
        });

        INSTANCE_VERSIONS.forEach((instanceVersion) => {
            it(`can finish create ${instanceVersion}`, async function () {
                this.slow(BASE_LIFECYCLE_TIMEOUT);
                this.timeout(BASE_LIFECYCLE_TIMEOUT + 30000);

                const instance = instanceMap.get(instanceVersion);
                await instance.finishRestore();
            });
        });
    });

    INSTANCE_VERSIONS.forEach((instanceVersion) => {
        describe(`panics ${instanceVersion}`, function () {
            before(
                "should have an instance",
                setFlagIfHookFailedDecorator(function () {
                    assert(
                        instanceMap.get(instanceVersion),
                        "No instances available for testing, tests will fail",
                    );
                }),
            );

            it("can request panics", async function () {
                const instance = instanceMap.get(instanceVersion);
                const panics = instance.panics();
                assert(panics, "Panics should not be undefined, even if there have been no panics");
            });

            it("can clear panics", async function () {
                const instance = instanceMap.get(instanceVersion);
                instance.clearPanics();
            });
        });
    });

    INSTANCE_VERSIONS.forEach((instanceVersion) => {
        describe(`instances ${instanceVersion}`, function () {
            before(
                "should have an instance",
                setFlagIfHookFailedDecorator(async function () {
                    assert(
                        instanceMap.get(instanceVersion),
                        "No instances available for testing, tests will fail",
                    );
                    const instance = instanceMap.get(instanceVersion);
                    await instance.waitForState("on");
                }),
            );

            describe(`device lifecycle ${instanceVersion}`, function () {
                this.slow(BASE_LIFECYCLE_TIMEOUT / 2);
                this.timeout(BASE_LIFECYCLE_TIMEOUT);

                beforeEach(async function () {
                    const instance = instanceMap.get(instanceVersion);
                    await instance.update();
                });

                it("can pause", async function () {
                    const instance = instanceMap.get(instanceVersion);
                    await instance.waitForState("on");
                    await instance.pause();
                    await instance.waitForState("paused");
                });

                it("can unpause", async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== "paused") {
                        await instance.pause();
                        await instance.waitForState("paused");
                    }

                    await instance.unpause();
                    await instance.waitForState("on");
                });

                it("can reboot", async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== "on") {
                        await turnOn(instance);
                    }
                    await instance.reboot();
                    if (CONFIGURATION.testFlavor !== "ranchu") {
                        await instance.waitForAgentReady();
                    }
                });

                it("can stop", async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== "on") {
                        await turnOn(instance);
                    }
                    await turnOff(instance);
                });

                it("can start", async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (instance.state !== "off") {
                        await turnOff(instance);
                    }
                    await turnOn(instance);
                });
            });

            describe(`snapshots ${instanceVersion}`, function () {
                this.slow(BASE_SNAPSHOT_TIMEOUT / 2);
                this.timeout(BASE_SNAPSHOT_TIMEOUT);

                before(
                    "should have an up-to-date instance",
                    setFlagIfHookFailedDecorator(async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.update();
                    }),
                );

                it("has a fresh snapshot", async function () {
                    const instance = instanceMap.get(instanceVersion);
                    const snapshots = await instance.snapshots();
                    const fresh = snapshots.find((snap) => snap.fresh);
                    assert(fresh.status.created === true);
                });

                let latestSnapshot;
                if (CONFIGURATION.testFlavor === "ranchu") {
                    it("refuses to take snapshot if instance is on", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        if (instance.state !== "on") {
                            await turnOn(instance);
                        }
                        await assert.rejects(() => instance.takeSnapshot());
                    });

                    it("can take snapshot if instance is off", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        if (instance.state !== "off") {
                            await turnOff(instance);
                        }

                        latestSnapshot = await instance.takeSnapshot();

                        while (latestSnapshot.status.created !== true) {
                            await latestSnapshot.update();
                        }
                    });
                } else {
                    it("can take snapshot if instance is on", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        latestSnapshot = await instance.takeSnapshot();

                        while (latestSnapshot.status.created !== true) {
                            await latestSnapshot.update();
                        }
                    });
                }

                it("can restore a snapshot", async function () {
                    assert(
                        latestSnapshot,
                        "This test cannot run because there is no latestSnapshot to use",
                    );
                    const instance = instanceMap.get(instanceVersion);
                    if (CONFIGURATION.testFlavor === "ranchu") {
                        if (instance.state !== "off") {
                            await turnOff(instance);
                        }

                        await latestSnapshot.restore();
                    } else {
                        await instance.pause();
                        await instance.waitForState("paused");
                        await latestSnapshot.restore();
                        await instance.waitForAgentReady();
                    }
                });

                it("can delete a snapshot", async function () {
                    assert(
                        latestSnapshot,
                        "This test cannot run because there is no latestSnapshot to use",
                    );

                    const instance = instanceMap.get(instanceVersion);
                    assert(
                        (await instance.snapshots()).some(
                            (snapshot) => snapshot.id === latestSnapshot.id,
                        ),
                    );

                    await latestSnapshot.delete();

                    while (
                        (await instance.snapshots()).some(
                            (snapshot) => snapshot.id === latestSnapshot.id,
                        )
                    );
                });

                after("should be on", async function () {
                    const instance = instanceMap.get(instanceVersion);
                    await turnOn(instance);
                });
            });

            it("can take a screenshot", async function () {
                const expected = Buffer.from("89504E470D0A1A0A", "hex");
                const instance = instanceMap.get(instanceVersion);
                await instance.takeScreenshot().then((png) => {
                    assert(png.length > expected.length);
                    assert(png.compare(expected, 0, expected.length, 0, expected.length) === 0);
                });
            });

            it("can rename", async function () {
                const instance = instanceMap.get(instanceVersion);
                const instanceName = instance.name;
                async function rename(name) {
                    await instance.rename(name);
                    await instance.update();
                    assert.strictEqual(instance.name, name);
                }
                await rename("test rename foo");
                await rename(instanceName);
            });

            it("has a console log", async function () {
                const instance = instanceMap.get(instanceVersion);
                const log = await instance.consoleLog();
                if (log === undefined) {
                    throw new Error("Unable to acquire any console log");
                }
            });

            it("has a console", async function () {
                const instance = instanceMap.get(instanceVersion);
                const consoleStream = await instance.console();
                // Wait for the socket to open before killing it,
                // otherwise this will throw an error
                consoleStream.socket.on("open", function () {
                    consoleStream.socket.close();
                });
                // When the socket closes, it will be safe to destroy the console duplexify object
                consoleStream.socket.on("close", function () {
                    consoleStream.destroy();
                });
            });

            it("can send input", async function () {
                const input = new Input();
                const instance = instanceMap.get(instanceVersion);
                instance.sendInput(input.pressRelease("home"));
            });

            describe(`agent ${instanceVersion}`, function () {
                let agent;
                let installSuccess = false;

                before(
                    setFlagIfHookFailedDecorator(async function () {
                        this.timeout(BASE_LIFECYCLE_TIMEOUT + 60000);

                        const instance = instanceMap.get(instanceVersion);
                        await instance.waitForState("on");
                        await instance.waitForAgentReady();
                    }),
                );

                beforeEach(async function () {
                    const instance = instanceMap.get(instanceVersion);
                    if (agent === undefined || !agent.connected) {
                        agent = await instance.newAgent();
                        await agent.ready();
                    }
                });

                after(
                    setFlagIfHookFailedDecorator(async function () {
                        if (agent !== undefined && agent.connected) agent.disconnect();
                    }),
                );

                it("can list device apps", async function () {
                    let appList = await agent.appList();
                    assert(appList !== undefined && appList.length > 0);
                });

                describe(`Files ${instanceVersion}`, function () {
                    let expectedData = Buffer.from("D1FF", "hex");
                    let testPath;

                    it("can get temp file", async function () {
                        testPath = await agent.tempFile();
                    });

                    it("can upload a file", async function () {
                        let rs = stream.Readable.from(expectedData);

                        let lastStatus;
                        try {
                            await agent.upload(testPath, rs, (_progress, status) => {
                                lastStatus = status;
                            });
                        } catch (err) {
                            assert(
                                false,
                                `Error uploading file during '${lastStatus} stage: ${err}`,
                            );
                        }
                    });

                    it("can stat a file", async function () {
                        let stat = await agent.stat(testPath);
                        assert.strictEqual(stat.name, testPath);
                    });

                    it("can change a files attributes", async function () {
                        await agent.changeFileAttributes(testPath, { mode: 511 });
                        let stat = await agent.stat(testPath);
                        assert.strictEqual(stat.mode, 33279);
                    });

                    it("can download files", async function () {
                        try {
                            let downloaded = await new Promise((resolve) => {
                                const rs = agent.download(testPath);
                                let bufs = [];
                                rs.on("data", function (chunk) {
                                    bufs.push(chunk);
                                });
                                rs.on("end", function () {
                                    resolve(Buffer.concat(bufs));
                                });
                            });

                            assert(Buffer.compare(downloaded, expectedData) === 0);
                        } catch (err) {
                            assert(false, `Error reading downloadable file ${err}`);
                        }
                    });

                    it("can delete files", async function () {
                        await agent.deleteFile(testPath).then((path) => {
                            assert(path === undefined);
                        });

                        // We should get an OperationFailed since the file is gone
                        try {
                            await agent.stat(testPath);
                        } catch (error) {
                            if (CONFIGURATION.testFlavor === "ranchu") {
                                assert(error.toString().includes("No such file or directory"));
                            } else {
                                assert(
                                    error
                                        .toString()
                                        .includes("Stat of file '" + testPath + "' failed."),
                                );
                            }
                        }
                    });
                });

                describe(`configuration profiles ${instanceVersion}`, function () {
                    if (CONFIGURATION.testFlavor === "ranchu") {
                        // These are unimplemented on ranchu devices
                        it("cannot use profile/list", async function () {
                            assert.rejects(() => agent.profileList());
                        });

                        it("cannot use profile/install", async function () {
                            assert.rejects(() => agent.installProfile("test"));
                        });

                        it("cannot use profile/remove", async function () {
                            assert.rejects(() => agent.removeProfile("test"));
                        });

                        it("cannot use profile/get", async function () {
                            assert.rejects(() => agent.getProfile("test"));
                        });
                    } else {
                        let profileID = "TBA";

                        it.skip("can use profile/list", async function () {
                            await agent.profileList();
                        });

                        it.skip("can use profile/install", async function () {
                            var profile = fs.readFileSync(path.join(__dirname, "TBA.mobileconfig"));
                            await agent.installProfile(profile);
                        });

                        it.skip("can use profile/get", async function () {
                            await agent.getProfile(profileID);
                        });

                        it.skip("can use profile/remove", async function () {
                            await agent.removeProfile(profileID);
                        });
                    }
                });

                describe(`provisioning profiles ${instanceVersion}`, function () {
                    if (CONFIGURATION.testFlavor === "ranchu") {
                        // These are unimplemented on ranchu devices
                        it("cannot use provisioning/list", async function () {
                            assert.rejects(() => agent.listProvisioningProfiles());
                        });

                        it("cannot use provisioning/install", async function () {
                            assert.rejects(() => agent.installProvisioningProfile("test", true));
                        });

                        it("cannot use provisioning/remove", async function () {
                            assert.rejects(() => agent.removeProvisioningProfile("test"));
                        });

                        it("cannot use provisioning/preapprove", async function () {
                            assert.rejects(() => agent.preApproveProvisioningProfile());
                        });
                    } else {
                        let certID = "TBA";
                        let profileID = "TBA";

                        it.skip("can use provisioning/install", async function () {
                            var profile = fs.readFileSync(
                                path.join(__dirname, "embedded.mobileprovision"),
                            );
                            await agent.installProvisioningProfile(profile, true);
                        });

                        it.skip("can use provisioning/list", async function () {
                            await agent.listProvisioningProfiles();
                        });

                        it.skip("can use provisioning/remove", async function () {
                            await agent.removeProvisioningProfile(profileID);
                        });

                        it.skip("can use provisioning/preapprove", async function () {
                            await agent.preApproveProvisioningProfile(certID, profileID);
                        });
                    }
                });

                describe(`locks ${instanceVersion}`, function () {
                    if (CONFIGURATION.testFlavor === "ranchu") {
                        // These are unimplemented on ranchu devices
                        it("cannot use lock", async function () {
                            assert.rejects(() => agent.lockDevice());
                        });

                        it("cannot use unlock", async function () {
                            assert.rejects(() => agent.unlockDevice());
                        });

                        it("cannot use acquireDisableAutolockAssertion", async function () {
                            assert.rejects(() => agent.acquireDisableAutolockAssertion());
                        });

                        it("cannot use releaseDisableAutolockAssertion", async function () {
                            assert.rejects(() => agent.releaseDisableAutolockAssertion());
                        });
                    } else {
                        it("can use lock", async function () {
                            await agent.lockDevice();
                        });

                        it("can use unlock", async function () {
                            await agent.unlockDevice();
                        });

                        it("can use acquireDisableAutolockAssertion", async function () {
                            await agent.acquireDisableAutolockAssertion();
                        });

                        it("can use releaseDisableAutolockAssertion", async function () {
                            await agent.releaseDisableAutolockAssertion();
                        });
                    }
                });

                describe(`UI automation ${instanceVersion}`, function () {
                    if (CONFIGURATION.testFlavor === "ranchu") {
                        // These are unimplemented on ranchu devices
                        it("cannot use enableUIAutomation", async function () {
                            assert.rejects(() => agent.enableUIAutomation());
                        });

                        it("cannot use disableUIAutomation", async function () {
                            assert.rejects(() => agent.disableUIAutomation());
                        });
                    } else {
                        it("can use enableUIAutomation", async function () {
                            await agent.enableUIAutomation();
                        });

                        it("can use disableUIAutomation", async function () {
                            await agent.disableUIAutomation();
                        });
                    }
                });

                describe(`WiFi ${instanceVersion}`, function () {
                    if (CONFIGURATION.testFlavor === "ranchu") {
                        // These are unimplemented on ranchu devices
                        it("cannot use connectToWifi", async function () {
                            assert.rejects(() => agent.connectToWifi());
                        });

                        it("cannot use disconnectFromWifi", async function () {
                            assert.rejects(() => agent.disconnectFromWifi());
                        });
                    } else {
                        it("can use disconnectFromWifi", async function () {
                            await agent.disconnectFromWifi();

                            // Wait a bit to avoid WiFi connection race on some devices
                            await new Promise((resolve) => setTimeout(resolve, 1000));
                        });

                        it("can use connectToWifi", async function () {
                            await agent.connectToWifi();
                        });
                    }
                });

                let bundleID = "";
                if (CONFIGURATION.testFlavor === "ranchu") bundleID = "com.corellium.test.app";
                else bundleID = "com.corellium.Red";
                describe(`Applications ${instanceVersion}`, function () {
                    it("can install a signed apk/ipa", function () {
                        this.slow(50000);
                        this.timeout(100000);

                        let appFile = "";
                        if (CONFIGURATION.testFlavor === "ranchu") {
                            appFile = "api-test.apk";
                        } else {
                            appFile = "Red.ipa";
                        }
                        return agent
                            .installFile(fs.createReadStream(path.join(__dirname, appFile)))
                            .then(() => (installSuccess = true));
                    });

                    it("can run an app", async function () {
                        assert(
                            installSuccess,
                            "This test cannot run because application installation failed",
                        );
                        await agent.run(bundleID);
                    });

                    it("can kill an app", async function () {
                        assert(
                            installSuccess,
                            "This test cannot run because application installation failed",
                        );
                        await agent.kill(bundleID);
                    });
                });

                describe(`crash watcher ${instanceVersion}`, function () {
                    let crashListener;

                    before(
                        setFlagIfHookFailedDecorator(async function () {
                            const instance = instanceMap.get(instanceVersion);
                            await instance.waitForState("on");
                            await instance.waitForAgentReady();
                            crashListener = await instance.newAgent();
                        }),
                    );

                    after(
                        setFlagIfHookFailedDecorator(async function () {
                            if (crashListener !== undefined && crashListener.connected)
                                crashListener.disconnect();
                        }),
                    );

                    it("can catch an expected crash", function () {
                        return new Promise((resolve) => {
                            assert(
                                installSuccess,
                                "This test cannot run because application installation failed",
                            );
                            let targetLine = "";
                            if (CONFIGURATION.testFlavor === "ranchu") {
                                targetLine = "com.corellium.test.app";
                            } else {
                                targetLine = "com.apple.Maps";
                            }
                            return crashListener.ready().then(() => {
                                crashListener
                                    .crashes(targetLine, (err, crashReport) => {
                                        assert(!err, err);
                                        assert(
                                            crashReport !== undefined,
                                            "The crash report is undefined",
                                        );
                                        assert(
                                            crashReport.includes(targetLine),
                                            `The crash reported doesn't include "${targetLine}":\n\n${crashReport}`,
                                        );
                                        resolve();
                                    })
                                    .catch((error) => {
                                        if (
                                            error.message &&
                                            error.message.includes("disconnected")
                                        ) {
                                            return;
                                        }
                                        throw error;
                                    });
                                if (CONFIGURATION.testFlavor === "ranchu") {
                                    return agent.runActivity(
                                        "com.corellium.test.app",
                                        "com.corellium.test.app/com.corellium.test.app.CrashActivity",
                                    );
                                } else {
                                    return agent.run("com.apple.Maps");
                                }
                            });
                        });
                    });
                });

                describe(`SSL pinning control ${instanceVersion}`, function () {
                    if (CONFIGURATION.testFlavor === "ranchu") {
                        // These are unimplemented on ranchu devices
                        it("cannot use enableSSLPinning", async function () {
                            assert.rejects(() => agent.enableSSLPinning());
                        });

                        it("cannot use isSSLPinningEnabled", async function () {
                            assert.rejects(() => agent.isSSLPinningEnabled());
                        });

                        it("cannot use disableSSLPinning", async function () {
                            assert.rejects(() => agent.disableSSLPinning());
                        });
                    } else {
                        it("can use enableSSLPinning", async function () {
                            await agent.enableSSLPinning();
                        });

                        it("can use isSSLPinningEnabled", async function () {
                            assert(await agent.isSSLPinningEnabled());
                        });

                        it("can use disableSSLPinning", async function () {
                            await agent.disableSSLPinning();
                        });
                    }
                });

                describe(`Network Monitor ${instanceVersion}`, function () {
                    let netmon;

                    after(
                        "disconnect network monitor",
                        setFlagIfHookFailedDecorator(function () {
                            if (CONFIGURATION.testFlavor !== "ranchu") {
                                agent.kill("com.saurik.Cydia");
                            }

                            netmon.disconnect();
                        }),
                    );

                    it("can get monitor", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        netmon = await instance.newNetworkMonitor();
                    });

                    it("can start monitor", function () {
                        return netmon.start();
                    });

                    it("can monitor data", function () {
                        assert(
                            installSuccess,
                            `This test can't run because application installation failed.`,
                        );

                        return new Promise((resolve) => {
                            this.slow(80000);
                            this.timeout(100000);

                            netmon.handleMessage((message) => {
                                const hostHeader = message.request.headers.find(
                                    (header) => header.key === "Host",
                                );
                                if (CONFIGURATION.testFlavor === "ranchu") {
                                    if (hostHeader.value === "corellium.com") {
                                        netmon.handleMessage(null);
                                        resolve();
                                    }
                                } else {
                                    if (hostHeader.value === "cydia.zodttd.com") {
                                        netmon.handleMessage(null);
                                        resolve();
                                    }
                                }
                            });

                            // The test application gets ECONNREFUSEDs if it's run too soon after
                            // Network Monitor starts.
                            return new Promise((resolve) => setTimeout(resolve, 1000 * 5)).then(
                                () => {
                                    if (CONFIGURATION.testFlavor === "ranchu") {
                                        return agent.runActivity(
                                            "com.corellium.test.app",
                                            "com.corellium.test.app/com.corellium.test.app.NetworkActivity",
                                        );
                                    } else {
                                        return agent.run("com.saurik.Cydia");
                                    }
                                },
                            );
                        });
                    });

                    it("can stop monitor", function () {
                        return netmon.stop();
                    });

                    it("can clear log", function () {
                        return netmon.clearLog();
                    });
                });

                describe(`Frida ${instanceVersion}`, function () {
                    let pid = 0;
                    let name = "";

                    if (CONFIGURATION.testFlavor === "ranchu") {
                        it("can get process list", async function () {
                            let procList = await agent.runFridaPs();
                            let lines = procList.output.trim().split("\n");
                            lines.shift();
                            lines.shift();
                            for (const line of lines) {
                                [pid, name] = line.trim().split(/\s+/);
                                if (name === "keystore") {
                                    break;
                                }
                            }
                            assert(pid != 0);
                        });
                    } else {
                        it("cannot get process list", async function () {
                            assert.rejects(() => agent.runFridaPs());
                        });
                    }

                    it("can get console", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        const consoleStream = await instance.fridaConsole();

                        consoleStream.socket.on("close", function () {
                            consoleStream.destroy();
                        });
                        consoleStream.socket.close();
                    });

                    describe("frida attaching and execution", function () {
                        if (CONFIGURATION.testFlavor === "ranchu") {
                            it("can attach frida", async function () {
                                if (name === "") {
                                    name = "keystore";
                                }
                                await agent.runFrida(pid, name);
                                let processList;
                                do {
                                    processList = await agent.runFridaPs();
                                } while (
                                    !(
                                        processList.attached &&
                                        processList.attached.target_name === name
                                    )
                                );
                            });

                            it("can get frida scripts", async function () {
                                let fridaScripts = await agent.stat(
                                    "/data/corellium/frida/scripts/",
                                );
                                let scriptList = fridaScripts.entries.map((entry) => entry.name);
                                let s = "";
                                for (s of scriptList) {
                                    if (s === "hook_native.js") break;
                                }
                                assert(s != "");
                            });

                            it.skip("can execute script", async function () {
                                const instance = instanceMap.get(instanceVersion);
                                await instance.executeFridaScript(
                                    "/data/corellium/frida/scripts/hook_native.js",
                                );
                                await new Promise((resolve) => setTimeout(resolve, 5000));

                                let fridaConsole = await instance.fridaConsole();
                                let fridaOutput = await new Promise((resolve) => {
                                    const w = new stream.Writable({
                                        write(chunk, _encoding, _callback) {
                                            fridaConsole.socket.close();
                                            resolve(chunk);
                                        },
                                    });
                                    fridaConsole.pipe(w);
                                });
                                assert(fridaOutput.toString().includes("Hook android_log_write()"));
                            });

                            it("can detach frida", async function () {
                                await agent.runFridaKill();
                            });
                        } else {
                            it("cannot attach frida", async function () {
                                assert.rejects(() => agent.runFrida(1, "launchd"));
                            });

                            it("cannot get frida scripts", async function () {
                                assert.rejects(() => agent.stat("/data/corellium/frida/scripts/"));
                            });

                            it.skip("cannot execute script", async function () {
                                const instance = instanceMap.get(instanceVersion);
                                await instance.executeFridaScript(
                                    "/data/corellium/frida/scripts/hook_native.js",
                                );
                            });

                            it("cannot detach frida", async function () {
                                assert.rejects(() => agent.runFridaKill());
                            });
                        }
                    });
                });

                describe(`app clean up ${instanceVersion}`, function () {
                    it("can uninstall an app", async function () {
                        assert(
                            installSuccess,
                            "This test cannot run because application installation failed",
                        );

                        let lastStatus;
                        try {
                            await agent.uninstall("com.corellium.test.app", (_progress, status) => {
                                lastStatus = status;
                            });
                        } catch (err) {
                            assert(
                                false,
                                `Error uninstalling app during '${lastStatus} stage: ${err}`,
                            );
                        }
                    });
                });

                describe(`CoreTrace ${instanceVersion}`, function () {
                    let pid = 0;

                    it("can get thread list", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        let threadList = await instance.getCoreTraceThreadList();
                        for (let p of threadList) {
                            if (p.name.includes("corelliumd")) {
                                pid = p.pid;
                                break;
                            }
                        }
                        assert(pid != 0);
                    });

                    it("can set filter", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.setCoreTraceFilter([pid], [], []);
                    });

                    it("can start capture", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.startCoreTrace();
                    });

                    it.skip("can capture data", async function () {
                        let statTarget = "";
                        const instance = instanceMap.get(instanceVersion);
                        if (CONFIGURATION.testFlavor === "ranchu")
                            statTarget = "/data/corellium/frida/scripts/";
                        else statTarget = "/var/mobile/Media";
                        await agent.stat(statTarget);
                        await new Promise((resolve) => setTimeout(resolve, 9000));
                        const log = await instance.downloadCoreTraceLog();
                        assert(log !== undefined);
                        assert(log.toString().includes(":corelliumd"));
                    });

                    it("can stop capture", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.stopCoreTrace();
                    });

                    it("can clear filter", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.clearCoreTraceFilter();
                    });

                    it("can clear log", async function () {
                        const instance = instanceMap.get(instanceVersion);
                        await instance.clearCoreTraceLog();
                    });
                });
            });
        });
    });
});
