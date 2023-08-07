function setFlagIfHookFailedDecorator (fn) {
  return function () {
    return Promise.resolve(fn.apply(this, arguments)).catch(error => {
      global.hookOrTestFailed = true
      throw error
    })
  }
}

function validateConfig (config) {
  if (
    !config.endpoint ||
    !config.project ||
    !config.testFlavor ||
    (!(config.username && config.password) && !config.apiToken)
  ) {
    throw new Error(
      'The configuration must include endpoint, project and testFlavor as well as username and password or apiToken properties.'
    )
  }
}

async function destroyInstance (instanceMap, instanceVersion) {
  const instance = instanceMap.get(instanceVersion)
  if (!instance) {
    return
  }

  // To facilitate debugging, don't destroy instances if a test or hook failed.
  if (global.hookOrTestFailed) {
    // Stop updating the instance. Otherwise the updater keeps at it and the
    // integration tests don't terminate.
    instance.project.updater.remove(instance)
    return
  }

  await instance.destroy()
  await instance.waitForState('deleted')
}

module.exports = {
  setFlagIfHookFailedDecorator,
  validateConfig,
  destroyInstance
}
