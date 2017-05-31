//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const exec = require('child-process-promise').exec;
const fs = require('mz/fs');
const npmRegistryClient = require('npm-registry-client');
const path = require('path');
const Q = require('q');
const tmp = require('tmp');

const emailRender = require('../../lib/emailRender');
const findNpm = require('./findNpm');
const wrapError = require('../../utils').wrapError;

const defaultCloneTimeout =  1000 * 60 * 2; // allow 2 minutes to clone the repository
const defaultPublishTimeout = 1000 * 60 * 1; // allow 1 minute to publish the package
const npmRegistryAuthUri = '//registry.npmjs.org/';
const npmRegistryRootUri = `https:${npmRegistryAuthUri}`;
const npmRegistryUri = `${npmRegistryRootUri}npm`;

  // OPTIONS
  //---------
  // operations (required)
  // npm.username (on behalf of username, should have been validated in the past)
  // allowPublishingExistingPackages (whether to allow any user to publish to an official package, false by default)
  // ignorePublishScripts (acknowledgement from the user that their publish scripts will be ignored if scripts are present)
  // collaborators (array of npm usernames who will be given permission to also push the package)
  // notify (array of e-mail addresses to notify about the npm creation)

module.exports = function publish(options) {
  const operations = options.operations;
  const npmOnBehalfOf = options.npm ? options.npm.username : null;
  if (!operations) {
    return Q.reject(new Error('Missing operations parameter'));
  }
  if (!npmOnBehalfOf) {
    return Q.reject(new Error('Missing requestor NPM username'));
  }
  if (!operations.config.npm.publishing.token) {
    return Q.reject(new Error('Missing NPM token'));
  }
  if (!options.clone) {
    return Q.reject(new Error('No Git repo provided to clone'));
  }

  const context = {
    options: options,
    temp: {},
    package: null,
    log: [],
  };

  const finalCleanupTemporaryPath = cleanupIfNeeded.bind(null, context);

  return Q(context)

    .then(learnNpmVersion)
    .then(learnNpmUser)
    .then(createTemporaryPath)
    .then(cloneRepository)
    .then(discoverPackageMetadata)
    .then(validatePackageOwnership)
    .then(processPublishScripts)
    .then(placePublishingToken)
    .then(publishPackage)
    .then(assignOwners)
    .then(notify)

    .finally(finalCleanupTemporaryPath);
};

function notify(context) {
  const operations = context.options.operations;
  const notifyPeople = context.options.notify;
  const notifyPerson = operations.config.npm.publishing ? operations.config.npm.publishing.notify : null;
  const mailProvider = operations.mailProvider;
  if (!mailProvider) {
    return Q(context);
  }
  return getUserEmailAddress(context, operations).then(address => {
    let to = [];
    let cc = [];
    if (address) {
      to.push(address);
    }
    if (notifyPeople && notifyPeople.length) {
      for (let i = 0; i < notifyPeople.length; i++) {
        to.push(notifyPeople[i]);
      }
    }
    if (notifyPerson) {
      (to.length === 0 ? to : cc).push(notifyPerson);
    }
    return sendEmail(mailProvider, to, cc, context);
  });
}

function sendEmail(mailProvider, to, cc, context) {
  const deferred = Q.defer();
  const headline = context.package.name + ' published';
  const subject = `NPM ${context.packageVersionedName} published by ${context.options.upn}`;
  const emailTemplate = 'npm/published';
  const mail = {
    to: to,
    cc: cc,
    from: context.options.operations.config.npm.publishing.notifyFrom,
    subject: subject,
    reason: `You are receiving this e-mail because ${context.options.upn} published an NPM package and chose to notify you of this event. To stop receiving mails like this, please approach ${context.options.upn} and ask to no longer be notified.`,
    headline: headline,
    classification: 'information',
    service: 'Microsoft NPM publishing',
  };
  const contentOptions = {
    log: context.log,
    context: context,
  };
  emailRender.render(context.options.basedir, emailTemplate, contentOptions, (renderError, mailContent) => {
    if (renderError) {
      return deferred.resolve(context);
    }
    mail.content = mailContent;
    mailProvider.sendMail(mail, (mailError) => {
      if (mailError) {
        context.log.push('There was a problem sending the notification e-mail, but the package was published OK');
      } else {
        context.log.push('Sent notification e-mail');
      }
      return deferred.resolve(context);
    });
  });
  return deferred.promise;
}

