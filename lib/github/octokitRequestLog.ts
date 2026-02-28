// MIT License Copyright (c) 2020 Octokit contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice (including the next paragraph) shall be included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// From: https://github.com/octokit/plugin-request-log.js/blob/main/src/index.ts (2024-10-30, ab4932c)

import { RequestError } from '@octokit/request-error';
import type { Octokit } from '@octokit/rest';

// This file is patched so that 304's do not output to the default console as errors.
// Also ignores a few specific 404's.

export function requestLog(octokit: Octokit) {
  octokit.hook.wrap('request', (request, options) => {
    octokit.log.debug('request', options);

    const start = Date.now();
    const requestOptions = octokit.request.endpoint.parse(options);
    const path = requestOptions.url.replace(options.baseUrl, '');

    return (request as typeof octokit.request)(options)
      .then((response) => {
        const requestId = response.headers['x-github-request-id'];
        octokit.log.info(
          `${requestOptions.method} ${path} - ${response.status} with id ${requestId} in ${
            Date.now() - start
          }ms`
        );
        return response;
      })

      .catch((error) => {
        let requestId = error.response?.headers['x-github-request-id'] || 'UNKNOWN';
        const asOctokitError = error as RequestError;
        if (
          requestId === 'UNKNOWN' &&
          asOctokitError?.response?.data &&
          typeof asOctokitError.response.data === 'string' &&
          asOctokitError.response.data.includes('<!DOCTYPE html>') &&
          asOctokitError.response.data.includes('Unicorn!')
        ) {
          requestId += ' + HTML UNICORN';
        }
        let logAsInfo = false;
        if (error?.status === 304) {
          logAsInfo = true;
        } else if (
          (path?.includes('/memberships/') ||
            path?.includes('/repositories/') ||
            path?.endsWith('/oidc/customization/sub')) &&
          error.status === 404
        ) {
          // Ignore 404's for memberships
          logAsInfo = true;
        } else if (path?.includes('/cost-centers/') && error.status === 403) {
          // Ignore 403's for cost centers which are when users are not in the enterprise during assignment (more 404-like)
          logAsInfo = true;
        }
        if (logAsInfo) {
          octokit.log.info(
            `${requestOptions.method} ${path} - ${error.status} with id ${requestId} in ${
              Date.now() - start
            }ms`
          );
        } else {
          octokit.log.error(
            `${requestOptions.method} ${path} - ${error.status} with id ${requestId} in ${
              Date.now() - start
            }ms`
          );
        }
        throw error;
      });
  });
}

// requestLog.VERSION = VERSION;
