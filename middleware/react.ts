//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Response } from 'express';
import fs from 'fs';
import path from 'path';

import appPackage from '../package.json';

import { getStaticBlobCacheFallback } from '../lib/staticBlobCacheFallback';
import { getProviders, splitSemiColonCommas } from '../transitional';
import { ReposAppRequest } from '../interfaces';
import { IndividualContext } from '../business/user';

const staticReactPackageNameKey = 'static-react-package-name';
const staticClientPackageName = appPackage[staticReactPackageNameKey];

const staticReactFlightingPackageNameKey = 'static-react-flight-package-name';
const staticClientFlightingPackageName = appPackage[staticReactFlightingPackageNameKey];

type PackageJsonSubset = {
  name: string;
  version: string;
  continuousDeployment: {
    commitId: string;
    buildId: string;
    branchName: string;
  };
  flights?: Record<string, string>;
};

type ContentOptions = {
  html: string;
  package: PackageJsonSubset;
};

type FlightingOptions = ContentOptions & {
  enabled: boolean;
  divertEveryone: boolean;
  staticFlightIds?: Set<string>;
  flightName: string;
};

export function injectReactClient() {
  const standardContent = getReactScriptsIndex(staticClientPackageName);
  let flightingOptions: FlightingOptions = null;
  return function injectedRoute(req: ReposAppRequest, res, next) {
    const { config } = getProviders(req);
    // special passthrough
    if (req.path.includes('/byClient')) {
      return next();
    }
    if (!flightingOptions) {
      flightingOptions = evaluateFlightConditions(req);
    }
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const flightAvailable = flightingOptions.enabled && flightingOptions.html;
    const flightName = flightAvailable ? flightingOptions.flightName : null;
    const userFlighted =
      flightingOptions.divertEveryone === true ||
      (activeContext?.corporateIdentity?.id &&
        flightingOptions.staticFlightIds?.has(activeContext.corporateIdentity.id));
    const userFlightOverride =
      req.query.flight === '0' || req.query.flight === '1' ? req.query.flight : undefined;
    let inFlight = flightAvailable && (userFlighted || req.query.flight === '1');
    if (inFlight && req.query.flight === '0') {
      inFlight = false;
    }
    //
    const servePackage = (inFlight ? flightingOptions : standardContent).package;
    const meta: Record<string, string> = {
      'served-client-package': servePackage.name,
      'served-client-version': servePackage.version,
      'served-client-flight-default': userFlighted ? '1' : '0',
      // Repos app config
      'portal-environment': config.debug.environmentName,
    };
    // Feature flags on the client side from the static list
    if (activeContext?.corporateIdentity?.id) {
      const userClientFlags = getUserClientFeatureFlags(config, activeContext.corporateIdentity.id);
      if (userClientFlags.length > 0) {
        meta['server-features'] = userClientFlags.join(',');
      }
    }
    // Override
    if (inFlight) {
      meta['served-client-flight'] = flightName;
    }
    if (userFlightOverride !== undefined) {
      meta['served-client-flight-override'] = userFlightOverride;
    }
    // App Service
    config?.webServer?.appService?.slot && (meta['app-service-slot'] = config.webServer.appService.slot);
    config?.webServer?.appService?.name && (meta['app-service-name'] = config.webServer.appService.name);
    config?.webServer?.appService?.region &&
      (meta['app-service-region'] = config.webServer.appService.region);
    // Repos app framework
    config?.web?.app && (meta['app-name'] = config.web.app);
    // Source control
    let commitId = servePackage.continuousDeployment?.commitId;
    if (commitId === '__Build_SourceVersion__') {
      commitId = '';
    }
    let branchName = servePackage.continuousDeployment?.branchName || '';
    if (branchName === '__Build_BranchName__') {
      branchName = '';
    }
    commitId && (meta['source-control-client-commit-id'] = commitId);
    branchName && (meta['source-control-client-branch-name'] = branchName);
    commitId = appPackage.continuousDeployment?.commitId;
    if (commitId === '__Build_SourceVersion__') {
      commitId = '';
    }
    branchName = appPackage.continuousDeployment?.branchName;
    if (branchName === '__Build_BranchName__') {
      branchName = '';
    }
    commitId && (meta['source-control-server-commit-id'] = commitId);
    branchName && (meta['source-control-server-branch-name'] = branchName);
    // Debug-time
    config?.github?.codespaces?.connected && (meta['github-codespaces-connected'] = '1');
    config?.github?.codespaces?.name && (meta['github-codespaces-name'] = config.github.codespaces.name);
    const addon =
      Object.keys(meta)
        .map((key) => {
          return `    <meta name="${key}" content="${meta[key]}" />`;
        })
        .join('\n') + '\n';
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    res.header('x-ms-repos-site', 'react');
    if (inFlight) {
      res.header('x-ms-repos-flight', flightName);
    }
    const clientHtml = inFlight ? flightingOptions.html : standardContent.html;
    const html = augmentHtmlHeader(clientHtml, addon);
    return res.send(html);
  };
}

