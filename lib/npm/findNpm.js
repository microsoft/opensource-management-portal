//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const fs = require('mz/fs');
const path = require('path');
const Q = require('q');

const wrapError = require('../../utils').wrapError;

function windowsPaths() {
  if (process.platform === 'win32') {
    const programFilesDir = process.env['programfiles(x86)'] || process.env.programfiles;
    return {
      nodejsDir: path.resolve(programFilesDir, 'nodejs'),
      npmRootDir: path.resolve(programFilesDir, 'npm'),
    };
  }
}

module.exports = getNpmPath;

function getNpmPath() {
  const paths = windowsPaths();
  if (!paths) {
    console.warn('This code is designed for execution on a PC.');
    return Q('npm');
  }
  const nodeVersion = process.versions.node;
  const npmLinkPath = path.resolve(paths.nodejsDir, nodeVersion, 'npm.txt');
  return getAvailableNpmVersions().then(npmPaths => {
    return fs.readFile(npmLinkPath, 'utf8').then(version => {
      const npmPath = npmPaths[version.trim()];
      if (!npmPath) {
        throw new Error(`NPM version ${version} was not found on the system, although the ${npmLinkPath} file specified it as the ideal NPM version to use.`);
      }
      return Q(npmPath);
    }, noLink => {
      throw wrapError(noLink, `This system does not appear configured either for a standard Node.js installation or for an Azure App Service environment. The NPM redirection file ${npmLinkPath} was not found.`);
    });
  }, (/* standard node install */) => {
    let bestMatch = null;
    const candidates = [path.resolve(process.env.programfiles, 'nodejs', 'npm.cmd')];
    const x86 = process.env['programfiles(x86)'];
    if (x86) {
      candidates.push(path.resolve(x86, 'nodejs', 'npm.cmd'));
    }
    return Q.allSettled(candidates.map(function evaluatePotential(loc) {
      return fs.stat(loc).then(() => {
        bestMatch = loc;
        return;
      });
    })).then(() => {
      return Q(bestMatch);
    });
  });
}

function getAvailableNpmVersions() {
  const paths = windowsPaths();
  const npmPaths = {};
  return fs.readdir(paths.npmRootDir).then(directories => {
    return Q.allSettled(directories.map(function validateInstallation(dir) {
      const binaryPath = process.platform === 'linux' ? path.resolve(paths.npmRootDir, dir, 'node_modules', 'npm', 'bin', 'npm') : path.resolve(paths.npmRootDir, dir, 'npm.cmd');
      if (!dir.match(/^\d+\.\d+\.\d+$/)) {
        return;
      }
      return fs.stat(binaryPath).then(() => {
        npmPaths[dir] = binaryPath;
      });
    })).then(() => {
      return Q(npmPaths);
    });
  });
}
