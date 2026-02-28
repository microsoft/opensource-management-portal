//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { IndividualContext } from '../../business/user/index.js';
import { jsonError } from '../../middleware/index.js';
import { CreateError, ErrorHelper, getProviders } from '../../lib/transitional.js';
import { unlinkInteractive } from '../../routes/unlink.js';
import { interactiveLinkUser } from '../../routes/link.js';
import type { ReposAppRequest } from '../../interfaces/index.js';
import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment.js';

const router: Router = Router();

async function validateLinkOk(req: ReposAppRequest, res: Response, next: NextFunction) {
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const { insights } = activeContext;
  const providers = getProviders(req);
  const config = providers.config;
  let validateAndBlockGuests = false;
  if (config && config.activeDirectory && config.activeDirectory.authentication.blockGuestUserTypes) {
    validateAndBlockGuests = true;
  }
  // If the app has not been configured to check whether a user is a guest before linking, continue:
  if (!validateAndBlockGuests) {
    return next();
  }
  const aadId = activeContext.corporateIdentity.id;
  // If the app is configured to check guest status, do this now, before linking:
  const graphProvider = providers.graphProvider;
  // REFACTOR: delegate the decision to the auth provider
  if (!graphProvider || !graphProvider.getUserById) {
    return next(jsonError('No configured graph provider', 500));
  }
  insights.trackEvent({
    name: 'LinkValidateNotGuestStart',
    properties: {
      aadId: aadId,
    },
  });
  try {
    const details = await graphProvider.getUserById(aadId);
    const userType = details.userType;
    const displayName = details.displayName;
    const userPrincipalName = details.userPrincipalName;
    const companySpecific = getCompanySpecificDeployment();
    if (companySpecific?.features?.linking?.confirmLinkingAuthorized) {
      try {
        await companySpecific.features.linking.confirmLinkingAuthorized(providers, activeContext);
      } catch (err) {
        insights?.trackException({
          exception: err,
          properties: {
            name: 'api.link.company_validation.denied',
          },
        });
        insights?.trackMetric({
          name: 'api.link.company_validation.denials',
          value: 1,
        });
        return next(
          CreateError.NotAuthorized(err?.message || 'You are not authorized to link your account.')
        );
      }
    }
    // If the user is a guest, block the link:
    const block = (userType as string) === 'Guest';
    const blockedRecord = block ? 'BLOCKED' : 'not blocked';
    insights.trackEvent({
      name: 'LinkValidateNotGuestGraphSuccess',
      properties: {
        aadId: aadId,
        userType: userType,
        displayName: displayName,
        userPrincipalName: userPrincipalName,
        blocked: blockedRecord,
      },
    });
    if (block) {
      insights.trackMetric({ name: 'LinksBlockedForGuests', value: 1 });
      const err = jsonError(
        `This system is not available to guests. You are currently signed in as ${displayName} ${userPrincipalName}. Please sign out or try a private browser window.`,
        400
      );
      insights?.trackException({ exception: err });
      return next(err);
    }
    const manager = await providers.graphProvider.getManagerById(aadId);
    if (!manager || !manager.userPrincipalName) {
      return next(
        jsonError(
          'You do not have an active manager entry in the directory, so cannot yet use this app to link.',
          400
        )
      );
    }
    return next();
  } catch (graphError) {
    insights.trackException({
      exception: graphError,
      properties: {
        aadId: aadId,
        name: 'LinkValidateNotGuestGraphFailure',
      },
    });
    return next(
      jsonError(graphError.toString() || 'Generic lookup error', ErrorHelper.GetStatus(graphError) || 500)
    );
  }
}

router.get('/banner', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { config } = getProviders(req);
  const offline = config?.github?.links?.provider?.linkingOfflineMessage;
  return res.json({ offline }) as unknown as void;
});

router.delete('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  return unlinkInteractive(true, activeContext, req, res, next);
});

router.post('/', validateLinkOk, async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  return interactiveLinkUser(true, activeContext, req, res, next);
});

router.use('/*splat', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  return next(jsonError('API or route not found', 404));
});

export default router;
