//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { ReposAppRequest } from '../interfaces/index.js';

// Assistant for when using Visual Studio Code to connect to a Codespace
// locally instead of the web. The default port forwarding experience is
// to toast the user to browse to 127.0.0.1:3000, but since AAD does not
// allow for IP-based callback URLs, the user must use localhost.
export function codespacesDevAssistant(req: ReposAppRequest, res: Response, next: NextFunction) {
  if (req.hostname === '127.0.0.1') {
    console.warn(`WARNING: You're trying to connect to the web from your codespace.`);
    if (req.method === 'GET') {
      res.contentType('text/html');
      return res.send(`
        <html>
          <body>
            <p>Use <a href="http://localhost:3000">http://localhost:3000</a> instead: codespaces via 127.0.0.1 are not what you want.</p>
          </body>
        </html>
      `) as unknown as void;
    }
  }

  return next();
}
