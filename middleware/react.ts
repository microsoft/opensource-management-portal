//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import Debug from 'debug';
import fs from 'fs';
import path from 'path';

import appPackage from '../package.json' with { type: 'json' };

import { getStaticBlobCacheFallback } from '../lib/staticBlobCacheFallback.js';
import {
  CreateError,
  FrontendBuildDetails,
  FrontendMode,
  getFrontendMode,
  getProviders,
  getStaticReactClientFolder,
  splitSemiColonCommas,
} from '../lib/transitional.js';
import type { ReposAppRequest, SiteConfiguration } from '../interfaces/index.js';
import type { IndividualContext } from '../business/user/index.js';

const STATIC_REACT_FLIGHTING_PACKAGE_NAME_KEY = 'static-react-flight-package-name';
const INSIGHTS_PREFIX = 'route.frontend';

const staticClientFlightingPackageName = appPackage[STATIC_REACT_FLIGHTING_PACKAGE_NAME_KEY];

const debug = Debug.debug('frontend');

const reactCache: Map<string, ContentOptions> = new Map<string, ContentOptions>();

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

type BasicFlightingOptions = {
  enabled: boolean;
};

type ContentOptions = {
  html: string;
  package: PackageJsonSubset;
};

type FlightingOptions = BasicFlightingOptions &
  ContentOptions & {
    divertEveryone?: boolean;
    staticFlightIds?: Set<string>;
    flightName?: string;
  };

