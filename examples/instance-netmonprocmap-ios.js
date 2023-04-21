const { Corellium } = require('@corellium/corellium-api')
const yargs = require('yargs/yargs')

const argv = yargs(process.argv).argv

function usage() {
  console.log(
    'Usage: ' +
      argv._[1] +
      ' [--endpoint <endpoint>] --user <user> --password <pw> --project <project> --instance <instance> [download | stream]'
  )
  process.exit(-1)
}

const user = argv.user
const pw = argv.password
const uuid = argv.instance
const projectName = argv.project
const cmd = argv._[2]
var endpoint = 'https://app.corellium.com'

if (argv.endpoint !== undefined) {
  endpoint = argv.endpoint
}

if (user == undefined || pw == undefined) {
  console.log('username and password must be specified')
  usage()
}

if (projectName == undefined) {
  console.log('project must be specified')
}

if (uuid == undefined) {
  console.log('instance must be specified')
  usage()
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function main() {
  // Configure the API.
  let corellium = new Corellium({
    endpoint: endpoint,
    username: user,
    password: pw
  })

  console.log('Logging in...')
  // Login.
  await corellium.login()

  console.log('Getting projects list...')
  // Get the list of projects.
  let projects = await corellium.projects()
  // Find the project
  let project = projects.find(project => project.name == projectName)
  // Get the instances in the project.
  console.log('Getting instances...')
  let instances = await project.instances()
  let instance = instances.find(instance => instance.id === uuid)
  if (instance == undefined) {
    console.log('Instance ' + uuid + ' not found')
    process.exit(-1)
  }

  console.log('Waiting for agent')
  await instance.waitForAgentReady()
  var agent = await instance.agent()
  console.log('Agent obtained')
  await agent.ready()

  if (cmd === 'stream') {
    let networkMonitorProcessMap = await instance.newNetworkMonitorProcessMap()
    networkMonitorProcessMap.handleMessage(message => {
      if (Buffer.isBuffer(message)) {
        console.log(message.toString())
      } else {
        console.log(message)
      }
    })
    await networkMonitorProcessMap.start()
    console.log('Network monitor process map started')
    await sleep(5000)
    await networkMonitorProcessMap.disconnect()
    networkMonitorProcessMap.handleMessage(undefined)
    await networkMonitorProcessMap.stop()
    console.log('Network monitor process map stopped')
  } else if (cmd === 'download') {
    console.log('Downloading pcap file')
    let pcap = await instance.downloadPcap()
    console.log(pcap.toString())
  }

  console.log('Done')
  process.exit(0)
}

main().catch(err => {
  console.error(err)
})
