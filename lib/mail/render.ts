//
// Copyright (c) Microsoft.
//

import path from 'path';
import pug from 'pug';
import { promises as fs } from 'fs';
import type NodeClient from 'applicationinsights/out/Library/NodeClient.js';

import { CreateError } from '../transitional.js';

import type { SiteConfiguration } from '../../config/index.types.js';

function renderHtmlMailAsync(basedir: string, viewName: string, options, config): Promise<string> {
  return new Promise((resolve, reject) => {
    return renderMailHtml(basedir, viewName, options, config, (error, html) => {
      return error ? reject(error) : resolve(html);
    });
  });
}

export async function renderHtmlMail(
  insights: NodeClient,
  emailViewName: string,
  contentOptions: any,
  config: SiteConfiguration,
  isTestOnly: boolean
): Promise<string> {
  if (isTestOnly) {
    insights = null;
  }
  const appDirectory = config?.typescript?.appDirectory;
  if (!appDirectory) {
    throw CreateError.InvalidParameters(
      'emailRender requires a config with a typescript.appDirectory to resolve the view templates folder'
    );
  }
  try {
    const html = await renderHtmlMailAsync(appDirectory, emailViewName, contentOptions, config);
    insights?.trackEvent({
      name: 'mail.render.success',
      properties: {
        view: emailViewName,
        contentLength: html.length,
      },
    });
    insights?.trackMetric({
      name: 'mail.render.successes',
      value: 1,
      properties: {
        view: emailViewName,
      },
    });
    return html;
  } catch (error) {
    insights?.trackException({
      exception: error,
      properties: {
        name: 'mail.render.error',
        view: emailViewName,
      },
    });
    insights?.trackMetric({
      name: 'mail.render.errors',
      value: 1,
      properties: {
        view: emailViewName,
      },
    });
    throw error;
  }
}

export async function getHtmlMailTemplate(config: SiteConfiguration, viewName: string) {
  const basedir = config?.typescript?.appDirectory;
  if (!basedir) {
    throw CreateError.InvalidParameters(
      'config with a typescript.appDirectory to resolve the view templates folder is required'
    );
  }
  try {
    const view = path.join(basedir, `views/email/${viewName}.pug`);
    const content = await fs.readFile(view, 'utf8');
    return content;
  } catch (error) {
    throw error;
  }
}

function renderMailHtml(basedir: string, viewName: string, options, config: SiteConfiguration, callback) {
  options = options || {};
  if (!viewName) {
    viewName = 'email';
  }
  if (!options.view) {
    options.view = viewName;
  }
  let html = null;
  try {
    const view = path.join(basedir, `views/email/${viewName}.pug`);
    options.pretty = true;
    options.basedir = basedir;
    options.config = config;
    html = pug.renderFile(view, options);
  } catch (renderError) {
    console.error(`renderMailHtml error: ${renderError}`);
    return callback(renderError);
  }
  return callback(null, html);
}
