//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders } from '../../transitional';

import LoadCorporationSection from './corporation';

router.use('*', asyncHandler(async function (req: ReposAppRequest, res, next) {
  const { corporateAdministrationProfile } = req.app.settings.providers as IProviders;
  if (corporateAdministrationProfile && corporateAdministrationProfile.urls) {
    req.individualContext.setInitialViewProperty('_corpAdminUrls', corporateAdministrationProfile.urls);
  }
  return next();
}));

try {
  const profile = LoadCorporationSection();
  if (profile && profile.setupRoutes) {
    profile.setupRoutes(router);
  }
} catch (error) {
  console.dir(error);
}
router.use('/app', require('./app'));
router.use('/apps', require('./apps'));
router.use('/contributingorgs', require('./contributingorgs'));

router.get('/', (req: ReposAppRequest, res, next) => {
  const individualContext = req.individualContext;
  individualContext.webContext.render({
    view: 'administration',
    title: 'Administration',
    state: {
      // nothing
    },
  });
});

module.exports = router;