function evaluateFlightConditions(req: ReposAppRequest): FlightingOptions {
  const { config } = getProviders(req);
  if (config?.client?.flighting?.enabled === true && staticClientFlightingPackageName) {
    const options = getReactScriptsIndex(staticClientFlightingPackageName) as FlightingOptions;
    const branchName = options.package.continuousDeployment?.branchName;
    const flights = options.package.flights;
    options.flightName = (flights || {})[branchName] || 'unknown';
    options.enabled = true;
    options.divertEveryone = config.client.flighting.divertEveryone;
    options.staticFlightIds = new Set<string>(
      Array.isArray(config.client.flighting.corporateIds)
        ? config.client.flighting.corporateIds
        : splitSemiColonCommas(config.client.flighting.corporateIds)
    );
    return options;
  }
}

function getUserClientFeatureFlags(config: any, corporateId: string) {
  const featureFlagList = config?.client?.flighting?.featureFlagUsers;
  if (featureFlagList && typeof featureFlagList === 'object') {
    const flights = [];
    const flightNames = Object.getOwnPropertyNames(featureFlagList);
    for (const flight of flightNames) {
      const flightIds = featureFlagList[flight];
      if (flightIds && flightIds.includes(corporateId)) {
        flights.push(flight);
      }
    }
    return flights;
  }
  return [];
}

function augmentHtmlHeader(html: string, augmentedHeader: string) {
  const headEnd = html.indexOf('</head>');
  const head = html.substring(0, headEnd);
  const body = html.substring(headEnd);
  const newHead = head + augmentedHeader;
  const newHtml = newHead + body;
  return newHtml;
}

type CacheBuffer = {
  buffer: Buffer;
  contentType: string;
};
const localFallbackBlobCache = new Map<string, CacheBuffer>();

export async function TryFallbackToBlob(req: ReposAppRequest, res: Response): Promise<boolean> {
  if (!req.path) {
    return false;
  }
  const providers = getProviders(req);
  const baseUrl = '/react' + req.originalUrl;
  if (localFallbackBlobCache.has(baseUrl)) {
    providers.insights.trackEvent({ name: 'FallbackToBlob', properties: { baseUrl } });
    const entry = localFallbackBlobCache.get(baseUrl);
    if (entry.contentType) {
      res.contentType(entry.contentType);
    }
    res.send(entry.buffer);
    return true;
  }
  const fallbackBlob = await getStaticBlobCacheFallback(providers);
  const [buffer, contentType] = await fallbackBlob.get(baseUrl);
  if (buffer) {
    providers.insights.trackEvent({ name: 'FallbackToBlob', properties: { baseUrl } });
    localFallbackBlobCache.set(baseUrl, { buffer, contentType });
    if (contentType) {
      res.contentType(contentType);
    }
    res.send(buffer);
    return true;
  }
  return false;
}

function getReactScriptsIndex(packageName: string): ContentOptions {
  try {
    const staticModernReactApp = require(packageName);
    const staticPackageFile = require(`${packageName}/package.json`);
    const previewClientFolder = staticModernReactApp;
    if (typeof previewClientFolder !== 'string') {
      throw new Error(`The return value of the preview package ${packageName} must be a string/path`);
    }
    const indexPageContent = fs.readFileSync(path.join(previewClientFolder, 'client.html'), {
      encoding: 'utf8',
    });
    return {
      html: indexPageContent,
      package: staticPackageFile,
    };
  } catch (hostClientError) {
    console.error(
      `The static client could not be loaded via package ${packageName}. Note that index.html needs to be named client.html in build/.`
    );
    throw hostClientError;
  }
}