function getUserEmailAddress(context, operations) {
  const deferred = Q.defer();
  const mailAddressProvider = operations.mailAddressProvider;
  if (!mailAddressProvider) {
    return Q();
  }
  const upn = context.options.upn;
  if (!upn) {
    return Q();
  }
  mailAddressProvider.getAddressFromUpn(upn, (resolveError, mailAddress) => {
    if (!resolveError && mailAddress) {
      return deferred.resolve(mailAddress);
    }
    return deferred.resolve();
  });
  return deferred.promise;
}

function assignOwners(context) {
  const ownerPromises = [];
  const collaborators = context.options.collaborators || [];
  collaborators.push(context.options.npm.username);
  for (let i = 0; i < collaborators.length; i++) {
    ownerPromises.push(assignOwner(context, context.packageName, collaborators[i]));
  }
  return Q.allSettled(ownerPromises).then(settled => {
    for (let i = 0; i < settled.length; i++) {
      const st = settled[i];
      const settledMessage = st.reason || st.value;
      context.log.push(settledMessage);
    }
    return Q(context);
  });
}

function assignOwner(context, packageName, newOwner) {
  const cmd = `${context.npmLocation} owner add ${newOwner}`;
  const options = {
    cwd: context.temp.repoPath,
  };
  return exec(cmd, options).then(npmOutput => {
    const cp = npmOutput.childProcess;
    if (!cp || cp.exitCode !== 0) {
      throw new Error('There was a problem with NPM.');
    }
    // note, output will have + then the username IF they are added
    context.log.push(`Added ${newOwner} as a package collaborator`);
    return Q();
  });
}

function placePublishingToken(context) {
  const cwd = context.temp.repoPath;
  const npmrc = path.join(cwd, '.npmrc');
  const npmToken = context.options.operations.config.npm.publishing.token;
  if (!npmToken) {
    return Q.reject(new Error('No publishing token is available'));
  }
  const token = `${npmRegistryAuthUri}:_authToken=${npmToken}`;
  return fs.writeFile(npmrc, token, 'utf8').then(() => {
    return Q(context);
  }, failed => {
    throw wrapError(failed, 'Could not authorize the system to publish the package');
  });
}

function learnNpmUser(context) {
  const deferred = Q.defer();
  const config = context.options.operations.config;
  const npm = new npmRegistryClient();
  const npmParameters = {
    timeout: 2000,
    auth: {
      token: config.npm.publishing.token,
    },
  };
  npm.whoami(npmRegistryUri, npmParameters, (error, username) => {
    if (error) {
      return deferred.reject(wrapError(error, 'Could not validate the publishing NPM user'));
    }

    context.npmServiceAccount = username;
    return deferred.resolve(context);
  });
  return deferred.promise;
}

function discoverPackageMetadata(context) {
  const cwd = context.temp.repoPath;
  const pkgPath = path.join(cwd, 'package.json');
  return fs.readFile(pkgPath, 'utf8').then(contents => {
    const packageParsed = JSON.parse(contents);
    context.package = packageParsed;
    return Q(context);
  }, notFound => {
    return Q.reject(wrapError(notFound, 'The repository does not have a "package.json" file in the root, so cannot be published by this system. Is it a Node.js library or application?'));
  });
}

