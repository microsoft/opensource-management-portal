//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/* eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

// The reporting system in use here is best described as a "hairball" or snowball design
// as an initial approach. A large, informative set of contextual data is built by the
// report providers. It is OK for a provider in the pipeline to depend on the data
// collected before its execution.

const async = require('async');
const azure = require('azure-storage');
const fileSize = require('file-size');
const fs = require('fs');
const moment = require('moment-timezone');
const os = require('os');
const path = require('path');
const Q = require('q');

const organizationReports = require('./organizations');
const repositoryReports = require('./repositories');
const buildRecipientMap = require('./consolidated').buildRecipientMap;

const fileCompression = require('./fileCompression');
const mailer = require('./mailer');
const RedisHelper = require('../../lib/redis');

// Debug-related values for convienience
const fakeSend = false;
const skipStore = false;
const slice = undefined; // 250;

const reportProviders = {
  organizations: organizationReports,
  repositories: repositoryReports,
};

const reportGeneratedFormat = 'h:mm a dddd, MMMM Do YYYY';

function buildReport(context) {
  return Q(context)
    .then(processReports)
    .then(buildReports)
    .then(consolidateReports)
    .then(storeReports)
    .then(sendReports)
    .then(recordMetrics)
    .then(dataLakeUpload)
    .then(finalizeEvents);
}

module.exports = function run(started, startedString, config) {
  console.log(`Report run started ${startedString}`);
  const app = require('../../app');
  config.skipModules = new Set([
    'web',
  ]);
  config.optInModules = new Set([
    'witnessRedis',
  ]);
  app.initializeApplication(config, null, error => {
    if (error) {
      throw error;
    }
    const insights = app.settings.appInsightsClient;
    if (!insights) {
      throw new Error('No app insights client available');
    }
    insights.trackEvent('JobReportsStarted', {
      hostname: os.hostname(),
    });
    const operations = app.settings.operations;

    if (!operations.mailProvider) {
      throw new Error('No mail provider available');
    }
    const providers = operations.providers;
    const reportRedisClient = providers.witnessRedis ? new RedisHelper(providers.witnessRedis) : null;
    const reportConfig = config && config.github && config.github.jobs ? config.github.jobs.reports : {};

    const context = {
      operations: operations,
      dataClient: providers.dataClient,
      insights: insights,
      entities: {},
      processing: {},
      reportsBy: {
        upn: new Map(),
        email: new Map(),
      },
      providers: reportProviders,
      started: moment().format(),
      organizationData: {},
      settings: {
        slice: slice || undefined,
        parallelRepoProcessing: 2,
        repoDelayAfter: 200, // 200ms to wait between repo actions, to help reduce GitHub load
        tooManyOrgOwners: 5,
        tooManyRepoAdministrators: 15,
        orgPercentAvailablePrivateRepos: 0.15,
        fakeSend: fakeSend ? path.join(__dirname, 'sent') : undefined,
        storeLocalReportPath: skipStore ? path.join(__dirname, 'report.json') : undefined,
        witnessEventKey: reportConfig.witnessEventKey,
        witnessEventReportsTimeToLiveMinutes: reportConfig.witnessEventReportsTimeToLiveMinutes,
        consolidatedSchemaVersion: '170503',
        fromAddress: reportConfig.mail.from,
      },
      reports: {
        reportRedisClient: reportRedisClient,
        send: true && (fakeSend || reportConfig.mail && reportConfig.mail.enabled),
        store: true && !skipStore,
        dataLake: true && !skipStore && reportConfig.dataLake && reportConfig.dataLake.enabled,
      },
      visitedDefinitions: {},
      consolidated: {},
      config: config,
      app: app,
    };

    if (context.reports.dataLake === true && reportConfig.dataLake && reportConfig.dataLake.azureStorage && reportConfig.dataLake.azureStorage.key) {
      context.settings.dataLakeAccount = reportConfig.dataLake.azureStorage;
    }

    context.getReports = (typeOfIndex, indexValue) => {
      const reportsBy = context.reportsBy;
      const type = reportsBy[typeOfIndex];
      if (!type) {
        throw new Error(`No such issues-by set of type ${typeOfIndex}`);
      }
      let reports = type.get(indexValue);
      if (!reports) {
        reports = {};
        type.set(indexValue, reports);
      }
      return reports;
    };

    return buildReport(context).then(() => {
      console.log('reporting done');
    }).catch(error => {
      console.warn(error);
    }).finally(() => {
      // Allow updates and other actions
      console.log('Will close in 30 seconds');
      setTimeout(() => {
        process.exit(0);
      }, 1000 * 30);
    }).done();
  });
};

// ------------------------------------------------------------------

function buildReports(context) {
  return providerCall(context, 'build');
}

