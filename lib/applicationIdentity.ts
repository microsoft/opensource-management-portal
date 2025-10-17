//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  AzureCliCredential,
  ClientAssertionCredential,
  ClientSecretCredential,
  ManagedIdentityCredential,
  TokenCredential,
} from '@azure/identity';
import Debug from 'debug';

import type {
  EntraApplicationIdentity,
  EntraApplicationIdentityPair,
  IProviders,
  SiteConfiguration,
} from '../interfaces/index.js';
import { CreateError, sha256 } from './transitional.js';
import getCompanySpecificDeployment from '../middleware/companySpecificDeployment.js';
import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node';

export type ApplicationIdentityOverrides = {
  clientId: string;
  clientSecret?: string;
};

export type TokenWithDetails = {
  accessToken: string;
  expiresOn: Date;
  clientId: string;
};

export interface LegacyAdalTokenResponse {
  tokenType: string; // Bearer
  expiresIn: number; // seconds
  expiresOn: Date | string;
  resource: string;
  accessToken: string;
  refreshToken?: string;
  createdOn?: Date | string;
  userId?: string;
  isUserIdDisplayable?: boolean;
  tenantId?: string;
  oid?: string;
  givenName?: string;
  familyName?: string;
  identityProvider?: string;
  error?: any;
  errorDescription?: any;
  [x: string]: any;
}

const federatedAudienceUri = 'api://AzureADTokenExchange';

const debug = Debug.debug('entra');
const DEBUG_MESSAGE_ON_CACHE_REUSE = false;
const ENTRA_ALLOW_AZURE_CLI_KEY = 'ENTRA_ALLOW_AZURE_CLI';

const cachedApplicationInstancedByTenantIdClientId = new Map<string, EntraApplication>();

export interface IEntraApplicationTokens {
  clientId: string;
  tenantId: string;
  getClientDescription(): string;
  getTenantDisplayName(): string;
  getAccessToken(resource: string): Promise<string>;
}

export function getEntraApplicationUserAssignedIdentity(config: SiteConfiguration) {
  return config.activeDirectory.application.managedIdentity.clientId;
}

export function getEntraApplicationUserAssignedTenant(config: SiteConfiguration): string {
  const { activeDirectory } = config;
  const { nextGenerationApplicationRegistration } = activeDirectory.application;
  if (
    nextGenerationApplicationRegistration?.tenantId &&
    (nextGenerationApplicationRegistration?.clientId ||
      nextGenerationApplicationRegistration?.useDeveloperCli)
  ) {
    return nextGenerationApplicationRegistration.tenantId;
  }
  throw CreateError.InvalidParameters(
    'No managed identity tenant ID configured in activeDirectory.application'
  );
}

function getNextGenerationEntraApplicationIdentity(config: SiteConfiguration): EntraApplicationIdentity {
  // the evolving next generation approach... if this is managed identity,
  // great; otherwise, fallback to the entra app code below for the time being
  // to allow for interim dev approach.
  const { activeDirectory } = config;
  const { nextGenerationApplicationRegistration } = activeDirectory.application;
  if (
    nextGenerationApplicationRegistration?.clientId ||
    nextGenerationApplicationRegistration?.useDeveloperCli
  ) {
    const { clientId, optionalClientSecret, tenantId, useDeveloperCli } =
      nextGenerationApplicationRegistration;
    return {
      clientId,
      clientSecret: optionalClientSecret,
      tenantId,
      useDeveloperCli,
    };
  }
  const overrides = getEntraApplicationIdentity(config);
  if (!overrides) {
    throw CreateError.InvalidParameters(
      'No Entra application configuration found in activeDirectory.application'
    );
  }
  return {
    clientId: overrides.clientId,
    clientSecret: overrides.clientSecret,
    tenantId: overrides.tenantId,
    useDeveloperCli: overrides.useDeveloperCli,
  };
}

