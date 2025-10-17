//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { jsonError } from '../../middleware/index.js';
import { Operations } from '../../business/index.js';
import postLinkApi from './link.js';
import { CreateError, ErrorHelper, getProviders } from '../../lib/transitional.js';
import { wrapError } from '../../lib/utils.js';
import { extendedLinkApiVersions, getAllUsers, unsupportedApiVersions } from './links.utility.js';

import type { ICorporateLink, ReposApiRequest, VoidedExpressRoute } from '../../interfaces/index.js';

const router: Router = Router();

router.use(function (req: ReposApiRequest, res: Response, next: NextFunction) {
  const token = req.apiKeyToken;
  if (!token.hasScope) {
    return next(CreateError.NotAuthorized('The key is not authorized for specific APIs'));
  }
  if (!token.hasScope('links') && !token.hasScope('link')) {
    return next(CreateError.NotAuthorized('The key is not authorized to use the links API'));
  }
  return next();
});

router.post('/', postLinkApi as VoidedExpressRoute);

router.get('/', async (req: ReposApiRequest, res: Response, next: NextFunction) => {
  const { operations } = getProviders(req);
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps);
  req.insights.trackMetric({ name: 'ApiRequestLinks', value: 1 });
  res.set('Content-Type', 'application/json');
  res.send(JSON.stringify(results, undefined, 2));
});

router.get('/:linkid', async (req: ReposApiRequest, res: Response, next: NextFunction) => {
  if (unsupportedApiVersions.includes(req.apiVersion)) {
    return next(CreateError.InvalidParameters('This API is not supported by the API version you are using.'));
  }
  const linkid = req.params.linkid.toLowerCase();
  const { operations } = getProviders(req);
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  if (operations.providers.queryCache && operations.providers.queryCache.supportsOrganizationMembership) {
    // faster implementation
    const links = (await operations.providers.linkProvider.getAll()).filter((lid) => lid['id'] === linkid);
    const link = links.length === 1 ? links[0] : null;
    if (!link) {
      return next(jsonError('Could not find the link', 404));
    }
    let entry = null;
    const thirdPartyId = link.thirdPartyId;
    try {
      entry = await getByThirdPartyId(
        thirdPartyId,
        req.apiVersion,
        operations,
        skipOrganizations,
        showTimestamps
      );
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        return next(CreateError.NotFound('Could not find the link'));
      } else {
        return next(CreateError.ServerError(error));
      }
    }
    req.insights.trackMetric({ name: 'ApiRequestLinkByLinkId', value: 1 });
    return res.json(entry) as unknown as void;
  }
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps, true);
  for (let i = 0; i < results.length; i++) {
    const entry = results[i];
    if (entry && entry.id === linkid) {
      req.insights.trackMetric({ name: 'ApiRequestLinkByLinkId', value: 1 });
      return res.json(entry) as unknown as void;
    }
  }
  return next(CreateError.NotFound('Could not find the link'));
});

router.get('/github/:username', async (req: ReposApiRequest, res: Response, next: NextFunction) => {
  if (unsupportedApiVersions.includes(req.apiVersion)) {
    return next(CreateError.InvalidParameters('This API is not supported by the API version you are using.'));
  }
  const username = req.params.username.toLowerCase();
  const { operations } = getProviders(req);
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  if (operations.providers.queryCache && operations.providers.queryCache.supportsOrganizationMembership) {
    // faster implementation
    let account = null;
    try {
      account = await operations.getAccountByUsername(username);
    } catch (getAccountError) {
      if (ErrorHelper.IsNotFound(account)) {
        return next(CreateError.NotFound('Could not find a link for the user'));
      }
      return next(CreateError.ServerError(getAccountError));
    }
    try {
      const entry = await getByThirdPartyId(
        String(account.id),
        req.apiVersion,
        operations,
        skipOrganizations,
        showTimestamps
      );
      req.insights.trackMetric({ name: 'ApiRequestLinkByGitHubUsername', value: 1 });
      return res.json(entry) as unknown as void;
    } catch (entryError) {
      return next(jsonError(entryError, ErrorHelper.GetStatus(entryError) || 500));
    }
  }
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps);
  for (let i = 0; i < results.length; i++) {
    const entry = results[i];
    if (entry && entry.github && entry.github.login.toLowerCase() === username) {
      req.insights.trackMetric({ name: 'ApiRequestLinkByGitHubUsername', value: 1 });
      return res.json(entry) as unknown as void;
    }
  }
  return next(CreateError.NotFound('Could not find a link for the user'));
});

