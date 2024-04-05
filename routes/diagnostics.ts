//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Request, Router } from 'express';
import asyncHandler from 'express-async-handler';
const router: Router = Router();

import { IAppSession, ReposAppRequest } from '../interfaces';
import { CreateError, getProviders } from '../lib/transitional';

const redacted = '*****';

interface IRequestWithSession extends Request {
  app: any;
  session: IAppSession;
  user: any;
}

interface ISafeUserView {
  cookies: any;
  sessionId: any;
  sessionIndex: any;
  user: any;
  websiteHostname?: any;
}

router.get('/', (req: IRequestWithSession, res) => {
  const { config } = getProviders(req as any as ReposAppRequest);
  const sessionPrefix =
    req['sessionStore'] && (req['sessionStore'] as any).prefix
      ? (req['sessionStore'] as any).prefix + ':'
      : null;
  const sessionIndex = sessionPrefix ? `${sessionPrefix}${req.session.id}` : req.session.id;
  const safeUserView: ISafeUserView = {
    cookies: req.cookies,
    sessionId: req.session.id,
    sessionIndex,
    user: {},
  };
  if (req.user && req.user.github) {
    const github = {};
    for (const key in req.user.github) {
      let val = req.user.github[key];
      if (key === 'accessToken') {
        val = redacted;
      }
      github[key] = val;
    }
    safeUserView.user.github = github;
  }
  if (
    (req.user && req.user.githubIncreasedScope) ||
    (req.user && req.user.github && req.user.github['scope'] === 'githubapp')
  ) {
    const githubIncreasedScope = {};
    const source =
      req.user.github && req.user.github['scope'] === 'githubapp'
        ? req.user.github
        : req.user.githubIncreasedScope;
    for (const key in source) {
      let val = source[key];
      if (key === 'accessToken') {
        val = redacted;
      }
      githubIncreasedScope[key] = val;
    }
    safeUserView.user.githubIncreasedScope = githubIncreasedScope;
  }
  if (req.user && req.user.azure) {
    const azure = {};
    for (const key in req.user.azure) {
      let val = req.user.azure[key];
      if (key === 'accessToken' || key === 'oauthToken') {
        val = redacted;
      }
      azure[key] = val;
    }
    safeUserView.user.azure = azure;
  }
  for (const key in req.session) {
    if (typeof req.session[key] !== 'object') {
      safeUserView[key] = req.session[key];
    }
  }
  safeUserView.websiteHostname = process.env.WEBSITE_HOSTNAME;
  return res.render('message', {
    message: 'My information',
    messageTiny: 'This information might be useful in helping diagnose issues.',
    messageOutput: JSON.stringify(safeUserView, undefined, 2),
    user: req.user,
    config: config,
    corporateLinks: config.corporate.trainingResources['public-homepage'],
    serviceBanner: config && config.serviceMessage ? config.serviceMessage.banner : undefined,
    title: 'Open Source Portal for GitHub - ' + config.brand.companyName,
  });
});

router.get(
  '/advanced',
  asyncHandler(async (req: ReposAppRequest, res, next) => {
    if (req.user?.azure?.oid !== 'b9f9877e-1cae-445e-bc28-3c943078c8e7') {
      return next(CreateError.NotAuthorized('You are not authorized to view this page.'));
    }
    const obj: any = Object.assign({}, process.env);
    return res.json(obj) as unknown as void;
  })
);

export default router;