export function getEntraApplicationIdentityInstance(
  providers: IProviders,
  destinationResource?: string,
  overrides?: EntraApplicationIdentityPair
): EntraApplication {
  const { config } = providers;
  const companySpecific = getCompanySpecificDeployment();
  let identity: EntraApplicationIdentity;
  if (companySpecific?.features?.identity?.tryGetEntraApplicationIdentity) {
    identity = companySpecific.features.identity.tryGetEntraApplicationIdentity(
      providers,
      destinationResource
    );
  }
  if (overrides && identity?.tenantId) {
    debug(
      `Overriding Entra application identity to create a new instance of client=${overrides.clientId} in call to getEntraApplicationIdentityInstance for tenant=${identity.tenantId}`
    );
    return new EntraApplication(
      providers,
      identity.tenantId,
      `Entra ID app overridden to ${overrides.clientId}`,
      overrides
    );
  } else if (overrides) {
    throw CreateError.InvalidParameters('No tenant in identity set');
  }
  if (!identity) {
    identity = getNextGenerationEntraApplicationIdentity(config);
  }
  const tenantId = identity.tenantId;
  const clientId = identity.clientId || (identity.useDeveloperCli ? 'azure-cli' : 'unknown');
  const combined = `${tenantId}:${clientId}`;
  let instance = cachedApplicationInstancedByTenantIdClientId.get(combined);
  const clientDescriptor = identity.clientId
    ? `client=${clientId}`
    : identity.useDeveloperCli
      ? 'client=azure-cli'
      : 'client=unknown';
  if (instance) {
    // debug(
    //   `Returning cached instance of Entra application identity for tenant=${tenantId} ${clientDescriptor}`
    // );
    return instance;
  }
  if (companySpecific?.features?.identity?.createEntraApplicationInstance) {
    instance = companySpecific.features.identity.createEntraApplicationInstance(
      providers,
      destinationResource
    );
    if (instance) {
      debug(`Used company-specific Entra application identity creator for tenant=${tenantId}`);
    }
  }
  if (!instance) {
    instance = new EntraApplication(
      providers,
      tenantId,
      identity.useDeveloperCli ? `Entra ID via Azure CLI` : `Entra ID app ${clientDescriptor}`,
      identity
    );
    if (instance) {
      debug(`Created new Entra application identity for tenant=${tenantId} ${clientDescriptor}`);
    }
  }
  if (instance) {
    debug(`Caching Entra application identity for tenant=${tenantId} ${clientDescriptor}`);
    cachedApplicationInstancedByTenantIdClientId.set(combined, instance);
  }
  return instance;
}

export function tryGetEntraApplicationTokenCredential(providers: IProviders, destinationResource?: string) {
  const applicationIdentity = getEntraApplicationIdentityInstance(providers, destinationResource);
  if (applicationIdentity) {
    const tokenCredential = applicationIdentity.getTokenCredential();
    return tokenCredential;
  }
}

export function getEntraApplicationUserAssignedIdentityCredential(
  config: SiteConfiguration,
  shouldThrow: boolean = true
) {
  const clientId = getEntraApplicationUserAssignedIdentity(config);
  if (!clientId) {
    if (shouldThrow) {
      throw CreateError.InvalidParameters('No managed identity client ID configured');
    }
    return;
  }
  const managedIdentityCredential = new ManagedIdentityCredential({
    clientId,
  });
  return managedIdentityCredential;
}

export function getEntraApplicationIdentity(
  config: SiteConfiguration,
  throwIfMissing = false
): EntraApplicationIdentity {
  const appConfig = config.activeDirectory.application;
  let entraConfiguration: EntraApplicationIdentity = null;
  if (
    appConfig.fallbackIfSingleApplicationRegistration.useDeveloperCli ||
    (appConfig.fallbackIfSingleApplicationRegistration.clientId &&
      appConfig.fallbackIfSingleApplicationRegistration.tenantId)
  ) {
    entraConfiguration = appConfig.fallbackIfSingleApplicationRegistration;
  } else if (
    appConfig.nextGenerationApplicationRegistration.useDeveloperCli ||
    (appConfig.nextGenerationApplicationRegistration.clientId &&
      appConfig.nextGenerationApplicationRegistration.tenantId)
  ) {
    entraConfiguration = appConfig.nextGenerationApplicationRegistration;
  }
  if (!entraConfiguration) {
    if (throwIfMissing) {
      throw CreateError.InvalidParameters('No Entra application configuration found');
    }
    return;
  }

  return {
    clientId: entraConfiguration.clientId,
    clientSecret: entraConfiguration.clientSecret,
    tenantId: entraConfiguration.tenantId,
    useDeveloperCli: entraConfiguration.useDeveloperCli,
  };
}