router.get('/aad/userPrincipalName/:upn', async (req: ReposApiRequest, res: Response, next: NextFunction) => {
  const upn = req.params.upn;
  const { operations } = getProviders(req);
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  if (operations.providers.queryCache && operations.providers.queryCache.supportsOrganizationMembership) {
    // faster implementation
    const links = await operations.providers.linkProvider.queryByCorporateUsername(upn);
    const r = [];
    for (const link of links) {
      const thirdPartyId = link.thirdPartyId;
      try {
        const entry = await getByThirdPartyId(
          thirdPartyId,
          req.apiVersion,
          operations,
          skipOrganizations,
          showTimestamps
        );
        if (entry) {
          r.push(entry);
        }
      } catch (partialIgnoreError) {
        if (!ErrorHelper.IsNotFound(partialIgnoreError)) {
          console.dir(partialIgnoreError);
        }
      }
    }
    req.insights.trackEvent({
      name: 'ApiRequestLinkByAadUpnResult',
      properties: {
        length: r.length.toString(),
        userPrincipalName: upn,
      },
    });
    return res.json(r) as unknown as void;
  }
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps);
  const r = [];
  for (let i = 0; i < results.length; i++) {
    const entry = results[i];
    if (entry && entry.aad && entry.aad.userPrincipalName === upn) {
      r.push(entry);
    }
  }
  req.insights.trackEvent({
    name: 'ApiRequestLinkByAadUpnResult',
    properties: {
      length: r.length.toString(),
      userPrincipalName: upn,
    },
  });
  if (r.length === 0) {
    return next(CreateError.NotFound('Could not find a link for the user'));
  }
  req.insights.trackMetric({ name: 'ApiRequestLinkByAadUpn', value: 1 });
  return res.json(r) as unknown as void;
});

router.get(
  '/aad/mailNickname/:mailNickname',
  async (req: ReposApiRequest, res: Response, next: NextFunction) => {
    const nickname = req.params.mailNickname;
    const { graphProvider, operations } = getProviders(req);
    let id: string;
    try {
      id = await graphProvider.getUserIdByNickname(nickname);
      if (!id) {
        throw CreateError.NotFound(`No user found with the mail nickname ${nickname}`);
      }
    } catch (error) {
      return next(error);
    }
    const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
    const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
    if (!operations.providers.queryCache || !operations.providers.queryCache.supportsOrganizationMembership) {
      return next(CreateError.NotImplemented('This API requires a query cache'));
    }
    const links = await operations.providers.linkProvider.queryByCorporateId(id);
    const r = [];
    for (const link of links) {
      const thirdPartyId = link.thirdPartyId;
      try {
        const entry = await getByThirdPartyId(
          thirdPartyId,
          req.apiVersion,
          operations,
          skipOrganizations,
          showTimestamps
        );
        if (entry) {
          r.push(entry);
        }
      } catch (partialIgnoreError) {
        if (!ErrorHelper.IsNotFound(partialIgnoreError)) {
          console.dir(partialIgnoreError);
        }
      }
    }
    req.insights.trackEvent({
      name: 'ApiRequestLinkByAadMailNicknameResult',
      properties: {
        length: r.length.toString(),
      },
    });
    return res.json(r) as unknown as void;
  }
);

router.get('/aad/mail/:mail', async (req: ReposApiRequest, res: Response, next: NextFunction) => {
  const mail = req.params.mail;
  const { graphProvider, operations } = getProviders(req);
  let id: string;
  try {
    id = await graphProvider.getUserIdByMail(mail);
    if (!id) {
      throw CreateError.NotFound(`No user found with the mail ${mail}`);
    }
  } catch (error) {
    return next(error);
  }
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  if (!operations.providers.queryCache || !operations.providers.queryCache.supportsOrganizationMembership) {
    return next(CreateError.NotImplemented('This API requires a query cache'));
  }
  const links = await operations.providers.linkProvider.queryByCorporateId(id);
  const r = [];
  for (const link of links) {
    const thirdPartyId = link.thirdPartyId;
    try {
      const entry = await getByThirdPartyId(
        thirdPartyId,
        req.apiVersion,
        operations,
        skipOrganizations,
        showTimestamps
      );
      if (entry) {
        r.push(entry);
      }
    } catch (partialIgnoreError) {
      if (!ErrorHelper.IsNotFound(partialIgnoreError)) {
        console.dir(partialIgnoreError);
      }
    }
  }
  req.insights.trackEvent({
    name: 'ApiRequestLinkByAadMailResult',
    properties: {
      length: r.length.toString(),
    },
  });
  return res.json(r) as unknown as void;
});