export function injectReactClient() {
  const mode = getFrontendMode();
  const standardContent =
    mode === FrontendMode.Serve ? getReactScriptsIndex(getStaticReactClientFolder()) : null;
  let flightingBasics: BasicFlightingOptions = null;
  let flightingOptions: FlightingOptions = null;
  return function injectedRoute(req: ReposAppRequest, res: Response, next: NextFunction) {
    const { config, insights } = getProviders(req);
    // special passthrough
    if (req.path.includes('/byClient')) {
      debug(`${req.path} - skipping react client injection due to /byClient presence`);
      insights?.trackEvent({
        name: `${INSIGHTS_PREFIX}.skip_for_client`,
        properties: { path: req.path },
      });
      return next();
    }
    debug(`${req.path} serving frontend`);
    if (!flightingOptions) {
      flightingBasics = evaluateFlightConditions(req);
      flightingOptions = flightingBasics as FlightingOptions;
    }
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const flightEnabled = flightingBasics?.enabled === true;
    const flightAvailable = flightEnabled && flightingOptions?.html;
    const flightName = flightingOptions?.flightName;
    const userFlighted =
      flightingOptions?.divertEveryone === true ||
      (activeContext?.corporateIdentity?.id &&
        flightingOptions?.staticFlightIds?.has(activeContext.corporateIdentity.id));
    const userFlightOverride =
      req.query.flight === '0' || req.query.flight === '1' ? req.query.flight : undefined;
    let inFlight = flightAvailable && (userFlighted || req.query.flight === '1');
    if (inFlight && req.query.flight === '0') {
      inFlight = false;
    }
    //
    const servePackage = (inFlight ? flightingOptions : standardContent)?.package;
    const meta: Record<string, string> = {
      'served-client-package': servePackage?.name,
      'served-client-version': servePackage?.version,
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
    if (config?.webServer?.appService?.slot) {
      meta['app-service-slot'] = config.webServer.appService.slot;
    }
    if (config?.webServer?.appService?.name) {
      meta['app-service-name'] = config.webServer.appService.name;
    }
    if (config?.webServer?.appService?.region) {
      meta['app-service-region'] = config.webServer.appService.region;
    }

    // Repos app framework
    if (config?.web?.app) {
      meta['app-name'] = config.web.app;
    }

    // Source control
    let commitId = servePackage?.continuousDeployment?.commitId;
    if (commitId === '__Build_SourceVersion__') {
      commitId = '';
    }
    let branchName = servePackage?.continuousDeployment?.branchName || '';
    if (branchName === '__Build_BranchName__') {
      branchName = '';
    }
    if (commitId) {
      meta['source-control-client-commit-id'] = commitId;
    }
    if (branchName) {
      meta['source-control-client-branch-name'] = branchName;
    }
    commitId = appPackage.continuousDeployment?.commitId;
    if (commitId === '__Build_SourceVersion__') {
      commitId = '';
    }
    branchName = appPackage.continuousDeployment?.branchName;
    if (branchName === '__Build_BranchName__') {
      branchName = '';
    }
    if (commitId) {
      meta['source-control-server-commit-id'] = commitId;
    }
    if (branchName) {
      meta['source-control-server-branch-name'] = branchName;
    }

    // Debug-time
    if (config?.github?.codespaces?.connected) {
      meta['github-codespaces-connected'] = '1';
    }
    if (config?.github?.codespaces?.name) {
      meta['github-codespaces-name'] = config.github.codespaces.name;
    }
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
    const clientHtml =
      mode === FrontendMode.Serve
        ? inFlight
          ? flightingOptions.html
          : standardContent.html
        : alternativeHtml(mode);
    const html = augmentHtmlHeader(clientHtml, addon);
    insights?.trackEvent({
      name: `${INSIGHTS_PREFIX}.inject`,
      properties: { path: req.path, ...meta },
    });
    return res.send(html) as unknown as void;
  };
}

function alternativeHtml(messageOrType: string) {
  return `
    <html>
      <head>
        <title>${messageOrType}</title>
      </head>
      <body>
        <h1>Note</h1>
        <p>${messageOrType}</p>
      </body>
  `;
}

function evaluateFlightConditions(req: ReposAppRequest): FlightingOptions | BasicFlightingOptions {
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
  return {
    enabled: false,
  };
}

function getUserClientFeatureFlags(config: SiteConfiguration, corporateId: string) {
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
  if (headEnd >= 0) {
    const head = html.substring(0, headEnd);
    const body = html.substring(headEnd);
    const newHead = head + augmentedHeader;
    const newHtml = newHead + body;
    return newHtml;
  }
  console.warn('The client HTML does not have a head tag to augment with additional meta tags.');
  return html;
}

type CacheBuffer = {
  buffer: Buffer;
  contentType: string;
};
const localFallbackBlobCache = new Map<string, CacheBuffer>();

export async function TryFallbackToBlob(req: ReposAppRequest, res: Response): Promise<boolean> {
  const { insights } = req;
  if (!req.path) {
    return false;
  }
  const providers = getProviders(req);
  const baseUrl = req.originalUrl;
  if (localFallbackBlobCache.has(baseUrl)) {
    insights.trackEvent({ name: 'FallbackToBlob', properties: { baseUrl } });
    const entry = localFallbackBlobCache.get(baseUrl);
    if (entry.contentType) {
      res.contentType(entry.contentType);
    }
    res.send(entry.buffer);
    return true;
  }
  const fallbackBlob = await getStaticBlobCacheFallback(providers);
  if (!fallbackBlob) {
    return false;
  }
  const [buffer, contentType] = await fallbackBlob.get(baseUrl);
  if (buffer) {
    insights.trackEvent({ name: 'FallbackToBlob', properties: { baseUrl } });
    localFallbackBlobCache.set(baseUrl, { buffer, contentType });
    if (contentType) {
      res.contentType(contentType);
    }
    res.send(buffer);
    return true;
  }
  return false;
}

function getReactScriptsIndex(details: FrontendBuildDetails): ContentOptions {
  const cacheRoot = details.hostingRoot;
  if (reactCache.has(cacheRoot)) {
    return reactCache.get(cacheRoot);
  }
  let pagePath = null;
  let staticPackageFile = details.package;
  const staticModernReactApp = details.hostingRoot;
  const dir = details.directory;
  if (!staticPackageFile) {
    const raw = fs.readFileSync(`${dir}/package.json`, 'utf8');
    staticPackageFile = JSON.parse(raw);
  }
  if (!staticModernReactApp) {
    throw CreateError.NotFound(`The static client folder and package.json was not found: ${dir}`);
  }
  const clientFolder = staticModernReactApp;
  try {
    if (typeof clientFolder !== 'string') {
      throw new Error(`The return value of the preview package ${dir} must be a string/path`);
    }
    let indexPageContent = null;
    try {
      pagePath = path.join(clientFolder, 'index.html');
      indexPageContent = fs.readFileSync(pagePath, {
        encoding: 'utf8',
      });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      pagePath = path.join(clientFolder, 'client.html');
      indexPageContent = fs.readFileSync(pagePath, {
        encoding: 'utf8',
      });
    }
    const values = {
      html: indexPageContent,
      package: staticPackageFile,
    };
    reactCache.set(cacheRoot, values);
    return values;
  } catch (hostClientError) {
    console.error(
      `The static client could not be loaded via package/folder ${staticModernReactApp}. Note that index.html needs to be named client.html or index.html in build/. Attempted path: ${pagePath || ''}`
    );
    throw hostClientError;
  }
}