enum EntraIdentityType {
  Unknown = 'unknown',
  ManagedIdentityClientAssertion = 'managedIdentityClientAssertion',
  ClientSecret = 'clientSecret',
  AzureCli = 'azureCli',
}

export class EntraApplication implements IEntraApplicationTokens {
  private credential: TokenCredential;
  private _clientId: string;
  private _userAssignedManagedIdentityClientId: string;
  private _clientAssertionCallback: () => Promise<string>;
  private _description: string;
  private _type: EntraIdentityType = EntraIdentityType.Unknown;
  private _confidentialClientByAuthority: Map<string, ConfidentialClientApplication> = new Map<
    string,
    ConfidentialClientApplication
  >();
  private _cachedTokenByAuthority: Map<string, TokenWithDetails> = new Map<string, TokenWithDetails>();
  #_clientSecret: string;

  constructor(
    private providers: IProviders,
    public tenantId: string,
    description: string,
    private overrides?: ApplicationIdentityOverrides,
    private _getTenantDisplayName?: (tenantId: string) => string,
    private _getClientDisplayName?: (providers: IProviders, clientId: string) => string
  ) {
    this._description = '[' + description + ']';
    this.setup();
  }

  get isManagedIdentity() {
    return !!this._userAssignedManagedIdentityClientId;
  }

  get userAssignedManagedIdentityClientId() {
    return this._userAssignedManagedIdentityClientId;
  }

  get isDeveloperCli() {
    return this._type === EntraIdentityType.AzureCli;
  }

  get clientType() {
    return this._type;
  }

  get clientId() {
    return this._clientId;
  }

  getClientDescription() {
    return this._description;
  }

  getTenantDisplayName() {
    return this._getTenantDisplayName ? this._getTenantDisplayName(this.tenantId) : this.tenantId;
  }

  getTokenCredential() {
    return this.credential;
  }

  private validateAzureCliAvailable() {
    const { config } = this.providers;
    const enabled = !!config.process.get(ENTRA_ALLOW_AZURE_CLI_KEY);
    if (!enabled) {
      throw CreateError.InvalidParameters(
        'Azure CLI is not enabled for this environment. To use Azure CLI for identity, set the process environment variable ' +
          ENTRA_ALLOW_AZURE_CLI_KEY +
          ' to "1".'
      );
    }
    // TODO: check the files...
  }

