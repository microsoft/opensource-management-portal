//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = function addLinkToRequest(req, res, next) {
  if (req.link) {
    return next();
  }
  const user = req.legacyUserContext.modernUser();
  if (!user) {
    return res.redirect('/');
  }
  const link = user.link;
  if (!link) {
    return res.redirect('/');
  }
  req.link = link;
  return next();
};
