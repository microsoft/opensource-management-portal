//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { randomUUID } from 'crypto';
import { Session } from 'express-session';
import { Strategy } from 'passport-strategy';
import { ConfidentialClientApplication } from '@azure/msal-node';
import Debug from 'debug';

import { ReposAppRequest } from '../../../interfaces/web.js';
import {
  EntraApplicationIdentity,
  EntraApplicationIdentityWithClientType,
  IReposApplication,
} from '../../../interfaces/app.js';
import { ApplicationIdentityOverrides, EntraApplication } from '../../../lib/applicationIdentity.js';

import { getCodespacesHostname, isCodespacesAuthenticating } from '../../../lib/utils.js';
import { CreateError, ErrorHelper, getProviders } from '../../../lib/transitional.js';

import type { AppInsightsTelemetryClient, IProviders } from '../../../interfaces/providers.js';
import type { SiteConfiguration } from '../../../config/index.types.js';
import type {
  AadJwtJson,
  AadResponseProfile,
  EntraAuthCodeUrlParameters,
  EntraSessionAugmentation,
} from './types.js';
import { processUserProfile } from './rewriting.js';
import getCompanySpecificDeployment from '../../companySpecificDeployment.js';
import { EntraIdClientType } from '../../../interfaces/enums.js';

const debug = Debug.debug('startup');
const debugAuthentication = Debug.debug('authentication');

const strategyId = 'entra-id';

// Validates that a query parameter is a string if present.
// Throws an error if the value is present but not a string.
// Returns undefined if the value is not present.
function validateStringQueryParam(value: unknown, paramName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw CreateError.InvalidParameters(`Query parameter '${paramName}' must be a string`);
  }
  return value;
}

export type EntraStrategyOptions = {
  identity: EntraApplicationIdentity;
  clientApplication: ConfidentialClientApplication;
  redirectUrl: string;
};

type EntraTokenRequestParameters = {
  scopes: string[];
  redirectUri: string;
};

type StrategyOutcome = {
  error?: Error;
  fail?: {
    challenge?: unknown;
    status: number;
  };
  redirect?: string;
  success?: {
    user: unknown;
    info?: unknown;
  };
};

type AugmentedSession = Session & {
  user?: {
    azure?: {
      id: string;
    };
  };
};

export function createEntraStrategies(
  app: IReposApplication,
  insights: AppInsightsTelemetryClient,
  config: SiteConfiguration
) {
  const strategies: Record<string, Strategy> = {};
  const entraStrategy = createEntraUserAuthenticatorStrategy(app, insights, config);
  if (entraStrategy) {
    strategies[entraStrategy.name] = entraStrategy;
  }
  return strategies;
}

function getEntraAuthenticationClientIdentity(
  config: SiteConfiguration,
  throwIfMissing = false
): EntraApplicationIdentityWithClientType {
  const entraConfig = config.activeDirectory.authentication.entraManagedIdentityAuthentication;
  const { applicationRegistration } = entraConfig;
  let entraConfiguration: EntraApplicationIdentityWithClientType;
  if (
    applicationRegistration?.clientId ||
    applicationRegistration?.authenticationType === EntraIdClientType.AzureCli
  ) {
    entraConfiguration = {
      clientId: applicationRegistration.clientId,
      clientSecret: applicationRegistration.clientSecret,
      tenantId: applicationRegistration.tenantId,
      useDeveloperCli: applicationRegistration.authenticationType === EntraIdClientType.AzureCli,
      clientType: applicationRegistration.authenticationType,
    };
  }
  if (
    entraConfiguration?.clientSecret &&
    applicationRegistration.authenticationType === EntraIdClientType.ManagedIdentity
  ) {
    entraConfiguration.clientSecret = null;
  }
  if (
    applicationRegistration.authenticationType === EntraIdClientType.Secret &&
    !entraConfiguration.clientSecret
  ) {
    throw CreateError.InvalidParameters(
      'Entra application configuration is missing a client secret while configured for secrets'
    );
  }
  if (
    ![EntraIdClientType.ManagedIdentity, EntraIdClientType.Secret, EntraIdClientType.AzureCli].includes(
      applicationRegistration.authenticationType
    )
  ) {
    throw CreateError.InvalidParameters(
      'Entra application configuration type is invalid: ' + applicationRegistration.authenticationType
    );
  }
  if (!entraConfiguration?.clientId && entraConfiguration?.clientType !== EntraIdClientType.AzureCli) {
    if (throwIfMissing) {
      throw CreateError.InvalidParameters('No Entra application configuration found');
    }
    return;
  }

  return entraConfiguration;
}

