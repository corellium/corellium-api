'use strict'

const { describe, it, before, beforeEach, after } = require('mocha')
const assert = require('assert')
const Corellium = require('../src/corellium').Corellium
const CONFIGURATION = require('./config.json')
const { setFlagIfHookFailedDecorator, validateConfig, destroyInstance } = require('./testUtils')

process.title = 'corellium-token-tests'

global.hookOrTestFailed = true

describe('corellium.js', function () {
  let INSTANCE_VERSIONS = []
  if (CONFIGURATION.testFlavor === 'ranchu') {
    this.slow(10000)
    this.timeout(20000)
    INSTANCE_VERSIONS = ['7.1.2']
  } else {
    this.slow(40000)
    this.timeout(50000)
    INSTANCE_VERSIONS = ['10.3.3']
  }

  const instanceMap = new Map()
  let corellium = null

  before(
    'should have a configuration',
    setFlagIfHookFailedDecorator(() => validateConfig(CONFIGURATION))
  )

  beforeEach(function () {
    corellium = new Corellium(CONFIGURATION)
  })

  INSTANCE_VERSIONS.forEach(instanceVersion => {
    after(setFlagIfHookFailedDecorator(() => {
      this.timeout(80000)
      destroyInstance(instanceMap, instanceVersion)
    }))
  })

  describe('getToken', function () {
    it('should reuse token from options if not expired', async () => {
      const expectedToken = { token: '123abc', expiration: new Date(new Date().getTime() + 20 * 60 * 1000) }
      corellium = new Corellium({ ...CONFIGURATION, token: expectedToken })
      const token = await corellium.getToken()
      assert(token === expectedToken.token)
    })

    it('should reuse same token if one call is not awaited', async () => {
      const token = corellium.getToken()
      const tokenTwo = await corellium.projects()
      assert(token, Promise.resolve(token))
      assert(await token, tokenTwo)
    })
  })
})
