//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Response, Request } from 'express';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import zlib from 'zlib';

import { type Repository } from '../business/repository';
import type { ReposAppRequest, IAppSession, IReposError, SiteConfiguration } from '../interfaces';
import { getProviders } from './transitional';

export function daysInMilliseconds(days: number): number {
  return 1000 * 60 * 60 * 24 * days;
}

export function dateToDateString(date: Date) {
  return date.toISOString().substr(0, 10);
}

export function stringOrNumberAsString(value: any) {
  if (typeof value === 'number') {
    return (value as number).toString();
  } else if (typeof value === 'string') {
    return value;
  }
  const typeName = typeof value;
  throw new Error(`Unsupported type ${typeName} for value ${value} (stringOrNumberAsString)`);
}

export function stringOrNumberArrayAsStringArray(values: any[]) {
  return values.map((val) => stringOrNumberAsString(val));
}

export function requireJson(nameFromRoot: string): any {
  // In some situations TypeScript can load from JSON, but for the transition this is better to reach outside the out directory
  let file = path.resolve(__dirname, nameFromRoot);
  // If within the output directory
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content);
  }
  file = path.resolve(__dirname, '..', nameFromRoot);
  if (!fs.existsSync(file)) {
    throw new Error(`Cannot find JSON file ${file} to read as a module`);
  }
  const content = fs.readFileSync(file, 'utf8');
  console.warn(`JSON as module (${file}) from project root (NOT TypeScript 'dist' folder)`);
  return JSON.parse(content);
}

export function safeLocalRedirectUrl(path: string) {
  if (!path) {
    return;
  }
  const url = new URL(path, 'http://localhost');
  if (url.host !== 'localhost') {
    return;
  }
  return url.search ? `${url.pathname}${url.search}` : url.pathname;
}

// Session utility: Store the referral URL, if present, and redirect to a new
// location.
interface IStoreReferrerEventDetails {
  method: string;
  reason: string;
  referer?: string;
  redirect?: string;
}

export function storeReferrer(req: ReposAppRequest, res, redirect, optionalReason) {
  const { insights } = getProviders(req);
  const eventDetails: IStoreReferrerEventDetails = {
    method: 'storeReferrer',
    reason: optionalReason || 'unknown reason',
  };
  const session = req.session as IAppSession;
  if (
    session &&
    req.headers &&
    req.headers.referer &&
    session.referer !== undefined &&
    !req.headers.referer.includes('/signout') &&
    !session.referer
  ) {
    session.referer = req.headers.referer;
    eventDetails.referer = req.headers.referer;
  } else {
    eventDetails.referer = 'no referer';
  }
  if (redirect) {
    eventDetails.redirect = redirect;
    insights?.trackEvent({ name: 'RedirectWithReferrer', properties: eventDetails });
    res.redirect(redirect);
  }
}

export function sortByCaseInsensitive(a: string, b: string) {
  const nameA = a.toLowerCase();
  const nameB = b.toLowerCase();
  if (nameA < nameB) {
    return -1;
  }
  if (nameA > nameB) {
    return 1;
  }
  return 0;
}

export function cleanResponse<T = any>(response: T) {
  (response as any)?.cost && delete (response as any).cost;
  (response as any)?.headers && delete (response as any).headers;
  return response as Omit<T, 'cost' | 'headers'>;
}

export function sortRepositoriesByNameCaseInsensitive(a: Repository, b: Repository, full_name = false) {
  let nameA, nameB;
  if (full_name) {
    nameA = a.full_name.toLowerCase();
    nameB = b.full_name.toLowerCase();
  } else {
    nameA = a.name.toLowerCase();
    nameB = b.name.toLowerCase();
  }
  if (nameA < nameB) {
    return -1;
  }
  if (nameA > nameB) {
    return 1;
  }
  return 0;
}

