// @flow

import {
  generateMiniAppsComposite
} from 'ern-container-gen'
import {
  cauldron
} from 'ern-core'
import {
  DependencyPath,
  NativeApplicationDescriptor
} from 'ern-util'
import {
  runLocalContainerGen,
  runCauldronContainerGen
} from '../lib/publication'
import _ from 'lodash'
import inquirer from 'inquirer'
import semver from 'semver'

exports.command = 'create-container'
exports.desc = 'Run the container generator'

exports.builder = function (yargs: any) {
  return yargs
    .option('completeNapDescriptor', {
      type: 'string',
      alias: 'n',
      describe: 'Full native application selector'
    })
    .option('version', {
      type: 'string',
      alias: 'v',
      describe: 'Version of the generated container'
    })
    .option('jsOnly', {
      type: 'bool',
      alias: 'js',
      describe: 'Generates JS only (composite app)'
    })
    .option('publish', {
      type: 'boolean',
      describe: 'Publish the generated container to Maven(.aar file for android) or GitHub (Project framework for ios)'
    })
    .option('publicationUrl', {
      type: 'string',
      describe: 'The url to publish cauldron to'
    })
    .option('miniapps', {
      type: 'array',
      alias: 'm',
      describe: 'A list of one or more miniapps'
    })
    .option('platform', {
      type: 'string',
      alias: 'p',
      describe: 'The platform for which to generate the container',
      choices: ['android', 'ios', undefined]
    })
    .option('containerName', {
      type: 'string',
      describe: 'The name to user for the container (usually native application name)'
    })
    .group(['outputFolder'], 'jsOnly Options:')
    .option('outputFolder', {
      type: 'string',
      alias: 'out',
      describe: 'Output folder path'
    })
}

exports.handler = async function ({
  completeNapDescriptor,
  version,
  jsOnly,
  outputFolder,
  miniapps,
  publish,
  platform,
  containerName,
  publicationUrl
} : {
  completeNapDescriptor?: string,
  version?: string,
  publish?: boolean,
  jsOnly?: boolean,
  outputFolder?: string,
  miniapps?: Array<string>,
  platform?: 'android' | 'ios',
  containerName?: string,
  publicationUrl?: string
}) {
  let napDescriptor: ?NativeApplicationDescriptor
  let cauldronContainerVersion: ?string
  //
  // Full native application selector was not provided.
  // Ask the user to select a completeNapDescriptor from a list
  // containing all the native applications versions in the cauldron
  // Not needed if miniapps are directly provided
  if (!completeNapDescriptor && !miniapps) {
    const nativeApps = await cauldron.getAllNativeApps()

    // Transform native apps from the cauldron to an Array
    // of completeNapDescriptor strings
    // [Should probably move to a Cauldron util class for reusability]
    let result = _.flattenDeep(
      _.map(nativeApps, nativeApp =>
        _.map(nativeApp.platforms, p =>
          _.map(p.versions, version =>
            `${nativeApp.name}:${p.name}:${version.name}`))))

    const { userSelectedCompleteNapDescriptor } = await inquirer.prompt([{
      type: 'list',
      name: 'userSelectedCompleteNapDescriptor',
      message: 'Choose a native application version for which to generate container',
      choices: result
    }])

    completeNapDescriptor = userSelectedCompleteNapDescriptor
  }
  if (completeNapDescriptor) {
    napDescriptor = NativeApplicationDescriptor.fromString(completeNapDescriptor)
    // get container version from, update patch version and write it to cauldron
    const containerGeneratorConfig: any = await cauldron.getContainerGeneratorConfig(napDescriptor)
    cauldronContainerVersion = _.get(containerGeneratorConfig, 'containerVersion')
    if (cauldronContainerVersion) {
      cauldronContainerVersion = semver.inc(cauldronContainerVersion, 'patch')
    }
  }
  //
  // If the user wants to generates a complete container (not --jsOnly)
  // user has to provide a container version
  // If not specified in command line, we ask user to input the version
  if ((!version || version === 'auto') && !jsOnly) {
    if (cauldronContainerVersion && version === 'auto') {
      version = cauldronContainerVersion
    } else {
      const { userSelectedContainerVersion } = await inquirer.prompt([{
        type: 'input',
        name: 'userSelectedContainerVersion',
        message: 'Enter desired version for generated container',
        default: cauldronContainerVersion || '1.0.0'
      }])
      version = userSelectedContainerVersion
    }
  }

  let miniAppsPaths: Array<DependencyPath> = _.map(miniapps, DependencyPath.fromString)

  //
  // --jsOnly switch
  // Ony generates the composite miniapp to a provided output folder
  if (jsOnly) {
    if (!miniapps) {
      if (!napDescriptor) {
        return log.error('You need to provide a napDescriptor if not providing miniapps')
      }
      const miniAppsObjs = await cauldron.getContainerMiniApps(napDescriptor)
      miniAppsPaths = _.map(miniAppsObjs, m => DependencyPath.fromString(m.toString()))
    }

    if (!outputFolder) {
      const { userSelectedOutputFolder } = await inquirer.prompt([{
        type: 'input',
        name: 'userSelectedOutputFolder',
        message: 'Enter output folder path'
      }])

      outputFolder = userSelectedOutputFolder
    }

    await generateMiniAppsComposite(miniAppsPaths, outputFolder)
  } else {
    if (!napDescriptor && miniapps) {
      if (!platform) {
        const { userSelectedPlatform } = await inquirer.prompt([{
          type: 'list',
          name: 'userSelectedPlatform',
          message: 'Choose platform to generate container for',
          choices: ['android', 'ios']
        }])

        platform = userSelectedPlatform
      }

      await runLocalContainerGen(
        miniAppsPaths,
        platform, {
          containerVersion: version,
          nativeAppName: containerName,
          publicationUrl
        }
      )
    } else if (napDescriptor && version) {
      await runCauldronContainerGen(
        napDescriptor,
        version,
        { publish })
      // Update container version for Cauldron in Git (only if Cauldron is published)
      if (publish) {
        await cauldron.updateContainerVersion(napDescriptor, version)
      }
    }
  }
}
