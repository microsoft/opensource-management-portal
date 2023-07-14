//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { randomUUID } from 'crypto';

// Generate a correlation ID
export default function (req, res, next) {
  req.correlationId = randomUUID();
  return next();
}