function processPublishScripts(context) {
  if (!context || !context.package) {
    throw new Error('The "package.json" file could not be properly processed.');
  }

  const scripts = context.package.scripts;
  if (!scripts) {
    return Q(context);
  }

  const packageName = context.package.name;
  const packageVersionedName = `${packageName}@${context.package.version}`;
  context.packageVersionedName = packageVersionedName;
  context.log.push(`Publishing version ${packageVersionedName}`);

  const ignorePublishScripts = context.options.ignorePublishScripts || false;

  const scriptsNotPermitted = [
    'prepublish',
    'prepare',        // New for NPM 4
    'prepublishOnly', // New for NPM 4, temporarily
  ];

  // Scan for scripts that could be a security concern. The underlying worry is
  // that a publish script, of which there are a few varieties in the NPM 4 era,
  // could learn how to read the official token for the organization, going
  // rogue. This does mean that packages that are built in CoffeeScript or TS
  // will need to either publish a dummy first package, or create a temporary
  // branch with the output, etc. This is also actually a good thing, since the
  // goal here is not to be a build server or offer runtime/devtime dep. to
  // build a proper package.
  let updatedPackage = false;
  let invalidScripts = [];
  for (let i = 0; i < scriptsNotPermitted.length; i++) {
    const scriptName = scriptsNotPermitted[i];
    if (scripts[scriptName]) {
      if (ignorePublishScripts) {
        delete scripts[scriptName];
        context.log.push(`For security reasons, the ${scriptName} script was not processed for this publish operation. Please publish an incremental update using your authorized NPM client if you need the script to properly build the release package.`);
        updatedPackage = true;
      } else {
        invalidScripts.push(scriptName);
      }
    }
  }

  // Interrupt the process for a user choice
  if (invalidScripts.length > 0) {
    const scriptsList = invalidScripts.join(', ');
    const userChoiceError = new Error(`The package.json file for the ${packageVersionedName} NPM contains scripts that cannot be executed for security purposes. This system is not a build server. The script(s) in question are: ${scriptsList}.`);
    userChoiceError.userChoice = true;
    userChoiceError.userChoiceType = 'removeScripts';
    userChoiceError.npmScriptNames = invalidScripts;
    throw userChoiceError;
  }

  if (updatedPackage) {
    context.securityUpdates = true;
    return updateLocalPackage(context);
  } else {
    return Q(context);
  }
}

function updateLocalPackage(context) {
  const updatedPackage = context.package;
  const content = JSON.stringify(updatedPackage, undefined, 2);

  const cwd = context.temp.repoPath;
  const pkgPath = path.join(cwd, 'package.json');
  return fs.writeFile(pkgPath, content, 'utf8').then(() => {
    context.log.push('Updated package.json file for security purposes');
    return Q(context);
  }, (/*failedWrite*/) => {
    throw new Error('Could not update the package.json ahead of publishing');
  });
}

function learnNpmVersion(context) {
  return findNpm().then(npmLocation => {
    if (npmLocation.includes(' ')) {
      npmLocation = '"' + npmLocation + '"';
    }
    context.npmLocation = npmLocation;
    const cmd = `${npmLocation} -v`;
    return exec(cmd).then(npmOutput => {
      const cp = npmOutput.childProcess;
      if (!cp || cp.exitCode !== 0) {
        throw new Error('There was a problem with NPM.');
      }
      const version = (npmOutput.stdout || '').trim();
      if (!version) {
        throw new Error('There was a problem trying to identify the NPM version available to the publishing service.');
      }
      context.npmVersion = version;
      context.log.push(`Using NPM version ${version} to publish`);
      return Q(context);
    }, failure => {
      throw wrapError(failure, 'NPM is not be available for publishing at this time or cannot be found.');
    });
  });
}

function publishPackage(context) {
  const options = {
    cwd: context.temp.repoPath,
    timeout: context.options.publishTimeout || defaultPublishTimeout,
  };
  const cmd = `${context.npmLocation} publish --access public`;
  return exec(cmd, options).then((/*publishResult*/) => {
    return Q(context);
    // exitCode for hte process is 0; stderr "" stdout has the log
  }, failure => {
    if (failure.code === 1 && failure.stderr && failure.stderr.includes('cannot publish over')) {
      throw wrapError(failure, `You cannot publish over a previously published identical version ${context.packageVersionedName}. Please commit an incremented version to your package.json file.`, true);
    }

    throw failure;
  });
}

