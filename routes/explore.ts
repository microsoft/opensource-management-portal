//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { ReposAppRequest } from '../interfaces/index.js';
import { getProviders } from '../lib/transitional.js';

router.get('/', (req: ReposAppRequest, res) => {
  const config = getProviders(req).config;
  res.render('explore', {
    config: config.obfuscatedConfig,
    title: 'Explore',
    site: 'explore',
  });
});

router.get('/registration', (req: ReposAppRequest, res) => {
  const config = getProviders(req).config;
  res.render('explore', {
    config: config.obfuscatedConfig,
    title: 'Witness',
    site: 'registration',
  });
});

router.get('/contribute', (req: ReposAppRequest, res) => {
  const config = getProviders(req).config;
  res.render('explore', {
    config: config.obfuscatedConfig,
    title: 'Contribute',
    site: 'contribute',
  });
});

router.get('/data', (req: ReposAppRequest, res) => {
  const config = getProviders(req).config;
  res.render('explore', {
    config: config.obfuscatedConfig,
    title: 'Data',
    site: 'data',
  });
});

export default router;
