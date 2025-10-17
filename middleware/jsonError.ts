//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { ReposAppRequest } from '../interfaces/index.js';

interface IErrorJson extends Error {
  json?: boolean;
  statusCode?: string | number;
}

export function json404(req: ReposAppRequest, res: Response, next: NextFunction) {
  return next(jsonError('Endpoint not found', 404));
}

export function isJsonError(error: IErrorJson | string | Error, url: string) {
  const errorAsAny = error as any;
  return errorAsAny?.json === true || url?.startsWith('/api/');
}

export function jsonError(error: IErrorJson | string | Error, statusCode?: number): IErrorJson {
  if (error && error['json'] === true) {
    return error as IErrorJson; // already good to go
  }
  if (typeof error === 'string') {
    error = new Error(error);
  } else if (Array.isArray(error)) {
    error = new Error(error as any);
  }
  if (!error) {
    error = new Error('An error occurred.');
  }
  error['json'] = true;
  if (statusCode || error['status']) {
    error['statusCode'] = statusCode || error['status'];
    if (!error['status']) {
      error['status'] = error['statusCode'];
    }
  }
  return error;
}
