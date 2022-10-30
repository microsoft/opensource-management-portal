//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigRootActiveDirectory } from './activeDirectory.types';
import type { ConfigRootActiveDirectoryGuests } from './activeDirectoryGuests.types';
import type { ConfigRootAdministrators } from './administrators.types';
import type { ConfigRootApi } from './api.flags.types';
import type { ConfigRootAuthentication } from './authentication.types';
import type { ConfigRootBrand } from './brand.types';
import type { ConfigRootCampaigns } from './campaigns.types';
import type { ConfigRootClient } from './client.types';
import type { ConfigRootContainers } from './containers.types';
import type { ConfigRootContinuousDeployment } from './continuousDeployment.types';
import type { ConfigRootCorporate } from './corporate.types';
import type { ConfigRootData } from './data.types';
import type { ConfigRootDebug } from './debug.types';
import type { ConfigRootDiagnostics } from './diagnostics.types';
import type { ConfigRootEntityProviders } from './entityProviders.types';
import type { ConfigRootFeatures } from './features.types';
import type { ConfigRootGitHub } from './github.types';
import type { ConfigRootGraph } from './graph.types';
import type { ConfigRootIdentity } from './identity.types';
import type { ConfigRootImpersonation } from './impersonation.types';
import type { ConfigRootJit } from './jit.types';
import type { ConfigRootJobs } from './jobs.types';
import type { ConfigRootLegalEntities } from './legalEntities.types';
import type { ConfigRootLogging } from './logging.types';
import type { ConfigRootMail } from './mail.types';
import type { ConfigRootMailAddresses } from './mailAddresses.types';
import type { ConfigRootNews } from './news.types';
import type { ConfigRootNode } from './node.types';
import type { ConfigRootNotifications } from './notifications.types';
import type { ConfigRootNpm } from './npm.types';
import type { ConfigRootRedis } from './redis.types';
import type { ConfigRootReview } from './review.types';
import type { ConfigRootServiceMessage } from './serviceMessage.types';
import type { ConfigRootSession } from './session.types';
import type { ConfigRootStartup } from './startup.types';
import type { ConfigRootSudo } from './sudo.types';
import type { ConfigRootTelemetry } from './telemetry.types';
import type { ConfigRootTypeScript } from './typescript.types';
import type { ConfigRootUrls } from './urls.types';

import type { ConfigRootUserAgent } from './userAgent.types';
import type { ConfigRootWebHealthProbes } from './webHealthProbes.types';
import type { ConfigRootWeb } from './web.types';
import type { ConfigRootWebServer } from './webServer.types';

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
  ConfigRootFeatures &
  ConfigRootGitHub &
  ConfigRootGraph &
  ConfigRootIdentity &
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
  ConfigRootNpm &
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
