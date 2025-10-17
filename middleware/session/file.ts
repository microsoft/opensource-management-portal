//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import session from 'express-session';
import fileStoreFactory from 'session-file-store';
import os from 'os';

import type { IProviders } from '../../interfaces/providers.js';

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 1; // 1 day

export async function prepareFileSessions(providers: IProviders) {
  const { config } = providers;
  const sessionName = config.session.name || 'node';
  const envName = config.environment.configuration || process.env.NODE_ENV || 'development';

  const tempDir = os.tmpdir();
  const sessionsDir = `${tempDir}/sessions-${sessionName}-${envName}`;

  const FileStore = fileStoreFactory(session);
  const sessionProvider = new FileStore({
    path: sessionsDir,
    ttl: DEFAULT_SESSION_TTL_SECONDS,
  });
  (sessionProvider as any).debugStartup = `saving in ${sessionsDir}`;

  providers.session = sessionProvider;
}
