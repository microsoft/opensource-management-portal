//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../../transitional';
const request = require('request');

import { jsonError } from '../../../middleware/jsonError';

const router = express.Router();

const releaseApprovalsRedisKey = 'release-approvals';

interface IReleaseApprovalRedisRequest extends ReposAppRequest {
  releaseApprovalsRedis?: any;
}

router.use((req: IReleaseApprovalRedisRequest, res, next) => {
  const providers = req.app.settings.providers;
  req.releaseApprovalsRedis = providers.witnessRedisHelper || providers.redis;
  return next();
});

router.get('/', (req: IReleaseApprovalRedisRequest, res, next) => {
  try {
    req.releaseApprovalsRedis.getObject(releaseApprovalsRedisKey, (error, data) => {
      if (!error && data) {
        return res.json({ releaseApprovals: data });
      } else { // cache miss
        const options = getWitnessRequestOptions(req.app.settings.runtimeConfig);
        request.get(options, (httpError, ignoredResponse, body) => {
          if (httpError) {
            return next(jsonError(new Error(httpError.message)));
          }
          if (body.message) {
            return next(jsonError(new Error(body.message)));
          }
          req.releaseApprovalsRedis.setObjectWithExpire(releaseApprovalsRedisKey, body, 60 * 24); // async caching
          return res.json({ releaseApprovals: body });
        });
      }
    });
  } catch (error) {
    return next(jsonError(error, 400));
  }
});

router.post('/', (req: IReleaseApprovalRedisRequest, res, next) => {
  try {
    const body = req.body;
    if (!body) {
      return next(jsonError('No body', 400));
    }
    const options = getWitnessRequestOptions(req.app.settings.runtimeConfig);
    const upn = req.user.azure.username.toLowerCase();
    const operations = req.app.settings.operations;
    operations.mailAddressProvider.getCorporateEntry('upns', upn, (redisGetError, person) => {
      if (!person) {
        redisGetError = new Error(`Given the user principal name of ${upn}, we were unable to find the e-mail address for the user`);
      }
      if (redisGetError) {
        return next(jsonError(new Error(redisGetError.message)));
      }
      options.body = {
        context: {
          user: person.alias
        },
        default: body
      };
      request.post(options, (httpError, ignoredResponse, body) => {
        req.app.settings.providers.insights.trackEvent({
          name: 'ApiClientCreateReleaseApproval',
          properties: {
            requestBody: JSON.stringify(options.body),
            responseBody: JSON.stringify(body),
          },
        });
        if (httpError) {
          return next(jsonError(new Error(httpError.message)));
        }
        if (!body) {
          return next(jsonError('No response', 400));
        }
        if (body.message) {
          return next(jsonError(new Error(body.message)));
        }
        const result = body.default[0].result;
        if (result.state === 'Failed') {
          return next(jsonError(new Error(result.issues ? result.issues[0] : 'Failed to create new release registration')));
        }
        const getOptions = getWitnessRequestOptions(req.app.settings.runtimeConfig);
        request.get(getOptions, (error, response, releases) => { // async caching
          if (!error && releases) {
            req.releaseApprovalsRedis.setObjectWithExpire(releaseApprovalsRedisKey, releases, 60 * 24);
          }
        });
        return res.json({
          releaseApprovals: [result.record]
        });
      });
    });
  } catch (error) {
    return next(jsonError(error, 400));
  }
});

function getWitnessRequestOptions(config) {
  const url = config.witness.approval.serviceUrl + '/releases';
  const authToken = 'Basic ' + Buffer.from(':' + config.witness.approval.authToken, 'utf8').toString('base64');
  const headers = {
    Authorization: authToken
  };
  return { url: url, headers: headers, json: true, body: undefined };
}

module.exports = router;
