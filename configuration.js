//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var utils = require('./utils');

module.exports = function translateEnvironmentToConfiguration(env) {
    if (!env) {
        env = process.env;
    }
    var i = 0;
    var pkgInfo = require('./package.json');
    var config = {
        logging: {
            errors: env.SITE_SKIP_ERRORS === undefined,
            version: pkgInfo.version,
        },
        companyName: env.COMPANY_NAME,
        serviceBanner: env.SITE_SERVICE_BANNER,
        corporate: {
            userProfilePrefix: env.CORPORATE_PROFILE_PREFIX,
            trainingResources: require('./resources.json'),
            portalAdministratorEmail: env.PORTAL_ADMIN_EMAIL,
        },
        // Friends are GitHub username(s) which have special
        // access for application use such as CLA tooling and
        // compliance/audit accounts. Supports comma-sep lists.
        friends: {
            cla: utils.arrayFromString(env.FRIENDS_CLA),
            employeeData: utils.arrayFromString(env.FRIENDS_DATA),
        },
        // GitHub application properties and secrets
        github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
            callbackUrl: env.GITHUB_CALLBACK_URL,
        },
        organizations: [],
        onboarding: [],
        // A salt needs to be provided to secure sessions and cookies.
        express: {
            sessionSalt: env.SESSION_SALT
        },
        // The app uses authentication with Azure Active Directory to grant access 
        // to the GitHub organization.
        activeDirectory: {
            clientId: env.AAD_CLIENT_ID,
            clientSecret: env.AAD_CLIENT_SECRET,
            tenantId: env.AAD_TENANT_ID,
            redirectUrl: env.AAD_REDIRECT_URL,
            allowTenantGuests: (env.AAD_ALLOW_TENANT_GUESTS && env.AAD_ALLOW_TENANT_GUESTS == 'allow') 
        },
        // AppInsights is a Microsoft Cloud product for gathering analytics and 
        // other useful information about apps. This app uses the Node.js npm 
        // module for app insights to gather information on server generation 
        // times, while the client JavaScript wrapper for AppInsights is also 
        // used for monitoring client browser attributes and information. If the 
        // key is not supplied, the app continues functioning.
        applicationInsights: {
            instrumentationKey: env.APPINSIGHTS_INSTRUMENTATION_KEY
        },
        // An Azure storage account is used as all data is stored in a 
        // geo-replicated storage account in table store. This is simple 
        // model vs a SQL Database instance, but requires doing joins 
        // on the server.
        azureStorage: {
            account: env.XSTORE_ACCOUNT,
            key: env.XSTORE_KEY,
            prefix: env.XSTORE_PREFIX
        },
        // Redis is used for shared session state across running site instances. 
        // The Azure Redis offering includes a redundant option, but as the 
        // session store is designed like a cache, the only outcome of lost 
        // Redis data is that the user will need to sign in again.
        redis: {
            port: env.REDIS_PORT,
            host: env.REDIS_HOST,
            key: env.REDIS_KEY,
            ttl: env.REDIS_TTL || (60 * 60 * 24 * 7 /* one week */),
            prefix: env.REDIS_PREFIX,
        },
    };
    for (i = 1; env['GITHUB_ORG' + i + '_NAME']; i++) {
        var prefix = 'GITHUB_ORG' + i + '_';
        var onboarding = env[prefix + 'ONBOARDING'];
        var org = {
            name: env[prefix + 'NAME'],
            type: env[prefix + 'TYPE'] || 'public',
            ownerToken: env[prefix + 'TOKEN'],
            notificationRepo: env[prefix + 'NOTIFICATION_REPO'],
            teamAllMembers: env[prefix + 'EVERYONE_TEAMID'],
            teamRepoApprovers: env[prefix + 'REPO_APPROVERS_TEAMID'],
            hookSecrets: utils.arrayFromString(env[prefix + 'HOOK_TOKENS']),
            teamAllRepos: env[prefix + 'SECURITY_TEAMID'],
            teamAllRepoWriteId: env[prefix + 'ALLREPOWRITE_TEAMID'],
            teamSudoers: env[prefix + 'SUDOERS_TEAMID'],
            description: env[prefix + 'DESCRIPTION'],
            priority: env[prefix + 'PRIORITY'] || 'primary',
            highlightedTeams: [],
        };
        if (i == 1) {
            org.teamPortalSudoers = env[prefix + 'PORTAL_SUDOERS_TEAMID'] || env[prefix + 'SUDOERS_TEAMID'];
        }
        var highlightIds = utils.arrayFromString(env[prefix + 'HIGHLIGHTED_TEAMS']);
        var highlightText = utils.arrayFromString(env[prefix + 'HIGHLIGHTED_TEAMS_INFO'], ';');
        if (highlightIds.length === highlightText.length) {
            for (var j = 0; j < highlightIds.length; j++) {
                org.highlightedTeams.push({
                    id: highlightIds[j],
                    description: highlightText[j],
                });
            }
        } else {
            throw new Error('Invalid matching of size for highlighted teams.');
        }
        (onboarding ? config.onboarding : config.organizations).push(org);
    }
    return config;
};