// ----------------------------------------------------------------------------
// Session utility: store the original URL
// ----------------------------------------------------------------------------
export function storeOriginalUrlAsReferrer(
  req: Request,
  res: Response,
  redirect: string,
  optionalReason?: string
) {
  storeOriginalUrlAsVariable(req, res, 'referer', redirect, optionalReason);
}

export function redirectToReferrer(req, res, url, optionalReason) {
  url = url || '/';
  const alternateUrl = popSessionVariable(req, res, 'referer');
  const eventDetails = {
    method: 'redirectToReferrer',
    reason: optionalReason || 'unknown reason',
  };
  if (req.insights) {
    req.insights.trackEvent({ name: 'RedirectToReferrer', properties: eventDetails });
  }
  res.redirect(alternateUrl || url);
}

export function storeOriginalUrlAsVariable(req, res, variable, redirect, optionalReason) {
  const eventDetails = {
    method: 'storeOriginalUrlAsVariable',
    variable,
    redirect,
    reason: optionalReason || 'unknown reason',
  };
  if (req.session && req.originalUrl) {
    req.session[variable] = req.originalUrl;
    eventDetails['ou'] = req.originalUrl;
  }
  if (redirect) {
    if (req.insights) {
      req.insights.trackEvent({ name: 'RedirectFromOriginalUrl', properties: eventDetails });
    }
    res.redirect(redirect);
  }
}

export function popSessionVariable(req, res, variableName) {
  if (req.session && req.session[variableName] !== undefined) {
    const url = req.session[variableName];
    delete req.session[variableName];
    return url;
  }
}

// ----------------------------------------------------------------------------
// Provide our own error wrapper and message for an underlying thrown error.
// Useful for the user-presentable version.
// ----------------------------------------------------------------------------
const errorPropertiesToClone = ['stack', 'status'];

export function wrapError(error, message, userIntendedMessage?: boolean): IReposError {
  const err: IReposError = new Error(message, { cause: error });
  if (error) {
    for (let i = 0; i < errorPropertiesToClone.length; i++) {
      const key = errorPropertiesToClone[i];
      const value = error[key];
      if (value && typeof value === 'number') {
        // Store as a string
        err[key] = value.toString();
      } else if (value) {
        err[key] = value;
      }
    }
  }
  if (userIntendedMessage === true) {
    err.skipLog = true;
  }
  return err;
}

// ----------------------------------------------------------------------------
// A very basic breadcrumb stack that ties in to an Express request object.
// ----------------------------------------------------------------------------
export function addBreadcrumb(req, breadcrumbTitle, optionalBreadcrumbLink) {
  if (req === undefined || req.baseUrl === undefined) {
    throw new Error('addBreadcrumb: did you forget to provide a request object instance?');
  }
  if (!optionalBreadcrumbLink && optionalBreadcrumbLink !== false) {
    optionalBreadcrumbLink = req.baseUrl;
  }
  if (!optionalBreadcrumbLink && optionalBreadcrumbLink !== false) {
    optionalBreadcrumbLink = '/';
  }
  let breadcrumbs = req.breadcrumbs;
  if (breadcrumbs === undefined) {
    breadcrumbs = [];
  }
  breadcrumbs.push({
    title: breadcrumbTitle,
    url: optionalBreadcrumbLink,
  });
  req.breadcrumbs = breadcrumbs;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      process.nextTick(resolve);
    }, milliseconds);
  });
}

export function readFileToText(filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    return fs.readFile(filename, 'utf8', (error, data) => {
      return error ? reject(error) : resolve(data);
    });
  });
}

export function writeTextToFile(filename: string, stringContent: string): Promise<void> {
  return new Promise((resolve, reject) => {
    return fs.writeFile(filename, stringContent, 'utf8', (error) => {
      if (error) {
        console.warn(`Trouble writing ${filename} ${error}`);
      } else {
        console.log(`Wrote ${filename}`);
      }
      return error ? reject(error) : resolve();
    });
  });
}

