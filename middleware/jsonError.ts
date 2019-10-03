//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

interface IErrorJson extends Error {
  json?: boolean;
  statusCode?: string | number;
}

export function json404(req, res, next) {
  return next(jsonError('Endpoint not found', 404));
}

export function jsonError(error: IErrorJson | string, statusCode?: number) {
  if (typeof(error) === 'string') {
    error = new Error(error);
  } else if (Array.isArray(error)) {
    error = new Error(error as any);
  }
  if (!error) {
    error = new Error('An error occurred.');
  }
  error.json = true;
  if (statusCode) {
    error.statusCode = statusCode;
  }
  return error;
};
