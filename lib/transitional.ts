//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import crypto from 'crypto';
import githubUsernameRegex from 'github-username-regex';
import { AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';

import appPackage from '../package.json' with { type: 'json' };

import type { ICreateRepositoryApiResult } from '../api/createRepo.js';
import { Repository } from '../business/repository.js';
import {
  AppInsightsTelemetryClient,
  GitHubRepositoryPermission,
  type ICorporateLink,
  type IDictionary,
  type IFunctionPromise,
  type IGitHubCollaboratorPermissions,
  type IProviders,
  type ISettledValue,
  type ReposAppRequest,
  SettledState,
} from '../interfaces/index.js';
import { ITeamRepositoryPermission, Organization } from '../business/index.js';
import { ILinkProvider } from './linkProviders/index.js';
import { fileURLToPath } from 'url';

const reactFolderVariableName = 'static-react-folder';

let staticReactFolder: FrontendBuildDetails;

export enum FrontendMode {
  Serve = 'serve',
  Proxied = 'proxied',
  Skip = 'skip',
}

const frontendModeVariable = 'FRONTEND_MODE';
const defaultFrontendMode = FrontendMode.Serve;

export function getFrontendMode() {
  // CONSIDER: support using config and .env
  const mode = process.env[frontendModeVariable] || defaultFrontendMode;
  if (mode !== FrontendMode.Serve && mode !== FrontendMode.Proxied && mode !== FrontendMode.Skip) {
    throw new Error(`Invalid frontend mode: ${mode}`);
  }
  return mode;
}

export function hasStaticReactClientApp() {
  const staticClientFolderName = appPackage[reactFolderVariableName];
  return !!staticClientFolderName;
}

type FrontendClientPackage = {
  name: string;
  version: string;
  companySpecific?: {
    directoryName: string;
    loadingMessage: string;
    title: string;
    description: string;
  };
  frontendBuildPath: string;
  continuousDeployment: {
    build: string;
    buildId: string;
    buildNumber: string;
    branchName: string;
    commitId: string;
  };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

export type FrontendBuildDetails = {
  package: FrontendClientPackage;
  directory: string;
  hostingRoot: string;
};

export function getStaticReactClientFolder(): FrontendBuildDetails {
  const mode = getFrontendMode();
  if (mode === FrontendMode.Skip || mode === FrontendMode.Proxied) {
    return null;
  }
  if (staticReactFolder) {
    return staticReactFolder;
  }
  const staticClientFolderName = appPackage[reactFolderVariableName];
  if (!staticClientFolderName) {
    throw CreateError.InvalidParameters(
      `The ${reactFolderVariableName} variable is not defined in the package.json file, so the static client app cannot be loaded.`
    );
  }
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  let clientPath = path.resolve(dirname, '..', staticClientFolderName);
  const exists = fs.existsSync(clientPath);
  if (!exists && clientPath.includes(path.sep + 'dist' + path.sep + staticClientFolderName)) {
    // attempt to resolve from outside the built TypeScript backend
    clientPath = path.resolve(dirname, '..', '..', staticClientFolderName);
  }
  if (!fs.existsSync(clientPath)) {
    throw CreateError.NotFound(
      `The ${reactFolderVariableName} variable in the package.json file points to a folder that does not exist: ${clientPath}`
    );
  }
  const packagePath = path.join(clientPath, 'package.json');
  const details: FrontendBuildDetails = {
    package: null,
    directory: clientPath,
    hostingRoot: clientPath,
  };
  if (fs.existsSync(packagePath)) {
    const value = fs.readFileSync(packagePath, 'utf8');
    details.package = JSON.parse(value);
    if (details.package.frontendBuildPath) {
      details.hostingRoot = path.join(clientPath, details.package.frontendBuildPath);
    }
  }
  if (!details.hostingRoot) {
    throw CreateError.NotFound(
      `The ${reactFolderVariableName} package.json file does not have a frontendBuildPath`
    );
  }
  staticReactFolder = details;
  return staticReactFolder;
}

export function assertUnreachable(nothing: never): never {
  throw new Error('This is never expected.');
}

export function getProviders(req: ReposAppRequest) {
  return req.app.settings.providers as IProviders;
}

export function isWebhookIngestionEndpointEnabled(req: ReposAppRequest) {
  const { config } = getProviders(req);
  return config?.features?.exposeWebhookIngestionEndpoint === true;
}

export function SettleToStateValue<T>(promise: Promise<T>): Promise<ISettledValue<T>> {
  return promise.then(
    (value) => {
      return { value, state: SettledState.Fulfilled };
    },
    (reason) => {
      return { reason, state: SettledState.Rejected };
    }
  );
}

export function projectCollaboratorPermissionsObjectToGitHubRepositoryPermission(
  permissions: IGitHubCollaboratorPermissions | ITeamRepositoryPermission
): GitHubRepositoryPermission {
  if (permissions.admin === true) {
    return GitHubRepositoryPermission.Admin;
  } else if (permissions.maintain === true) {
    return GitHubRepositoryPermission.Maintain;
  } else if (permissions.push === true) {
    return GitHubRepositoryPermission.Push;
  } else if (permissions.triage === true) {
    return GitHubRepositoryPermission.Triage;
  } else if (permissions.pull === true) {
    return GitHubRepositoryPermission.Pull;
  }
  throw new Error(`Unsupported GitHub repository permission value inside permissions`);
}

export async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    readableStream.on('error', reject);
  });
}