function createEntraUserAuthenticatorStrategy(
  app: IReposApplication,
  insights: AppInsightsTelemetryClient,
  config: SiteConfiguration
) {
  const identity = getEntraAuthenticationClientIdentity(config, false);
  if (!identity || !identity.clientId) {
    debug('No Entra ID client configured, corporate authentication will be unavailable.');
    return null;
  }
  const { entraManagedIdentityAuthentication } = config.activeDirectory.authentication;
  if (!entraManagedIdentityAuthentication) {
    throw CreateError.InvalidParameters('Entra ID authentication is not configured');
  }
  const { isMultiTenant, redirectUrl, applicationRegistration } = entraManagedIdentityAuthentication;
  if (!redirectUrl) {
    throw CreateError.InvalidParameters('Entra ID authentication is not configured with a redirect URL');
  }
  const { clientId, tenantId } = identity;
  if (!tenantId) {
    throw CreateError.InvalidParameters('Entra ID authentication is not configured with a tenant ID');
  }
  const { authenticationType } = applicationRegistration;
  let overrides: ApplicationIdentityOverrides = undefined;
  // KNOWN: Edge case would be overriding client ID and expecting managed identity
  if (authenticationType === EntraIdClientType.Secret || authenticationType === EntraIdClientType.AzureCli) {
    debug('Entra ID authentication is configured with a secret, will override Entra Application instance.');
    overrides = {
      clientId,
      clientSecret: applicationRegistration.clientSecret,
    };
  }

  const providers = app.settings.providers as IProviders;
  const clientIdentity = new EntraApplication(providers, tenantId, 'authentication', overrides);
  const targetTenant = isMultiTenant ? 'organizations' : tenantId;
  const authority = `https://login.microsoftonline.com/${targetTenant}/`;
  const redirectUrlAsUrl = new URL(redirectUrl);
  const redirectSuffix = redirectUrlAsUrl.pathname;
  const codespaces = config?.github?.codespaces;
  const finalRedirectUrl =
    isCodespacesAuthenticating(config, strategyId) && !codespaces?.block
      ? getCodespacesHostname(config) + redirectSuffix
      : redirectUrl;
  debug(`Entra ID auth: clientId=${clientId}, redirectUrl=${finalRedirectUrl}`);
  insights?.trackEvent({
    name: 'StartupConfiguredAuthenticationEntraID',
    properties: {
      clientId: clientIdentity.clientId,
      clientType: clientIdentity.clientType,
      tenantId,
      authority,
      redirectUrl,
      finalRedirectUrl,
    },
  });

  const clientApplication = clientIdentity.getConfidentialClient(authority);
  return new EntraIDStrategy({ identity, clientApplication, redirectUrl: finalRedirectUrl });
}

class EntraIDStrategy extends Strategy {
  private static instanceCounter = 0;
  public readonly name: string;
  private fixedTokenRequest: EntraTokenRequestParameters;

  constructor(private options: EntraStrategyOptions) {
    super();

    if (EntraIDStrategy.instanceCounter === 0) {
      this.name = strategyId;
    } else {
      ++EntraIDStrategy.instanceCounter;
      this.name = `${strategyId}:${EntraIDStrategy.instanceCounter}`;
    }
    this.fixedTokenRequest = {
      scopes: ['user.read'],
      redirectUri: this.redirectUrl,
    };

    debug(`Entra ID strategy: ${this.name} with redirect ${this.redirectUrl}`);
  }

  get redirectUrl() {
    return this.options.redirectUrl;
  }

  private clientApplication() {
    return this.options.clientApplication;
  }

  authenticate(req: ReposAppRequest) {
    debugAuthentication('Entra ID authenticating request');
    const sessionUser = req.session as AugmentedSession;
    if (sessionUser?.user?.azure?.id) {
      return this.success(sessionUser.user);
    }

    const outcome = (result: StrategyOutcome) => {
      if (!result) {
        return this.error(CreateError.ServerError('No outcome.'));
      }
      if (result.error) {
        return this.error(result.error);
      }
      if (result.fail) {
        return this.fail(result.fail.challenge, result.fail.status);
      }
      if (result.redirect) {
        return this.redirect(result.redirect);
      }
      if (result.success) {
        return this.success(result.success.user, result.success.info);
      }
      return this.error(CreateError.ServerError((result as any)?.message || 'Unknown outcome.'));
    };

    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    // prettier-ignore
    if (code && state) { // CodeQL [SM01513] this is basic value existence checking to trigger validation logic only when present
      debugAuthentication('Entra ID callback: code and state present');
      return this.callback(req, code, state).then(outcome).catch(outcome);
    }

    return this.navigateToEntra(req).then(outcome).catch(outcome);
  }