router.get('/aad/:id', async (req: ReposApiRequest, res: Response, next: NextFunction) => {
  if (req.apiVersion == '2016-12-01') {
    return next(CreateError.InvalidParameters('This API is not supported by the API version you are using.'));
  }
  const id = req.params.id;
  const skipOrganizations = req.query.showOrganizations !== undefined && !!req.query.showOrganizations;
  const showTimestamps = req.query.showTimestamps !== undefined && req.query.showTimestamps === 'true';
  const { operations } = getProviders(req);
  if (operations.providers.queryCache && operations.providers.queryCache.supportsOrganizationMembership) {
    // faster implementation
    const links = await operations.providers.linkProvider.queryByCorporateId(id);
    const r = [];
    for (const link of links) {
      const thirdPartyId = link.thirdPartyId;
      try {
        const entry = await getByThirdPartyId(
          thirdPartyId,
          req.apiVersion,
          operations,
          skipOrganizations,
          showTimestamps
        );
        if (entry) {
          r.push(entry);
        }
      } catch (partialIgnoreError) {
        if (!ErrorHelper.IsNotFound(partialIgnoreError)) {
          console.dir(partialIgnoreError);
        }
      }
    }
    req.insights.trackMetric({ name: 'ApiRequestLinkByAadId', value: 1 });
    return res.json(r) as unknown as void;
  }
  const results = await getAllUsers(req.apiVersion, operations, skipOrganizations, showTimestamps);
  const r = [];
  for (let i = 0; i < results.length; i++) {
    const entry = results[i];
    if (entry && entry.aad && entry.aad.id === id) {
      r.push(entry);
    }
  }
  if (r.length === 0) {
    return next(jsonError('Could not find a link for the user', 404));
  }
  req.insights.trackMetric({ name: 'ApiRequestLinkByAadId', value: 1 });
  return res.json(r) as unknown as void;
});

async function getByThirdPartyId(
  thirdPartyId: string,
  apiVersion,
  operations: Operations,
  skipOrganizations: boolean,
  showTimestamps: boolean,
  showLinkIds?: boolean
): Promise<any> {
  const providers = operations.providers;
  let link: ICorporateLink = null;
  try {
    link = await providers.linkProvider.getByThirdPartyId(thirdPartyId);
  } catch (linksError) {
    if (ErrorHelper.IsNotFound(linksError)) {
      throw jsonError(`${thirdPartyId} is not linked`, 404);
    } else {
      linksError = wrapError(
        linksError,
        'There was a problem retrieving link information to display alongside the member.'
      );
      throw jsonError(linksError, 500);
    }
  }
  const account = operations.getAccount(thirdPartyId);
  await account.getDetails();
  let orgMembershipNames: string[] = [];
  if (providers.queryCache && operations.providers.queryCache.supportsOrganizationMembership) {
    orgMembershipNames = (await providers.queryCache.userOrganizations(thirdPartyId)).map(
      (org) => org.organization.name
    );
  } else {
    // TODO: not implemented for performance reasons now
    throw ErrorHelper.NotImplemented();
  }
  const isExpandedView = extendedLinkApiVersions.includes(apiVersion);
  const entry = {
    github: {
      id: Number(link.thirdPartyId),
      login: account.login,
      organizations: undefined,
    },
    isServiceAccount: undefined,
    serviceAccountContact: undefined,
  };
  if (isExpandedView) {
    entry.github['avatar'] = account.avatar_url;
  }
  if (showLinkIds && link) {
    entry['id'] = link['id']; // not part of the interface
  }
  if (!skipOrganizations) {
    entry.github.organizations = orgMembershipNames;
  }
  // '2017-09-01' added 'isServiceAccount'; so '2016-12-01' & '2017-03-08' do not have it
  if (showTimestamps && link && link['created']) {
    entry['timestamp'] = link['created'];
  }
  if (link && link.isServiceAccount === true && apiVersion !== '2016-12-01' && apiVersion !== '2017-03-08') {
    entry.isServiceAccount = true;
    if (isExpandedView && link.isServiceAccount && link.serviceAccountMail) {
      entry.serviceAccountContact = link.serviceAccountMail;
    }
  }
  if (
    link?.corporateAlias ||
    link?.corporateDisplayName ||
    link?.corporateMailAddress ||
    link?.corporateUsername
  ) {
    const corporatePropertyName = apiVersion === '2016-12-01' ? 'corporate' : 'aad'; // This was renamed to be provider name-based
    entry[corporatePropertyName] = {
      alias: link?.corporateAlias,
      preferredName: link?.corporateDisplayName,
      userPrincipalName: link?.corporateUsername,
      emailAddress: link?.corporateMailAddress,
    };
    const corporateIdPropertyName = apiVersion === '2016-12-01' ? 'aadId' : 'id'; // Now just 'id'
    entry[corporatePropertyName][corporateIdPropertyName] = link.corporateId;
  }
  return entry;
}

export default router;