export function isPermissionBetterThan(
  currentBest: GitHubRepositoryPermission,
  newConsideration: GitHubRepositoryPermission
) {
  if (!currentBest) {
    return true;
  }
  const comparison = projectCollaboratorPermissionToGitHubRepositoryPermission(currentBest);
  switch (projectCollaboratorPermissionToGitHubRepositoryPermission(newConsideration)) {
    case GitHubRepositoryPermission.Admin:
      return true;
    case GitHubRepositoryPermission.Maintain:
      if (comparison !== GitHubRepositoryPermission.Admin) {
        return true;
      }
      break;
    case GitHubRepositoryPermission.Push:
      if (comparison !== GitHubRepositoryPermission.Admin) {
        return true;
      }
      break;
    case GitHubRepositoryPermission.Pull:
      if (comparison === null || comparison === GitHubRepositoryPermission.None) {
        return true;
      }
      break;
    case GitHubRepositoryPermission.Triage:
      // not really great
      break;
    default:
      throw new Error(`Invalid permission type ${newConsideration}`);
  }
  return false;
}

export function projectCollaboratorPermissionToGitHubRepositoryPermission(
  value: string
): GitHubRepositoryPermission {
  // collaborator level APIs return a more generic read/write value, lead to some bad caches in the past...
  // TODO: support new collaboration values as they come online for Enterprise Cloud!
  switch (value) {
    case 'write':
    case 'push':
      return GitHubRepositoryPermission.Push;
    case 'admin':
      return GitHubRepositoryPermission.Admin;
    case 'triage':
      return GitHubRepositoryPermission.Triage;
    case 'maintain':
      return GitHubRepositoryPermission.Maintain;
    case 'pull':
    case 'read':
      return GitHubRepositoryPermission.Pull;
    default:
      throw CreateError.InvalidParameters(
        `Invalid ${value} GitHub repository permission [projectCollaboratorPermissionsToGitHubRepositoryPermission]`
      );
  }
}

export class CreateError {
  static CreateStatusCodeError(code: number, message?: string, cause?: Error): Error {
    const error = cause ? new Error(message, { cause }) : new Error(message);
    error['status'] = code;
    return error;
  }

  static Wrap(message: string, innerError: Error): Error {
    const statusCode = ErrorHelper.GetStatus(innerError);
    if (statusCode) {
      return CreateError.CreateStatusCodeError(statusCode, message, innerError);
    }
    return new Error(message, { cause: innerError });
  }

  static NotFound(message?: string, innerError?: Error): Error {
    return ErrorHelper.SetInnerError(CreateError.CreateStatusCodeError(404, message), innerError);
  }