  private async navigateToEntra(req: ReposAppRequest): Promise<StrategyOutcome> {
    const stateParam = validateStringQueryParam(req.query?.state, 'state');
    const nonceParam = validateStringQueryParam(req.query?.nonce, 'nonce');
    const authCodeUrlParameters: EntraAuthCodeUrlParameters = {
      ...this.fixedTokenRequest,
      state: stateParam || randomUUID(),
      nonce: nonceParam || randomUUID(),
    };
    if (req.query?.prompt) {
      const prompt = validateStringQueryParam(req.query.prompt, 'prompt');
      const validPrompts = ['login', 'consent', 'select_account', 'admin_consent', 'none'];
      if (prompt && !validPrompts.includes(prompt)) {
        throw CreateError.InvalidParameters('Invalid prompt value: ' + prompt);
      }
      authCodeUrlParameters.prompt = prompt;
    }
    if (req.query.loginHint) {
      authCodeUrlParameters.loginHint = validateStringQueryParam(req.query.loginHint, 'loginHint');
    }
    if (req.query.domainHint) {
      authCodeUrlParameters.domainHint = validateStringQueryParam(req.query.domainHint, 'domainHint');
    }
    if (!req.session) {
      throw CreateError.InvalidParameters('Session required');
    }
    const session = req.session as EntraSessionAugmentation;
    session.nonce = authCodeUrlParameters.nonce;
    session.state = authCodeUrlParameters.state;
    const clientApplication = this.clientApplication();
    try {
      const authCodeUrl = await clientApplication.getAuthCodeUrl(authCodeUrlParameters);
      return { redirect: authCodeUrl };
    } catch (error) {
      return { error };
    }
  }

  private async callback(req: ReposAppRequest, code: string, state: string): Promise<StrategyOutcome> {
    const providers = getProviders(req);
    const { insights } = providers;
    const { correlationId } = req;
    const session = req.session as EntraSessionAugmentation;
    if (!session.nonce || !session.state) {
      return { error: CreateError.InvalidParameters('Nonce and state required') };
    }
    const tokenRequestParameters = {
      ...this.fixedTokenRequest,
      code,
      state,
    };
    const authCodeResponse = {
      nonce: session.nonce,
      code,
      state: session.state,
    };
    let failureCode = 401;

    insights?.trackEvent({
      name: 'web.entra_id.authentication.callback',
      properties: {
        correlationId,
      },
    });
    try {
      const clientApplication = this.clientApplication();
      const response = await clientApplication.acquireTokenByCode(tokenRequestParameters, authCodeResponse);
      if (!response || !response.accessToken) {
        insights?.trackEvent({
          name: 'entra_id.authentication.web.callback.no_token',
          properties: {
            correlationId,
          },
        });
        throw CreateError.ServerError(
          'Entra ID was not able to acquire a token to continue. Please try again soon, or report this issue if you continue to see problems.'
        );
      }
      const companySpecificDeployment = getCompanySpecificDeployment();
      if (companySpecificDeployment?.middleware?.authentication?.validateWebAuthenticationBearerToken) {
        try {
          await companySpecificDeployment.middleware.authentication.validateWebAuthenticationBearerToken(
            providers,
            req,
            response,
            response.tokenType + ' ' + response.accessToken
          );
          insights?.trackEvent({
            name: 'entra_id.authentication.web.callback.validated',
            properties: {
              correlationId,
            },
          });
          insights?.trackMetric({
            name: 'entra_id.authentication.web.token_validations',
            value: 1,
          });
        } catch (error) {
          insights?.trackEvent({
            name: 'entra_id.authentication.web.callback.validation_failed',
            properties: {
              correlationId,
            },
          });
          insights?.trackMetric({
            name: 'entra_id.authentication.web.token_validation_failures',
            value: 1,
          });
          throw error;
        }
      }
      session.nonce = undefined;
      session.state = undefined;
      const profile: AadResponseProfile = {
        _json: response.idTokenClaims as AadJwtJson,
        _raw: response.accessToken,
        oid: response.uniqueId,
        upn: response.account.username,
        displayName: response.account.name,
        sub: (response.idTokenClaims as any)?.sub,
        tenantId: response.tenantId,
      };
      const user = await processUserProfile(providers, profile);
      insights?.trackEvent({
        name: 'entra_id.authentication.web.callback.success',
        properties: {
          correlationId,
          tenantId: profile.tenantId,
        },
      });
      insights?.trackMetric({
        name: 'entra_id.authentication.web.successes',
        value: 1,
      });
      return { success: { user, info: profile } };
    } catch (error) {
      if (ErrorHelper.HasStatus(error)) {
        const errorStatus = ErrorHelper.GetStatus(error);
        if (errorStatus !== failureCode) {
          failureCode = errorStatus;
        }
      }
      insights?.trackException({
        exception: error,
        properties: {
          event: 'entra_id.authentication.web.callback.error',
          failureCode,
          message: error?.message || 'unknown',
          correlationId,
        },
      });
      insights?.trackMetric({
        name: 'entra_id.authentication.web.errors',
        value: 1,
        properties: {
          failureCode,
        },
      });
      if (error.message) {
        debugAuthentication(error.message);
        console.warn(error.message);
      }
      return { fail: { status: failureCode, challenge: { message: error.message } } };
    }
  }
}
