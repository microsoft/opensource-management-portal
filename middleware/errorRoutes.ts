//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Request, Response } from 'express';

import { IReposApplication, IReposError } from '../interfaces';
import routeErrorHandler from './errorHandler';

export default async function configureErrorRoutes(app: IReposApplication, initializationError: Error) {
  if (!app) {
    return;
  }
  if (initializationError) {
    console.warn('Initialization Error Present: All app requests will fail!');

    // For convenience, failed initialization should appear
    // for any request. Should evaluate whether to hide for
    // production scenarios or if there is a risk of the
    // error message leaking sensitive data.
    app.use((req: Request, res: Response, next: NextFunction) => {
      const error: IReposError = new Error('Application initialization error', {
        cause: initializationError,
      });
      error.detailed = initializationError.message || null;
      return next(error);
    });
  }

  app.use(function (req: Request, res: Response, next: NextFunction) {
    const err: IReposError = new Error('Not Found');
    err.status = 404;
    err.skipLog = true;
    return next(err);
  });

  app.use(routeErrorHandler);
}