  static Conflict(message: string, innerError?: Error): Error {
    return ErrorHelper.SetInnerError(CreateError.CreateStatusCodeError(409, message), innerError);
  }

  static ParameterRequired(parameterName: string, optionalDetails?: string): Error {
    const msg = `${parameterName} required`;
    return CreateError.CreateStatusCodeError(400, optionalDetails ? `${msg}: ${optionalDetails}` : msg);
  }

  static InvalidParameters(message: string, innerError?: Error): Error {
    return ErrorHelper.SetInnerError(CreateError.CreateStatusCodeError(400, message), innerError);
  }

  static NotAuthenticated(message: string, cause?: Error): Error {
    return CreateError.CreateStatusCodeError(401, message, cause);
  }

  static NotImplemented(message?: string, cause?: Error): Error {
    return CreateError.CreateStatusCodeError(503, message || 'This scenario is not yet implemented', cause);
  }

  static Timeout(message?: string, cause?: Error): Error {
    return CreateError.CreateStatusCodeError(504, message || 'Timed out waiting for a response', cause);
  }

  static FeatureNotEnabled(message?: string, cause?: Error): Error {
    return CreateError.CreateStatusCodeError(501, message || 'This feature is not enabled', cause);
  }

  static NotAuthorized(message: string, cause?: Error): Error {
    return CreateError.CreateStatusCodeError(403, message, cause);
  }

  static ServerError(message: string, cause?: Error): Error {
    return CreateError.CreateStatusCodeError(500, message, cause);
  }
}

export class ErrorHelper {
  static EnsureHasStatus(error: Error, code: number): Error {
    if (!error['status']) {
      error['status'] = code;
    }
    return error;
  }

  public static WrapError(innerError: Error, message: string): Error {
    const err = new Error(message);
    err['innerError'] = innerError;
    return err;
  }

  public static SetInnerError(error: Error, innerError: Error) {
    if (error && innerError) {
      error['innerError'] = innerError;
    }
    return error;
  }

  public static HasStatus(error: Error): boolean {
    return error && error['status'];
  }

  public static IsNotFound(error: Error): boolean {
    const statusNumber = ErrorHelper.GetStatus(error);
    return statusNumber && statusNumber === 404;
  }

  public static IsInvalidParameters(error: Error): boolean {
    const statusNumber = ErrorHelper.GetStatus(error);
    return statusNumber && statusNumber === 400;
  }

  public static IsUnprocessableEntity(error: Error): boolean {
    const statusNumber = ErrorHelper.GetStatus(error);
    return statusNumber && statusNumber === 422;
  }

  public static IsServerError(error: Error): boolean {
    const statusNumber = ErrorHelper.GetStatus(error);
    return statusNumber && statusNumber >= 500;
  }

  public static IsNotAuthenticated(error: Error): boolean {
    const statusNumber = ErrorHelper.GetStatus(error);
    return statusNumber && statusNumber === 401;
  }

  public static IsNotAuthorized(error: Error): boolean {
    const statusNumber = ErrorHelper.GetStatus(error);
    return statusNumber && statusNumber === 403;
  }

  public static IsUnavailableForExternalLegalRequest(error: Error): boolean {
    const statusNumber = ErrorHelper.GetStatus(error);
    return statusNumber && statusNumber === 451; // https://developer.github.com/changes/2016-03-17-the-451-status-code-is-now-supported/
  }

  public static IsConflict(error: Error): boolean {
    const statusNumber = ErrorHelper.GetStatus(error);
    if (statusNumber && statusNumber === 409) {
      return true;
    }
    // would be nice to be able to get rid of this clause someday
    if (error.message && error.message.includes('already exists')) {
      return true;
    }
    return false;
  }

  public static NotImplemented() {
    return new Error('Not implemented');
  }

