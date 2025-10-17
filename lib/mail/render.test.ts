//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { describe, expect, it, test } from 'vitest';

import type NodeClient from 'applicationinsights/out/Library/NodeClient.js';

import { getTypeScriptAppDirectory } from '../../lib/appDirectory.js';
import { renderHtmlMail } from '../../lib/mail/render.js';
import { SiteConfiguration } from '../../config/index.types.js';

test('mail.render', async () => {
  const typescript = getTypeScriptAppDirectory();
  const config = {
    typescript,
  };
  const options = {
    hasAccountInformationSection: true,
    link: {
      thirdPartyUsername: 'test-username',
      corporateUsername: 'corporate-username',
    },
    repository: {
      name: 'test-repo',
      organization: {
        name: 'test-org',
      },
    },
    changeApplied: new Date(),
  };
  const rendered = await renderHtmlMail(
    /* insights can be null for no telemetry */ null as unknown as NodeClient,
    'test/template',
    options,
    config as SiteConfiguration,
    /* is test only */ true
  );
  expect(rendered).to.include(options.link.thirdPartyUsername);
  expect(rendered).to.include(options.link.corporateUsername);
  expect(rendered).to.include(options.repository.name);
  expect(rendered).to.include(options.repository.organization.name);
  expect(rendered).to.include(options.changeApplied.toISOString());
  expect(rendered).to.include('Hello world.');
});