function processReports(context) {
  return providerCall(context, 'process');
}

function consolidateReports(context) {
  return providerCall(context, 'consolidate').then(() => {
    context.reportsByRecipient = buildRecipientMap(context.consolidated);
    return Q(context);
  });
}

function providerCall(context, method) {
  const deferred = Q.defer();
  async.eachOfSeries(reportProviders, (provider, name, next) => {
    if (!provider[method]) {
      console.warn(`provider ${name} does not implement the method ${method}`);
      return next();
      // return deferred.resolve(context);
    }
    provider[method](context).then(() => {
      return next();
    }, error => {
      // There was an error with the individual processor, but we want to move along
      console.warn(`was an error with the ${name} provider running the method named ${method}`);
      console.warn(error);
      return next();
    });
  }, () => {
    return deferred.resolve(context);
  });
  return deferred.promise;
}

// ------------------------------------------------------------------

function finalizeEvents(context) {
  context.insights.trackEvent('JobReportsFinalizing');

  return Q(context);
}

function dataLakeUpload(context) {
  const insights = context.insights;
  if (!context.reports.dataLake) {
    insights.trackEvent('JobReportsReportDataLakeSkipped');
    return Q(context);
  }
  insights.trackEvent('JobReportsReportDataLakeStarted');

  // specific properties used for each row
  // issueProviderName:
  // issueTimestamp: started
  // issueTypeName: typeName

  let dataLakeOutput = [];

  const started = context.started;
  const consolidated = context.consolidated;
  const providerNames = Object.getOwnPropertyNames(reportProviders);
  for (let i = 0; i < providerNames.length; i++) {
    const providerName = providerNames[i];
    const root = consolidated[providerName];
    if (root) {
      const definitions = {};
      for (let x = 0; x < root.definitions.length; x++) {
        const d = root.definitions[x];
        definitions[d.name] = d;
      }
      if (root.entities) {
        for (let j = 0; j < root.entities.length; j++) {
          const entity = root.entities[j];
          if (entity && entity.issues) {
            const issueList = Object.getOwnPropertyNames(entity.issues);
            for (let k = 0; k < issueList.length; k++) {
              const issueTypeName = issueList[k];
              const issues = entity.issues[issueTypeName];
              const definition = definitions[issueTypeName];
              let targetCollectionName = null;
              if (definition && definition.hasTable) {
                targetCollectionName = 'rows';
              } else if (definition && definition.hasList) {
                targetCollectionName = 'listItems';
              }
              if (targetCollectionName && issues[targetCollectionName] && Array.isArray(issues[targetCollectionName])) {
                const collection = issues[targetCollectionName];
                for (let l = 0; l < collection.length; l++) {
                  const row = collection[l];
                  const rowValue = typeof(row) === 'object' ? row : { text: row };
                  if (!row.entityName) {
                    rowValue.entityName = entity.name;
                  }
                  if (!row.entity) {
                    const entityClone = Object.assign({}, entity);
                    delete entityClone.recipients;
                    delete entityClone.issues;
                    rowValue.entity = entityClone;
                  }
                  const dataLakeRow = Object.assign({
                    issueProviderName: providerName,
                    issueTimestamp: started,
                    issueTypeName: issueTypeName,
                  }, rowValue);
                  dataLakeOutput.push(JSON.stringify(dataLakeRow));
                }
              }
            }
          }
        }
      }
    }
  }
  if (dataLakeOutput.length) {
    insights.trackEvent('JobReportsReportDataLakeSaving');
    return saveDataLakeOutput(context, dataLakeOutput);
  } else {
    insights.trackEvent('JobReportsReportDataLakeEmptyReport');
    return Q(context);
  }
}

function saveDataLakeOutput(context, dataLakeOutput) {
  // Each line of the file is its own independent JSON object
  const text = dataLakeOutput.join('\r\n');
  const insights = context.insights;

  const dla = context.settings.dataLakeAccount;
  if (!dla) {
    throw new Error('Missing Azure Data Lake / Azure Storage Account information');
  }

  const deferred = Q.defer();

  const backupBlobService = azure.createBlobService(dla.account, dla.key);
  const containerName = dla.containerName;
  backupBlobService.createContainerIfNotExists(containerName, (createContainerError) => {
    if (createContainerError) {
      insights.trackException(createContainerError);
      return deferred.reject(createContainerError);
    }
    const blobPrefix = dla.blobPrefix || 'consolidatedReports';
    const backupBlobName = `${blobPrefix}_${moment.utc().format('YYYY_MM_DD')}.json.gz`;
    fileCompression.writeDeflatedTextFile(text, (writeError, deflatedTempPath) => {
      if (writeError) {
        insights.trackException(writeError);
        return deferred.reject(writeError);
      }
      backupBlobService.createBlockBlobFromLocalFile(containerName, backupBlobName, deflatedTempPath, cloudError => {
        if (cloudError) {
          insights.trackException(cloudError);
          return deferred.reject(cloudError);
        }
        // Successful
        insights.trackEvent('JobReportsReportDataLakeBackup', {
          filename: backupBlobName,
          containerName: containerName,
          account: dla.account,
        });
        return deferred.resolve(context);
      });
    });
  });

  return deferred.promise;
}