  public static GetStatus(error: Error): number {
    const asAny = error as any;
    if (asAny?.isAxiosError === true) {
      const axiosError = asAny as AxiosError;
      if (axiosError?.response?.status) {
        return axiosError.response.status;
      }
    }
    if (asAny?.statusCode && typeof asAny.statusCode === 'number') {
      return asAny.statusCode as number;
    }
    if (asAny?.status) {
      const status = asAny.status;
      const type = typeof status;
      if (type === 'number') {
        return status;
      } else if (type === 'string') {
        return Number(status);
      } else {
        console.warn(`Unsupported error.status type: ${type}`);
        return null;
      }
    }
    if (asAny?.code && typeof asAny.code === 'number') {
      return asAny.code as number;
    }
    return null;
  }
}

export function setImmediateAsync(f: IFunctionPromise<void>): void {
  const safeCall = () => {
    try {
      f().catch((error) => {
        console.warn(`setImmediateAsync caught error: ${error}`);
      });
    } catch (ignoredFailure) {
      console.warn(`setImmediateAsync call error: ${ignoredFailure}`);
    }
  };
  setImmediate(safeCall.bind(null));
}

export function stripDistFolderName(dirname: string) {
  // This is a hacky backup for init failure scenarios where the dirname may
  // not actually point at the app root.
  if (dirname.endsWith('dist')) {
    dirname = dirname.replace('\\dist', '');
    dirname = dirname.replace('/dist', '');
  }
  return dirname;
}

export function getSafeCosmosResourceKey(key: string) {
  return key.replace(/[%:\\/?#]/g, '');
}

export function sha256(str: string) {
  const hash = crypto.createHash('sha256').update(str).digest('base64');
  return hash;
}

export async function getThirdPartyLinkById(
  linkProvider: ILinkProvider,
  thirdPartyId: string | number
): Promise<ICorporateLink> {
  try {
    return await linkProvider.getByThirdPartyId(String(thirdPartyId));
  } catch (error) {
    if (ErrorHelper.IsNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export interface ICustomizedNewRepositoryLogic {
  createContext(req: any): INewRepositoryContext;
  getAdditionalTelemetryProperties(context: INewRepositoryContext): IDictionary<string>;
  validateRequest(context: INewRepositoryContext, req: any): Promise<void>;
  stripRequestBody(context: INewRepositoryContext, body: any): void;
  afterRepositoryCreated(
    context: INewRepositoryContext,
    corporateId: string,
    success: ICreateRepositoryApiResult,
    organization: Organization
  ): Promise<void>;
  shouldNotifyManager(context: INewRepositoryContext, corporateId: string): boolean;
  getNewMailViewProperties(
    context: INewRepositoryContext,
    repository: Repository
  ): Promise<ICustomizedNewRepoProperties>;
  sufficientTeamsConfigured(context: INewRepositoryContext, body: any): boolean;
  skipApproval(context: INewRepositoryContext, body: any): boolean;
  additionalCreateRepositoryParameters(context: INewRepositoryContext): any;
}

export function splitSemiColonCommas(value: string) {
  return value && value.replace ? value.replace(/;/g, ',').split(',') : [];
}

export interface ICustomizedNewRepoProperties {
  viewProperties: any;
  to?: string[];
  cc?: string[];
  bcc?: string[];
}

export interface ICustomizedTeamPermissionsWebhookLogic {
  shouldSkipEnforcement(repository: Repository): Promise<boolean>;
}

export interface INewRepositoryContext {
  isCustomContext: boolean;
  insights: AppInsightsTelemetryClient;
}

export function getDeploymentIdentifier(providers: IProviders) {
  return Object.keys(providers.config.continuousDeployment)
    .map((k) => {
      const val = providers.config.continuousDeployment[k];
      if (val) {
        return k + '/' + val;
      }
    })
    .filter((x) => x)
    .join(' ');
}

export function validateGitHubLogin(username: string) {
  // There are some legitimate usernames at GitHub that have a dash
  // in them. While GitHub no longer allows this for new accounts,
  // they are grandfathered in.
  if (!githubUsernameRegex.test(username) && !username.endsWith('-')) {
    console.warn(`Invalid GitHub username format: ${username}`);
    // throw new Error(`Invalid GitHub username format: ${username}`);
  }
  return username;
}

export const DefaultGraphqlPageSize = 10;