  private setup() {
    const { config } = this.providers;
    try {
      if (!this.overrides?.clientSecret) {
        this._userAssignedManagedIdentityClientId = getEntraApplicationUserAssignedIdentity(config);
        if (this._userAssignedManagedIdentityClientId) {
          debug(
            `${this._description} user-assigned managed identity client ID: ${this._userAssignedManagedIdentityClientId}`
          );
        }
      }
      const userAssignedManagedIdentityClientId = this._userAssignedManagedIdentityClientId;
      let clientSecret: string;
      let useAzureCli = false;
      if (this.overrides?.clientId) {
        this._clientId = this.overrides.clientId;
        if (this.overrides?.clientSecret) {
          clientSecret = this.overrides.clientSecret;
          debug(
            `${this._description} overriding clientId: ${this._clientId}, secret: ${redact(this.overrides.clientSecret)} (redacted)`
          );
        } else {
          debug(`${this._description} overriding clientId: ${this._clientId}`);
        }
      } else {
        const {
          clientId,
          clientSecret: clientSecretOverride,
          useDeveloperCli,
        } = getNextGenerationEntraApplicationIdentity(config);
        if (useDeveloperCli) {
          useAzureCli = true;
          debug(`${this._description} using Azure CLI for identity`);
        }
        this._clientId = clientId;
        if (clientSecretOverride) {
          clientSecret = clientSecretOverride;
          debug(
            `${this._description} clientId: ${this._clientId}, secret: ${redact(clientSecret)} (redacted)`
          );
        } else {
          debug(`${this._description} clientId: ${this._clientId}`);
        }
      }
      if (useAzureCli) {
        this.validateAzureCliAvailable();
      }
      if (!this._clientId && !useAzureCli) {
        throw CreateError.ParameterRequired('clientId');
      }
      const tenantId = this.tenantId;
      if (!tenantId) {
        throw CreateError.ParameterRequired('tenantId');
      }
      const authorityHost = 'https://login.microsoftonline.com/' + tenantId;
      debug(`${this._description} tenant=${this.getTenantDisplayName()} and authorityHost=${authorityHost}`);
      if (useAzureCli) {
        const subscriptionId =
          config.activeDirectory?.application?.nextGenerationApplicationRegistration
            ?.developerCliSubscriptionId;
        // if (subscriptionId) {
        //   debug(`${this._description} Azure CLI targeting subscription ID: ${subscriptionId}`);
        // }
        this.credential = new AzureCliCredential();
        //   subscriptionId ? { subscription: subscriptionId } : { tenantId }
        // );
        this._type = EntraIdentityType.AzureCli;
      } else if (userAssignedManagedIdentityClientId) {
        const managedIdentityCredential = new ManagedIdentityCredential({
          clientId: userAssignedManagedIdentityClientId,
          authorityHost,
        });
        const tryGetToken = async () => {
          try {
            debug(
              `${this._description} obtaining managed identity access token for federated audience=${federatedAudienceUri}`
            );
            const accessToken = await managedIdentityCredential.getToken(federatedAudienceUri);
            debug(
              `${this._description} managed identity access token acquired, expires=${accessToken.expiresOnTimestamp}`
            );
            return accessToken.token;
          } catch (error) {
            console.error(`${this._description} failed to obtain managed identity access token:`, error);
            throw error;
          }
        };
        this.credential = new ClientAssertionCredential(tenantId, this.clientId, tryGetToken);
        this._clientAssertionCallback = tryGetToken;
        this._type = EntraIdentityType.ManagedIdentityClientAssertion;
        debug(`${this._description} client assertion identity (${this.clientId}) for token acquisition`);
      } else {
        if (!clientSecret) {
          throw CreateError.ParameterRequired(
            `clientSecret to instantiate ClientSecretCredential for ${this._description}`
          );
        }
        this.credential = new ClientSecretCredential(tenantId, this.clientId, clientSecret, {
          authorityHost,
        });
        this._type = EntraIdentityType.ClientSecret;
        debug(`${this._description} secret for acquisition: ${redact(clientSecret)} (redacted)`);
      }
      this.#_clientSecret = clientSecret;
    } catch (error) {
      throw error;
    }
  }

  async getAccessToken(resource: string): Promise<string> {
    const token = await this.getDetailedAccessToken(resource);

    return token.accessToken;
  }

  getConfidentialClient(authority: string) {
    const { insights } = this.providers;
    let client: ConfidentialClientApplication = this._confidentialClientByAuthority.get(authority);
    if (!client) {
      const nodeSystemOptions = {
        loggerOptions: {
          loggerCallback(loglevel: LogLevel, message: string, containsPii: boolean) {
            if (!containsPii) {
              debug(`entra_id.msal_client.log: ${loglevel}: ${message}`);
              insights?.trackEvent({
                name: 'entra_id.msal_client.log',
                properties: {
                  loglevel: LogLevel[loglevel],
                  message,
                },
              });
            }
          },
          piiLoggingEnabled: false,
          logLevel: LogLevel.Warning,
        },
      };
      if (this._type === EntraIdentityType.ManagedIdentityClientAssertion) {
        const clientAssertion = this._clientAssertionCallback;
        client = new ConfidentialClientApplication({
          auth: {
            clientId: this.clientId,
            authority,
            clientAssertion,
          },
          system: nodeSystemOptions,
        });
      } else {
        client = new ConfidentialClientApplication({
          auth: {
            clientId: this.clientId,
            clientSecret: this.#_clientSecret,
            authority,
          },
          system: nodeSystemOptions,
        });
      }
      this._confidentialClientByAuthority.set(authority, client);
    }
    return client;
  }

