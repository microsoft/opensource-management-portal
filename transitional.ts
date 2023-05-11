//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import crypto from 'crypto';
import githubUsernameRegex from 'github-username-regex';
import { AxiosError } from 'axios';

import appPackage from './package.json';
import type { ICreateRepositoryApiResult } from './api/createRepo';
import { Repository } from './business/repository';
import {
  GitHubRepositoryPermission,
  IDictionary,
  IFunctionPromise,
  IProviders,
  ISettledValue,
  ReposAppRequest,
  SettledState,
} from './interfaces';
import { Organization } from './business';
const packageVariableName = 'static-react-package-name';

export function hasStaticReactClientApp() {
  const staticClientPackageName = appPackage[packageVariableName];
  if (process.env.ENABLE_REACT_CLIENT && staticClientPackageName) {
    return staticClientPackageName;
  }
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

export function permissionsObjectToValue(permissions): GitHubRepositoryPermission {
  if (permissions.admin === true) {
    return GitHubRepositoryPermission.Admin;
  } else if (permissions.push === true) {
    return GitHubRepositoryPermission.Push;
  } else if (permissions.triage === true) {
    return GitHubRepositoryPermission.Triage;
  } else if (permissions.maintain === true) {
    return GitHubRepositoryPermission.Maintain;
  } else if (permissions.pull === true) {
    return GitHubRepositoryPermission.Pull;
  }
  throw new Error(`Unsupported GitHubRepositoryPermission value inside permissions`);
}

export function isPermissionBetterThan(
  currentBest: GitHubRepositoryPermission,
  newConsideration: GitHubRepositoryPermission
) {
  if (!currentBest) {
    return true;
  }
  const comparison = MassagePermissionsToGitHubRepositoryPermission(currentBest);
  switch (MassagePermissionsToGitHubRepositoryPermission(newConsideration)) {
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

export function MassagePermissionsToGitHubRepositoryPermission(value: string): GitHubRepositoryPermission {
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
      throw new Error(
        `Invalid ${value} GitHub repository permission [massagePermissionsToGitHubRepositoryPermission]`
      );
  }
}

export class CreateError {
  static CreateStatusCodeError(code: number, message?: string): Error {
    const error = new Error(message);
    error['status'] = code;
    return error;
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

  static NotAuthenticated(message: string): Error {
    return CreateError.CreateStatusCodeError(401, message);
  }

  static NotAuthorized(message: string): Error {
    return CreateError.CreateStatusCodeError(403, message);
  }

  static ServerError(message: string, innerError?: Error): Error {
    return ErrorHelper.SetInnerError(CreateError.CreateStatusCodeError(500, message), innerError);
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
    if (asAny?.code && typeof asAny.code === 'number') {
      return asAny.code as number;
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

export function sha256(str: string) {
  const hash = crypto.createHash('sha256').update(str).digest('base64');
  return hash;
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
