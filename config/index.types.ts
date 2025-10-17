//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigRootActiveDirectory } from './activeDirectory.types.js';
import type { ConfigRootActiveDirectoryGuests } from './activeDirectoryGuests.types.js';
import type { ConfigRootAdministrators } from './administrators.types.js';
import type { ConfigRootApi } from './api.flags.types.js';
import type { ConfigRootAuthentication } from './authentication.types.js';
import type { ConfigRootBrand } from './brand.types.js';
import type { ConfigRootCampaigns } from './campaigns.types.js';
import type { ConfigRootClient } from './client.types.js';
import type { ConfigRootContainers } from './containers.types.js';
import type { ConfigRootContinuousDeployment } from './continuousDeployment.types.js';
import type { ConfigRootCorporate } from './corporate.types.js';
import type { ConfigRootData } from './data.types.js';
import type { ConfigRootDebug } from './debug.types.js';
import type { ConfigRootDiagnostics } from './diagnostics.types.js';
import type { ConfigRootEntityProviders } from './entityProviders.types.js';
import type { ConfigRootEnvironment } from './environment.types.js';
import type { ConfigRootFeatures } from './features.types.js';
import type { ConfigRootGitHub } from './github.types.js';
import type { ConfigRootGraph } from './graph.types.js';
import type { ConfigRootImmutable } from './immutable.types.js';
import type { ConfigRootImpersonation } from './impersonation.types.js';
import type { ConfigRootJit } from './jit.types.js';
import type { ConfigRootJobs } from './jobs.types.js';
import type { ConfigRootLegalEntities } from './legalEntities.types.js';
import type { ConfigRootLogging } from './logging.types.js';
import type { ConfigRootMail } from './mail.types.js';
import type { ConfigRootMailAddresses } from './mailAddresses.types.js';
import type { ConfigRootNews } from './news.types.js';
import type { ConfigRootNode } from './node.types.js';
import type { ConfigRootNotifications } from './notifications.types.js';
import type { ConfigRootProcess } from './process.types.js';
import type { ConfigRootRedis } from './redis.types.js';
import type { ConfigRootReview } from './review.types.js';
import type { ConfigRootServiceMessage } from './serviceMessage.types.js';
import type { ConfigRootSession } from './session.types.js';
import type { ConfigRootStartup } from './startup.types.js';
import type { ConfigRootSudo } from './sudo.types.js';
import type { ConfigRootTelemetry } from './telemetry.types.js';
import type { ConfigRootTypeScript } from './typescript.types.js';
import type { ConfigRootUrls } from './urls.types.js';
import type { ConfigRootUserAgent } from './userAgent.types.js';
import type { ConfigRootWebHealthProbes } from './webHealthProbes.types.js';
import type { ConfigRootWeb } from './web.types.js';
import type { ConfigRootWebServer } from './webServer.types.js';

type ObfuscatedConfig = any;

type ConfigRootObfuscatedConfig = {
  obfuscatedConfig: ObfuscatedConfig;
};

// prettier-ignore
export type SiteConfiguration = 
  ConfigRootObfuscatedConfig &
  ConfigRootActiveDirectory &
  ConfigRootActiveDirectoryGuests &
  ConfigRootAdministrators &
  ConfigRootApi &
  ConfigRootAuthentication &
  ConfigRootBrand &
  ConfigRootCampaigns &
  ConfigRootClient &
  ConfigRootContainers &
  ConfigRootContinuousDeployment &
  ConfigRootCorporate &
  ConfigRootData &
  ConfigRootDebug &
  ConfigRootDiagnostics &
  ConfigRootEntityProviders &
  ConfigRootEnvironment &
  ConfigRootFeatures &
  ConfigRootGitHub &
  ConfigRootGraph &
  ConfigRootImmutable &
  ConfigRootImpersonation &
  ConfigRootJit &
  ConfigRootJobs &
  ConfigRootLegalEntities &
  ConfigRootLogging &
  ConfigRootMail &
  ConfigRootMailAddresses &
  ConfigRootNews &
  ConfigRootNode &
  ConfigRootNotifications &
  ConfigRootProcess &
  ConfigRootRedis &
  ConfigRootReview &
  ConfigRootServiceMessage &
  ConfigRootSession &
  ConfigRootStartup &
  ConfigRootSudo &
  ConfigRootTelemetry &
  ConfigRootTypeScript &
  ConfigRootUrls &
  ConfigRootUserAgent &
  ConfigRootWebHealthProbes &
  ConfigRootWeb &
  ConfigRootWebServer;
