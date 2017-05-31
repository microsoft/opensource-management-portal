//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const arrayFromString = require('./utils/arrayFromString');

// Resolves the organization configuration data; GITHUB_ORGANIZATIONS_FILE or GITHUB_ORGANIZATIONS_ENVIRONMENT_MODULE

// TODO: Support and implement GITHUB_ORGANIZATIONS_ENVIRONMENT_MODULE
// Thinking:
// With the present of GITHUB_ORGANIZATIONS_ENVIRONMENT_MODULE, will npm require + pass along either the
// environment or the GITHUB_ORGANIZATIONS_ENVIRONMENT variable to indicate what value to pass along

const organizationsFileVariableName = 'GITHUB_ORGANIZATIONS_FILE';

module.exports = (graphApi) => {
  const environmentProvider = graphApi.environment;
  const orgs = [];
  orgs.onboarding = [];

  const defaultLegalEntities = arrayFromString(environmentProvider.get('GITHUB_ORGANIZATIONS_DEFAULT_LEGAL_ENTITIES'));
  const defaultTemplates = arrayFromString(environmentProvider.get('GITHUB_ORGANIZATIONS_DEFAULT_TEMPLATES'));

  const organizationsFile = environmentProvider.get(organizationsFileVariableName);
  if (organizationsFile) {
    // This will resolve locally; in this we may want to be able to
    // discover through other mechanisms, too.
    const contents = require(`../data/${organizationsFile}`);
    contents.forEach((org) => {
      const isOnboarding = org.onboarding === true;
      if (!org.legalEntities && !org.cla) {
        org.legalEntities = defaultLegalEntities;
      }
      if (!org.templates) {
        org.templates = defaultTemplates;
      }
      (isOnboarding ? orgs.onboarding : orgs).push(org);
    });
  }

  if (!orgs.onboarding.length) {
    delete orgs.onboarding;
  }

  return orgs;
};
