//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = function initializeCampaigns(app) {
  // Use Application Insights to store simple anonymous information about campaigns
  // or events. Also fires off metrics to help understand how many campaign events
  // come through the app.
  app.use('*', campaignMiddleware);

  function campaignMiddleware(req, res, next) {
    process.nextTick(processCampaignTelemetry.bind(null, req));

    // Immediate return to keep middleware going
    return next();
  }

  function getCampaignTelemetry(req) {
    const source = req.query.utm_source;
    const campaign = req.query.utm_campaign;
    const medium = req.query.utm_medium;
    if (!source || !campaign || !medium) {
      return;
    }
    const content = req.query.utm_content;
    const data = {
      source: source,
      campaign: campaign,
      medium: medium,
    };
    if (content) {
      data.content = content;
    }
    return data;
  }

  function processCampaignTelemetry(req) {
    // Required campaign-related query parameters
    const data = getCampaignTelemetry(req);
    if (!data) {
      return;
    }

    const providers = req.app.settings.providers;
    const insights = providers.insights;
    if (!insights) {
      return;
    }

    insights.trackEvent('ReposCampaignInteraction', {
      source: data.source,
      campaign: data.campaign,
      medium: data.medium,
      content: data.content,
      path: req.path,
    });

    insights.trackMetric('ReposCampaignInteractions', 1);
  }

  function redirectGitHubMiddleware(req, res, next, getIdentity) {
    const goGithub = req.query.go_github;
    const goGithubQuery = req.query.go_github_query;
    const goGithubPrefix = req.query.go_github_prefix;
    if (goGithub === undefined) {
      return next();
    }

    const data = getCampaignTelemetry(req) || {};

    const sub = goGithub ? `/${goGithub}`  : '';
    const base = 'https://github.com/';

    let identity = null;
    try {
      identity = getIdentity(req);
    } catch (ex) {
      return next();
    }

    if (identity) {
      const prefixPortion = goGithubPrefix ? `${goGithubPrefix}/` : '';
      const queryPortion = goGithubQuery ? `?${goGithubQuery}` : '';
      const uri = `${base}${prefixPortion}${identity}${sub}${queryPortion}`;
      res.redirect(uri);

      const insights = req.app.settings.providers.insights;
      if (goGithubQuery) {
        data.query = goGithubQuery;
      }
      if (goGithubPrefix) {
        data.prefix = goGithubPrefix;
      }
      if (insights) {
        if (sub) {
          data.sub = sub;
        }
        data.uri = uri;
        data.path = req.path;
        insights.trackEvent('ReposCampaignGitHubRedirect', data);
        insights.trackMetric('ReposCampaignGitHubRedirects', 1);
      }
      return; // response already sent
    }

    return next();
  }

  return {
    redirectGitHubMiddleware: redirectGitHubMiddleware,
  };
};
