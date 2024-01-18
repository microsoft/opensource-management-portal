//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Express } from 'express';

export type ExpressWithStatic = Express & {
  static: (path: string, options?: any) => Express;
};
