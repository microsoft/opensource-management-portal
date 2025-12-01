//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import debug from 'debug';
import path from 'path';
import fs from 'fs';

import createEnvironmentFileResolver from './environmentFileReader.js';
import typescriptConfig from './typescript.js';

const debugStartup = debug('startup');

const resolver = createEnvironmentFileResolver('news.js', 'news', 'CONFIGURATION_ENVIRONMENT', {
  before: async (/* graphApi */) => {
    // 2: try to load URL/resource links data from a local JSON file; used by the OSS project.
    try {
      const filename = path.join(typescriptConfig.appDirectory, 'data', 'news.json');
      const str = fs.readFileSync(filename, 'utf8');
      const resources = JSON.parse(str);
      debugStartup(`news loaded from file ${filename}`);
      return resources;
    } catch (notFound) {
      if (notFound.code !== 'ENOENT') {
        console.warn(notFound);
      }
    }
  },
  after: (graphApi, resources) => {
    const homepageCount = 10;
    const articles = Array.isArray(resources) ? resources : [];
    return {
      all: articles,
      homepage: articles.slice(0, homepageCount),
    };
  },
});

export default resolver;
