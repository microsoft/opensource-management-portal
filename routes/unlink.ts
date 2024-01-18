//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';
const router: Router = Router();

import { getProviders } from '../lib/transitional';
import { wrapError } from '../lib/utils';
import { IndividualContext } from '../business/user';
import { jsonError } from '../middleware';
import { ReposAppRequest, OrganizationMembershipState, UnlinkPurpose } from '../interfaces';

router.use(
  asyncHandler(async function (req: ReposAppRequest, res: Response, next: NextFunction) {
    const memberOfOrganizations = [];
    const { operations } = getProviders(req);
    const ghi = req.individualContext.getGitHubIdentity();
    if (!ghi || !ghi.username) {
      return next(new Error('GitHub identity required'));
    }
    const username = ghi.username;
    for (const organization of operations.organizations.values()) {
      try {
        const result = await organization.getMembership(username);
        let state = null;
        if (result && result.state) {
          state = result.state;
        }
        if (state === OrganizationMembershipState.Active || state === OrganizationMembershipState.Pending) {
          memberOfOrganizations.push(organization);
        }
      } catch (error) {
        // TODO: consider insights here, but we do not want to halt progress
        // on allowing unlink operations
      }
    }
    req.currentOrganizationMemberships = memberOfOrganizations;
    return next();
  })
);

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const link = req.individualContext.link;
    const id = req.individualContext.getGitHubIdentity().id;
    const { operations } = getProviders(req);
    const account = operations.getAccount(id);
    const currentOrganizationMemberships = await account.getOperationalOrganizationMemberships();
    if (link && id) {
      return req.individualContext.webContext.render({
        view: 'unlink',
        title: 'Remove corporate link and organization memberships',
        state: {
          organizations: currentOrganizationMemberships,
        },
      });
    } else {
      return next(new Error('No link could be found.'));
    }
  })
);

export async function unlinkInteractive(
  isJson: boolean,
  individualContext: IndividualContext,
  req: ReposAppRequest,
  res,
  next
) {
  const id = individualContext.getGitHubIdentity().id;
  const { operations, insights } = getProviders(req);
  const terminationOptions = {
    reason: 'User used the unlink function on the web site',
    purpose: UnlinkPurpose.Self,
  };
  let history: string[] = [];
  let error = null;
  try {
    history = await operations.terminateLinkAndMemberships(id, terminationOptions);
  } catch (exception) {
    insights?.trackException({ exception });
    error = exception;
  }
  const hadErrors = error ? 'had errors' : 'no';
  const eventData = {
    id: id.toString(),
    hadErrors,
  };
  for (let i = 0; i < history.length; i++) {
    const historyKey = `log${i + 1}`;
    eventData[historyKey] = history[i];
  }
  insights?.trackEvent({ name: 'PortalUserUnlink', properties: eventData });
  if (error) {
    const errorMessage =
      'You were successfully removed from all of your organizations. However, a failure happened during a data housecleaning operation with GitHub. Double check that you are happy with your current membership status on GitHub.com before continuing.';
    return next(isJson ? jsonError(errorMessage, 400) : wrapError(error, errorMessage));
  } else {
    if (isJson) {
      res.status(204);
      return res.end();
    }
    return res.redirect('/signout?unlink');
  }
}

router.post(
  '/',
  asyncHandler(async function (req: ReposAppRequest, res: Response, next: NextFunction) {
    const individualContext = req.individualContext;
    // TODO: validate
    return unlinkInteractive(false, individualContext, req, res, next);
  })
);

export default router;
