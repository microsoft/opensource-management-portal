//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import { ReposAppRequest } from '../transitional';
const router = express.Router();

router.get('/', function (req: ReposAppRequest, res) {
  req.reposContext = req.reposContext || {};
  req.reposContext.releaseTab = true;
  req.individualContext.webContext.render({
    view: './emberApp',
    title: 'Releases',
  });
});

module.exports = router;