function storeReports(context) {
  context.insights.trackEvent('JobReportsReportStoringStarted');

  const report = Object.assign({}, context.consolidated);
  const consolidatedSchemaVersion = context.settings.consolidatedSchemaVersion;
  report.metadata = {
    started: context.started,
    startedText: moment(context.started).tz('America/Los_Angeles').format(reportGeneratedFormat),
    finished: moment().format(),
    version: consolidatedSchemaVersion,
  };
  const json = JSON.stringify(report);

  const storeLocalReportPath = context.settings.storeLocalReportPath;
  const localPromise = storeLocalReportPath? storeLocalReport(report, storeLocalReportPath, context) : Q(context);
  return localPromise.then(context => {
    if (!context.reports.store) {
      context.insights.trackEvent('JobReportsReportStoringSkipped');
      return Q(context);
    }

    const stringSizeUncompressed = fileSize(Buffer.byteLength(json, 'utf8')).human();
    context.insights.trackEvent('JobReportsReportStoring', {
      size: stringSizeUncompressed,
      version: consolidatedSchemaVersion,
    });

    const ttl = context.settings.witnessEventReportsTimeToLiveMinutes;
    if (!ttl) {
      throw new Error('No witnessEventReportsTimeToLiveMinutes configuration value defined for the report TTL. To make efficient use of Redis memory, a TTL must be provided.');
    }

    const reportingRedis = context.reports.reportRedisClient;
    const reportingKey = context.settings.witnessEventKey;
    return reportingRedis && reportingKey ? reportingRedis.setCompressedWithExpireAsync(reportingKey, json, ttl) : Q(context);
  });
}

function storeLocalReport(report, storeLocalReportPath, context) {
  const deferred = Q.defer();
  const prettyFile = JSON.stringify(report, undefined, 2);
  fs.writeFile(storeLocalReportPath, prettyFile, 'utf8', error => {
    if (error) {
      console.warn(error);
    }
    return deferred.resolve(context);
  });
  return deferred.promise;
}

function recordMetrics(context) {
  const insights = context.insights;
  const consolidated = context.consolidated;
  const providerNames = Object.getOwnPropertyNames(reportProviders);
  let overallIssues = 0;
  for (let i = 0; i < providerNames.length; i++) {
    const providerName = providerNames[i];
    const root = consolidated[providerName];
    if (root) {
      const metricRoot = `JobRepoReportIssues${providerName}`;
      const countByIssue = new Map();
      const definitions = {};
      for (let x = 0; x < root.definitions.length; x++) {
        const d = root.definitions[x];
        definitions[d.name] = d;
      }
      if (root.entities) {
        for (let j = 0; j < root.entities.length; j++) {
          const entity = root.entities[j];
          if (entity && entity.issues) {
            const issueList = Object.getOwnPropertyNames(entity.issues);
            for (let k = 0; k < issueList.length; k++) {
              const issues = entity.issues[issueList[k]];
              const definition = definitions[issueList[k]];
              let targetCollectionName = null;
              if (definition && definition.hasTable) {
                targetCollectionName = 'rows';
              } else if (definition && definition.hasList) {
                targetCollectionName = 'listItems';
              }
              if (targetCollectionName && issues[targetCollectionName] && Array.isArray(issues[targetCollectionName])) {
                const count = issues[targetCollectionName].length;
                let currentValue = countByIssue.get(issueList[k]);
                if (!currentValue) {
                  currentValue = 0;
                }
                countByIssue.set(issueList[k], currentValue + count);
              }
            }
          }
        }
      }
      // Report metric for this provider and all of its issues (total)
      const issueNameList = Array.from(countByIssue.keys());
      for (let j = 0; j < issueNameList.length; j++) {
        const issueName = issueNameList[j];
        const count = countByIssue.get(issueName);
        const metricName = `${metricRoot}${issueName}`;
        insights.trackMetric(metricName, count);
        overallIssues += count;
      }
    }
  }
  insights.trackMetric('JobRepoReportsIssuesOverall', overallIssues);
  return Q(context);
}

function sendReports(context) {
  if (!context.reports.send) {
    context.insights.trackEvent('JobReportsSendingSkipped');
    return Q(context);
  }
  context.insights.trackEvent('JobReportsReportSendingStarted');
  return mailer(context);
}