  async getDetailedAccessToken(resource: string): Promise<TokenWithDetails> {
    const { insights } = this.providers;
    try {
      if (resource?.startsWith('[azure-cli:')) {
        throw CreateError.InvalidParameters(
          'Resource is not valid: passthrough Azure CLI special moniker present: ' + resource
        );
      }
      const resourceDescription = this._getClientDisplayName
        ? this._getClientDisplayName(this.providers, resource)
        : resource;
      const scope = this.getScopeWithDefaultAppended(resource);
      let cachedToken = this._cachedTokenByAuthority.get(scope);
      if (cachedToken) {
        const now = new Date();
        const inOneMinute = new Date(now.getTime() + 60 * 1000);
        const inTwoMinutes = new Date(now.getTime() + 2 * 60 * 1000);
        const shortTokenSha = sha256(cachedToken.accessToken).substr(0, 8) + '*';
        if (cachedToken?.expiresOn && cachedToken.expiresOn < now) {
          debug(
            `${this._description} not using cached access token ${shortTokenSha} for ${resourceDescription} expired ${cachedToken.expiresOn.toISOString()}`
          );
          this._cachedTokenByAuthority?.set(scope, undefined);
          cachedToken = undefined;
        } else if (
          cachedToken?.expiresOn &&
          cachedToken.expiresOn < inTwoMinutes &&
          cachedToken.expiresOn > inOneMinute
        ) {
          debug(
            `${this._description} briefly using expiring token ${shortTokenSha} for ${resourceDescription} ${cachedToken.expiresOn.toISOString()}`
          );
          this._cachedTokenByAuthority?.set(scope, undefined);
        } else if (DEBUG_MESSAGE_ON_CACHE_REUSE) {
          debug(
            `${this._description} using cached token ${shortTokenSha} for ${resourceDescription} expiring ${cachedToken.expiresOn.toISOString()}`
          );
        }
        if (cachedToken?.accessToken) {
          return cachedToken;
        }
      }
      const response = await this.credential.getToken(scope);
      const expiresOn = new Date(response.expiresOnTimestamp);
      const expiresOnNoSeconds = expiresOn.toISOString().slice(0, 16);
      const shortTokenSha = sha256(response.token).substr(0, 8) + '*';
      debug(
        `${this._description} new token for ${resourceDescription} ${shortTokenSha} expires=${expiresOnNoSeconds} ${this.clientType === EntraIdentityType.AzureCli ? 'via/cli' : 'w/clientId=' + this.clientId}, tenant=${this.getTenantDisplayName()}`
      );
      cachedToken = {
        accessToken: response.token,
        expiresOn,
        clientId: this.clientId,
      };
      this._cachedTokenByAuthority.set(scope, cachedToken);
      return cachedToken;
    } catch (error) {
      if (
        error?.message?.includes('CredentialUnavailableError') ||
        error?.message?.includes('Invalid scope was specified by the user or calling client')
      ) {
        console.warn(`Resource: ${resource}`);
        throw error;
      } else if (error?.message?.includes('The managed identity endpoint is not available.')) {
        insights?.trackEvent({
          name: 'ManagedIdentityEndpointNotAvailable',
          properties: {
            resource,
            clientId: this.clientId,
            tenantId: this.tenantId,
          },
        });
      }
      throw error;
    }
  }

  async getTokenAsLegacyAdalFormat(resource: string): Promise<LegacyAdalTokenResponse> {
    const token = await this.getDetailedAccessToken(resource);
    return {
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresOn: token.expiresOn,
      resource,
      accessToken: token.accessToken,
    };
  }

  private getScopeWithDefaultAppended(scope: string): string {
    if (scope.endsWith('.default')) {
      return scope;
    }
    return scope.endsWith('/') ? scope + '.default' : scope + '/.default';
  }
}

function redact(value: string) {
  return value.length > 10 ? value.substr(0, 3) + '*'.repeat(6) + '+' : '*'.repeat(value.length);
}