function cloneRepository(context) {
  let gitRepo = context.options.clone;
  let gitBranch = context.options.branch || 'master';
  const localRepoPath = 'repo';
  const options = {
    cwd: context.temp.path,
    timeout: context.options.cloneTimeout || defaultCloneTimeout,
  };
  const cmd = `git clone ${gitRepo} --branch ${gitBranch} --single-branch ${localRepoPath}`;
  context.temp.repoPath = path.join(options.cwd, localRepoPath);
  return exec(cmd, options).then(() => {
    return Q(context);
  }, failure => {
    let error = failure;
    if (failure.killed) {
      error = new Error(`The Git repository ${gitRepo} and branch ${gitBranch} could not be cloned and processed in time. The operation took too long.`);
    } else if (failure.stderr) {
      error = new Error(`The Git repository ${gitRepo} (branch ${gitBranch}) ran into trouble trying to clone and process: ${failure.stderr}`);
    }
    throw error;
  });
}

function createTemporaryPath(context) {
  const deferred = Q.defer();
  const pathOptions = {
    unsafeCleanup: true,
    prefix: 'npm-',
  };
  tmp.dir(pathOptions, (createPathError, path, cleanupCallback) => {
    if (createPathError) {
      return deferred.reject(createPathError);
    }
    context.temp.path = path;
    context.temp.cleanup = cleanupCallback;
    return deferred.resolve(context);
  });
  return deferred.promise;
}

function cleanupIfNeeded(context) {
  if (context && context.temp && context.temp.cleanup) {
    const deferred = Q.defer();
    context.temp.cleanup(() => {
      deferred.resolve();
    });
    return deferred.promise;
  } else {
    return Q();
  }
}

function validatePackageOwnership(context) {
  // If we have "read-write" access to an existing owner, either
  // the user making the request or the primary account name, this
  // is OK. If allowPublishingExistingPackages is not enabled,
  // then only the user themselves can be authorized to publish
  // here. That is to prevent security incidents where someone
  // overwrites a package with a new version.
  const allowedUsernames = new Set();
  const allowPublishingExistingPackages = context.options.allowPublishingExistingPackages || false;
  const npmServiceAccount = context.npmServiceAccount.toLowerCase();

  // These are the usernames we will use to see whether the user can authorize the publish
  if (allowPublishingExistingPackages) {
    allowedUsernames.add(npmServiceAccount);
  }
  const onBehalfOfUser = context.options.npm.username.toLowerCase();
  allowedUsernames.add(onBehalfOfUser);

  const deferred = Q.defer();
  const packageName = context.package.name;
  const config = context.options.operations.config;
  const npm = new npmRegistryClient();
  const params = {
    package: context.package.name,
  };
  const packageUri = `${npmRegistryRootUri}${packageName}`;
  npm.get(packageUri, params, (error, packageData) => {
    if (error && error.statusCode === 404) {
      context.log.push(`Verified that there is not yet a package named ${packageName} in the NPMJS registry.`);
      return deferred.resolve(context);
    }
    if (error) {
      return deferred.reject(error);
    }
    context.packageData = packageData;
    const params = {
      package: packageName,
      auth: {
        token: config.npm.publishing.token,
      },
    };
    // Get the current owners of the package
    return npm.access('ls-collaborators', npmRegistryUri, params, (error, collaborators) => {
      if (error) {
        return deferred.reject(wrapError(error, `Could not validate what NPM users have permission to publish the ${packageName} package.`));
      }

      let authorizedPublisher = false;
      let serviceAccountCanPublish = false;
      const usernames = Object.getOwnPropertyNames(collaborators);
      for (let i = 0; i < usernames.length; i++) {
        const username = usernames[i];
        if (collaborators[username] === 'read-write') {
          const lc = username.toLowerCase();
          if (lc === npmServiceAccount) {
            serviceAccountCanPublish = true;
          }
          if (allowedUsernames.has(lc)) {
            authorizedPublisher = true;
          }
        }
      }

      if (!serviceAccountCanPublish) {
        return deferred.reject(new Error(`The service account for publishing, ${npmServiceAccount}, is not authorized to publish the ${packageName} package to NPMJS`));
      }

      if (!authorizedPublisher) {
        return deferred.reject(new Error(`${onBehalfOfUser} is not authorized to publish the ${packageName} package to NPMJS`));
      }

      context.log.push(`Publishing the package as ${npmServiceAccount} on behalf of authorized package collaborator ${onBehalfOfUser}`);
      return deferred.resolve(context);
    });
  });
  return deferred.promise;
}
