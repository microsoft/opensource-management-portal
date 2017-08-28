//
// Copyright (c) Microsoft. All rights reserved.
//

'use strict';

// Office uses a specialized pre-fetch to learn more about hyperlinks before
// opening. As a result, if the Office user agent is in use, and the
// request is not authenticated, we should still just respond with a simple
// HTTP 200 and message. Office technically creates a HEAD request. Once a
// successful response is found, it opens a web browser to the specific
// URL. This middleware performs these actions.

const GenericOfficeUserAgent = 'ms-office';
const WordUserAgent = 'Microsoft Office Word';

module.exports = function supportOfficeHyperlinks(req, res, next) {
  const userAgent = req.headers['user-agent'];
  const isAuthenticated = req.isAuthenticated ? req.isAuthenticated() : false;
  if (userAgent && userAgent.includes && !isAuthenticated && (userAgent.includes(GenericOfficeUserAgent) || userAgent.includes(WordUserAgent))) {
    const insights = req.insights || (req.app && req.app.settings && req.app.settings.providers ? req.app.settings.providers.insights : null);
    if (insights) {
      insights.trackEvent('InterceptOfficeHyperlinkRequest', {
        userAgent: userAgent,
        isAuthenticated: isAuthenticated,
        originalUrl: req.originalUrl,
        httpMethod: req.method,
        responseType: 200,
      });
    }
    return res.send(`When using Microsoft Office, you need to open the hyperlink in your browser to authenticate if needed ${req.originalUrl}`);
  }
  return next();
};