export function quitInTenSeconds(successful: boolean, config?: SiteConfiguration) {
  // To allow telemetry to flush, we'll wait typically
  if (config?.debug?.exitImmediately || process.env.EXIT_IMMEDIATELY === '1') {
    console.log(`EXIT_IMMEDIATELY set, exiting... exit code=${successful ? 0 : 1}`);
    return process.exit(successful ? 0 : 1);
  }
  console.log(`Quitting process in 10s... exit code=${successful ? 0 : 1}`);
  return setTimeout(() => {
    process.exit(successful ? 0 : 1);
  }, 1000 * 10 /* 10s */);
}

export function gzipString(value: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const val = Buffer.from(value);
    zlib.gzip(val, (gzipError, compressed: Buffer) => {
      return gzipError ? reject(gzipError) : resolve(compressed);
    });
  });
}

export function gunzipBuffer(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    zlib.gunzip(buffer, (unzipError, unzipped) => {
      // Fallback if there is a data error (i.e. it's not compressed)
      if (unzipError && (unzipError as any)?.errno === zlib.constants.Z_DATA_ERROR) {
        const originalValue = buffer.toString();
        return resolve(originalValue);
      } else if (unzipError) {
        return reject(unzipError);
      }
      try {
        const unzippedValue = unzipped.toString();
        return resolve(unzippedValue);
      } catch (otherError) {
        return reject(otherError);
      }
    });
  });
}

export function swapMap(map: Map<string, string>): Map<string, string> {
  const rm = new Map<string, string>();
  for (const [key, value] of map.entries()) {
    rm.set(value, key);
  }
  return rm;
}

export function addArrayToSet<T>(set: Set<T>, array: T[]): Set<T> {
  for (const entry of array) {
    set.add(entry);
  }
  return set;
}

export function isEnterpriseManagedUserLogin(login: string) {
  return login?.includes('_');
}

export function isCodespacesAuthenticating(config: SiteConfiguration, authType: 'aad' | 'github') {
  const { codespaces } = config?.github || {};
  return (
    codespaces?.connected === true &&
    codespaces?.authentication &&
    codespaces.authentication[authType] &&
    codespaces.authentication[authType].enabled
  );
}

export function getCodespacesHostname(config: SiteConfiguration) {
  const { github, webServer } = config;
  const { codespaces } = github;
  const { connected, desktop } = codespaces;
  let codespacesPort = undefined;
  if (connected === true) {
    codespacesPort = codespaces.authentication?.port;
  }
  const port = codespacesPort || webServer.port || 3000;
  const forwardingDomain = codespaces?.forwardingDomain || 'preview.app.github.dev';
  return desktop ? `http://localhost:${port}` : `https://${codespaces.name}-${port}.${forwardingDomain}`;
}

export function getDateTimeBasedBlobFolder() {
  // Returns a UTC-named folder name like "2020/01/01/00-00-00"
  const now = new Date();
  const timeFilename = `${String(now.getUTCHours()).padEnd(2)}-${String(now.getUTCMinutes()).padStart(
    2,
    '0'
  )}-${String(now.getUTCSeconds()).padStart(2, '0')}`;
  const blobFilename = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(
    now.getUTCDate()
  ).padStart(2, '0')}/${timeFilename}`;
  return blobFilename;
}

export const botBracket = '[bot]';

const githubAvatarHostnames = [
  'githubusercontent.com',
  'objects.githubusercontent.com',
  'object.githubusercontent.com',
  'raw.githubusercontent.com',
  'avatars.githubusercontent.com',
];

export function getUserIdFromWellFormedAvatar(avatar: string): string {
  // https://*.githubusercontent.com/u/userid?v=*
  const url = new URL(avatar);
  if (githubAvatarHostnames.includes(url.hostname)) {
    const { pathname } = url;
    const i = pathname.indexOf('/u/');
    if (i >= 0) {
      return pathname.substr(i + 3);
    }
  }
  return null;
}
