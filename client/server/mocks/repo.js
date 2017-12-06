/* eslint-env node */
module.exports = function(app) {
  var express = require('express');
  var repoRouter = express.Router();

  repoRouter.get('/repo/:name', (req, res) => {
    const name = req.params.name;
    setTimeout(() => {
      if (name === 'found') {
        return res.status(204).end();
      }
      if (name === 'unauthorized') {
        return res.status(401).end();
      }
      if (name === 'error') {
        return res.status(500).end();
      }
      return res.status(404).end();
    }, 200);
  });

  repoRouter.get('/metadata', (req, res) => {
    setTimeout(() => {
      return res.json({
        approval: {
          fields: {
            approvalTypes: ['New release registration','Existing release review','Exemption: small libraries, tools, and samples','Migrate project from CodePlex','Exemption: other'],
            approvalTypesToIds: {
              'New release registration': 'NewReleaseReview',
              'Existing release review': 'ExistingReleaseReview',
              'Exemption: small libraries, tools, and samples': 'SmallLibrariesToolsSamples',
              'Migrate project from CodePlex': 'Migrate',
              'Exemption: other': 'Exempt'
            },
            approvalUrlRequired: ['New release registration', 'Existing release review'],
            exemptionDetailsRequired: ['Exemption: other']
          }
        },
        legalEntities: ['Microsoft', '.NET Foundation'],
        gitIgnore: {
          default: 'VisualStudio',
          languages: ['Actionscript','Ada','Agda','Android','AppEngine','AppceleratorTitanium','ArchLinuxPackages','Autotools','C','CFWheels','CMake','CUDA','CakePHP','ChefCookbook','Clojure','CodeIgniter','CommonLisp','Composer','Coq','CraftCMS','D','DM','Dart','Delphi','Drupal','EPiServer','Eagle','Elisp','Elixir','Elm','Erlang','ExpressionEngine','ExtJs','Fancy','Finale','ForceDotCom','Fortran','FuelPHP','GWT','Gcov','GitBook','Go','Gradle','Grails','Haskell','IGORPro','Idris','Java','Jboss','Jekyll','Joomla','Julia','KiCad','Kohana','LabVIEW','Laravel','Leiningen','LemonStand','Lilypond','Lithium','Lua','Magento','Maven','Mercury','MetaProgrammingSystem','Nanoc','Nim','Node','OCaml','Opa','OpenCart','OracleForms','Packer','Perl','Phalcon','PlayFramework','Plone','Prestashop','Processing','Python','Qooxdoo','Qt','R','ROS','Rails','RhodesRhomobile','Ruby','Rust','SCons','Sass','Scala','Scheme','Scrivener','Sdcc','SeamGen','SketchUp','Smalltalk','Stella','SugarCRM','Swift','Symfony','SymphonyCMS','TeX','Terraform','Textpattern','Umbraco','Unity','UnrealEngine','VVVV','VisualStudio','Waf','WordPress','Xojo','Yeoman','Yii','ZendFramework','Zephir'],
        },
        supportsCla: true,
        templates: [
          { id: 'mit', spdx: 'mit', name: 'MIT', recommended: true, legalEntities: ['Microsoft'] }, { id: 'microsoft.docs', name: 'MIT and Creative Commons Attribution 4.0', description: 'Official microsoft.docs repo', spdx: '(mit and cc-by-4.0)', legalEntities: ['Microsoft'] }, { id: 'dnfmit', spdx: 'mit', name: 'MIT', legalEntities: ['.NET Foundation'] }, { id: 'dnfmit.docs', name: 'MIT and Creative Commons Attribution 4.0', description: 'Docs repo', spdx: '(mit and cc-by-4.0)', legalEntities: ['.NET Foundation'] }, { id: 'other', name: 'Other', legalEntities: ['Microsoft', '.NET Foundation'] }
        ],
        visibilities: ['private', 'public']
      });
    }, 200);
  });

  repoRouter.get('/personalizedTeams', (req, res) => {
    setTimeout(() => {
      return res.json({
        personalizedTeams: [
          { name: 'Everyone', id: 864314, description: 'FTE\'s, interns, vendors and contractors in the Microsoft Organization on GitHub', role: 'member', broad: true },
          { name: 'Open Source JIT Operations', id: 2127874, description: 'Special team for use by open source operations only. Providers specialized sudoer access in some environments.', role: 'member' },
          { name: 'ospo', id: 1825629, description: 'Open Source Programs Office', role: 'member' },
          { name: 'ospo-protected', id: 2062349, description: 'This team is used by the Open Source Programs Office to provide additional granularity in protecting branches and other specific resources related to Open Source management.', role: 'maintainer' },
          { name: 'ospo-testing', id: 2152502, description: 'Testing group for OSPO', role: 'maintainer' },
          { name: 'azure-members', id: 736397, description: 'All Microsoft employees, v- and a- who are members of the Azure organization. Best for very broad, automatic read access.', role: 'maintainer' },
          { name: 'azure-repo-approvers', id: 1730714, description: 'Special team containing the group of subject matter experts responsible for approving new repo names and requests.', role: 'maintainer' },
          { name: 'azureopensource-portal-write', id: 1410057, description: 'For managing the production Azure Open Source Portal. Restricted to compliance use, please use azureopensource-portal-read for general access.', role: 'maintainer' },
          { name: 'ospo-testing', id: 2171591, description: '', role: 'maintainer' },
          { name: 'Sudoers', id: 1799403, description: 'Microsoft Azure GitHub administrators with sudoer privs.', role: 'maintainer' },
          { name: 'azure-samples-members', id: 1564961, description: 'All Microsoft employees who are members of Azure-Samples and onboarded with our open source portal.', role: 'member' },
          { name: 'Owner', id: 197531, description: null, role: 'maintainer' },
          { name: 'Everyone', id: 2141704, description: 'Microsoft FTEs, vendors and contractors who have a linked social coding account.', role: 'member', broad: true },
          { name: 'Sudoers', id: 2141706, description: 'People who have administrative rights in the management portals for this org.', role: 'maintainer' }
        ]
      });
    }, 200);
  });

  repoRouter.get('/teams', (req, res) => {
    setTimeout(() => {
      return res.json({
        teams:
          [{ id: 1599293, name: '3-in-1-dock' + Math.random(), description: '' }, { id: 1966772, name: '3D Scanning Station', description: '3D Scanning Station (Turntable) Project' }, { id: 2035588, name: '3D Scanning Station Admins', description: null }, { id: 2035584, name: '3D Scanning Station Contributors', description: null }, { id: 1875287, name: 'AAD Graph API Docs', description: 'Content authors and support for AAD Graph API documentation' }, { id: 2009194, name: 'AADConnectConfigDocumenter Admin Team', description: 'AADConnectConfigDocumenter Admin Team' }, { id: 864314, name: 'Everyone', description: 'FTE\'s, interns, vendors and contractors in the Microsoft Organization on GitHub', broad: true }, { id: 2008809, name: 'AADConnectConfigDocumenter Admins', description: 'Admins of the AADConnectConfigDocumenter tool' }, { id: 1875292, name: 'AadGraphApiDocAdmin', description: 'Admins for AAD Graph API Doc repo' }, { id: 1877270, name: 'AADGraphAPIDocWriters', description: 'Write permissions to aad-graph-api-docs-pr.' }, { id: 1372805, name: 'AccCheckerExtensionForVS', description: 'Write access team' }, { id: 1918574, name: 'Ace', description: null }, { id: 2280166, name: 'acrolinx-service-accounts', description: 'Team for Acrolinx service accounts for APEX content' }, { id: 2076843, name: 'ActTeam', description: 'DEP/Dart/Act' }, { id: 1926664, name: 'ADALRef Admin', description: null }, { id: 1926618, name: 'ADALRef Owner', description: null }, { id: 1926667, name: 'ADALRef Read', description: null }, { id: 1926668, name: 'ADALRef Write', description: null }, { id: 2202324, name: 'Adaptive Card Admins', description: '' }, { id: 2324424, name: 'Adaptive V-Team', description: '' }, { id: 1932493, name: 'Admins', description: null }, { id: 1984790, name: 'AdventureWorksSkiAppDemoTeam', description: 'Adventure Works Demo Admin Team' }, { id: 1975798, name: 'AdventureWorksSkiAppTeam_old', description: 'AdventureWorksSkiAppTeam' }, { id: 2333260, name: 'AI-Immersion-Workshop', description: 'Workshop creators for the AI Immersion Workshop' }, { id: 1215339, name: 'AI-Readers', description: 'People with read access to unreleased AI repos' }, { id: 2352572, name: 'AIMarketingTeam', description: 'AI Marketing Team' }, { id: 2269994, name: 'air-admin', description: 'Microsoft Research Aerial Informatics and Robotics Core Team' }, { id: 2065951, name: 'ALM Search', description: 'We ship Code Search and other entity Search for both Team Services and TFS' }, { id: 2071692, name: 'ALMSearch', description: null }, { id: 2094552, name: 'Analog OSS Admins', description: 'The group of people who should have admin access to all repos that the Analog team manages.' }, { id: 2194584, name: 'Analysis Services', description: 'Open source contributors for Analysis Services code samples and community tools' }, { id: 1865861, name: 'angara', description: 'Microsoft Research Cambridge Angara project' }, { id: 2344851, name: 'angara-admin', description: 'Administration permissions to Angara-related repos' }, { id: 2051558, name: 'ANGLE', description: '' }, { id: 1770082, name: 'AnyCode', description: null }, { id: 2290344, name: 'apex-devops', description: 'The combined efforts  of the Automation Infrastructure and Lab teams for APEX' }, { id: 2177973, name: 'apex-docs-pr-reviewers', description: 'Pull request reviewer team for APEX-sponsored tech doc sets. This is for PR reviewers only.' }, { id: 2302529, name: 'apex-prmerger-service-accounts', description: 'Account for the APEX PRmerger automation accounts' }, { id: 2303743, name: 'APEX-production', description: 'APEX Global Production team' }, { id: 2303157, name: 'APEX-Test-Admin', description: 'Admin Permission Group of APEX Test ' }, { id: 2303147, name: 'APEX-Test-Read', description: 'Read Permission Group of APEX Test Team' }, { id: 2303156, name: 'APEX-Test-Write', description: 'Write Permission Group of APEX Test Team' }, { id: 2082781, name: 'API Versioning Admins', description: null }, { id: 2082567, name: 'API Versioning Contributors', description: 'Contributors for the ASP.NET web service API versioning project' }, { id: 2104014, name: 'APIGuidelinesPushers', description: 'Folks that can push to the API Guidelines repo taking advantage of branches we want pushed directly to for new features.' }, { id: 1992978, name: 'App Foundation', description: 'App Foundation team' }, { id: 1992999, name: 'App Foundation Admin', description: 'App Foundation team w/ Admin access' }, { id: 2040238, name: 'App Service', description: '' }, { id: 2072487, name: 'AppDevXboxTeam', description: null }, { id: 2357497, name: 'AppGwModSec', description: 'ModSec contributors in AppGw team.' }, { id: 2316877, name: 'AppInstaller', description: 'The Universal Windows Platform App Deployment Team' }, { id: 1918561, name: 'Application Insights API', description: 'We create the REST API for Application Insights.' }, { id: 937397, name: 'ApplicationInsights', description: 'FTE\'s in the AI team with write access' }, { id: 1301094, name: 'ApplicationInsights-Admins', description: 'team with admin access' }, { id: 1451466, name: 'ApplicationInsights-CI', description: 'CI team for Application Insights. Admin access' }, { id: 2147268, name: 'applicationinsights-devtools', description: 'Members of the developer tools team.' }, { id: 2325634, name: 'ApplicationInsights-Diagnostics', description: 'Diagnostic extensions around application insights' }, { id: 1429379, name: 'ApplicationInsights-friends', description: 'Write access team' }, { id: 1852488, name: 'ApplicationInsights-server-cpp-contributors', description: null }, { id: 1852481, name: 'ApplicationInsights-server-cpp-owners', description: null }, { id: 1848783, name: 'ApplicationInsights-server-cpp-readers', description: 'Owners of Application Insights server cpp repository' }, { id: 2290231, name: 'Art and Design Tools', description: 'Scripts, Plugins and Tools for Artists, Designer and Pipeline Engineers' }, { id: 2187050, name: 'ASELinux-admins', description: 'Can administer ASELinux repos' }, { id: 2187054, name: 'ASELinux-devs', description: 'Can commit code to ASELinux repos' }, { id: 1911240, name: 'ATADocs Admin', description: 'Admin team for the ATA doc repo in OPS' }, { id: 1911236, name: 'ATADocs Owners', description: 'Owners for the ATA docs repo for OPS' }, { id: 1911260, name: 'ATADocs Read', description: 'Read access to the ATA doc repo in OPS' }, { id: 1911242, name: 'ATADocs Write', description: 'Writer perms for the ATA repo in OPS.' }, { id: 2173865, name: 'ATADocsPublic-Write', description: '' }, { id: 1992602, name: 'ATG', description: 'Advanced Technology Group provides breakthough technologies and support for gaming with Microsoft' }, { id: 1740155, name: 'autobahn-admin', description: 'Admin group for Autobahn repo' }, { id: 1317654, name: 'automatic-graph-layout', description: 'team with write access' }, { id: 1317655, name: 'automatic-graph-layout-admin', description: 'team with admin access' }, { id: 2074155, name: 'AVC-Cloud', description: null }, { id: 2284901, name: 'AzLinux', description: 'Azure Compute Linux team' }, { id: 2365471, name: 'azopsguide-team', description: 'Microsoft Azure Operation Managment Team' }, { id: 2023006, name: 'AZRDAV-CSS', description: 'CSS AZRDAV' }, { id: 1885693, name: 'azure', description: 'All things open source running on Azure' }, { id: 2322838, name: 'Azure AD B2C Editors', description: 'Azure AD B2C' }, { id: 2080566, name: 'Azure automation', description: 'AzureAutomation-devs' }, { id: 2080652, name: 'Azure automation devs', description: 'Azure automation devs' }, { id: 2339483, name: 'Azure Datalake Tools for vscode', description: 'Azure Datalake Tools for vscode' }, { id: 2185099, name: 'Azure Gov Docs Contributors', description: '' }, { id: 2335934, name: 'Azure in CSP', description: 'Azure in CSP Technical Documentation V-Team' }, { id: 2133169, name: 'Azure Media Analytics', description: null }, { id: 2030716, name: 'Azure Notebooks Team', description: 'Azure Notebooks team' }, { id: 2092694, name: 'Azure Onboarding Core Team', description: '' }, { id: 2344436, name: 'Azure, Linux, OSS', description: 'Linux and Open Source on Azure' }, { id: 1363780, name: 'Azure-DDP', description: 'Write Team for Azure-DDP' }, { id: 2252823, name: 'azure-functions', description: '' }, { id: 1375900, name: 'Azure-PaaS-ChefClient', description: 'Team with write access' }, { id: 1911267, name: 'Azure-RMSDocs Admin', description: 'Admin perms for Azure RMS content repo in OPS' }, { id: 1911258, name: 'Azure-RMSDocs Owners', description: 'Owners team for Azure RMS content repo in OPS' }, { id: 1911272, name: 'Azure-RMSDocs Read', description: 'Read access to the AzureRMS content repo in OPS' }, { id: 1911270, name: 'Azure-RMSDocs Write', description: 'Writer perms for the Azure RMS content repo in OPS' }, { id: 1755722, name: 'azure-shortcuts-for-java', description: 'Team working on the azure-shortcuts-for-java project' }, { id: 1872776, name: 'azure-shortcuts-for-java-pull', description: 'Members with pull-request access to the azure-shortcuts-for-java repo.' }, { id: 2383720, name: 'azure-spring-boot-starters-admin', description: 'admin of the team that work on spring initializer for Azure services' }, { id: 2383722, name: 'azure-spring-boot-starters-write', description: 'team working on spring initializer for Azure services' }, { id: 2069925, name: 'azure-tools-for-java-admin', description: 'Admin team' }, { id: 1961146, name: 'azure-tools-for-java-commit', description: 'Team working on Azure tools for Java - Azure Toolkit for IntelliJ, Azure Toolkit for Eclipse and related' }, { id: 2052036, name: 'azure-tools-for-java-pull', description: 'pull access to azure-tools-for-java-pr repo' }, { id: 2051869, name: 'AzureBotAdmins', description: null }, { id: 2339087, name: 'azurechinavalidation', description: 'Validate and advise on Azure service landing and customer adoption in China Azure.' }, { id: 2372787, name: 'AzureDeveloperContent', description: 'Azure Developer content' }, { id: 2201217, name: 'azureiotadmin', description: '' }, { id: 2206244, name: 'AzureKeyVault', description: 'Azure Key Vault Engineering Team' }, { id: 2206247, name: 'AzureKeyVaultAdmin', description: 'Azure Key Vault Engineering Team Admin' }, { id: 2173858, name: 'AzureRMSDocsPublic-Write', description: '' }, { id: 2088297, name: 'AzureSMRAdmin', description: 'Azure SMR Core Team' }, { id: 2007876, name: 'Ballard', description: null }, { id: 2059154, name: 'Ballard Contributors', description: 'GitHub group for teams/developers interested in contributing to guidance on sharing components across multiple tools (aka the \'Ballard\' project).' }, { id: 2057926, name: 'Ballard Early Adopters', description: 'GitHub group for partner teams/developers interested in early access to guidance for sharing components across multiple tools (aka the \'Ballard\' project).' }, { id: 2007917, name: 'Ballard v-Team', description: null }, { id: 2309690, name: 'BaselineManagement-Admin', description: 'BaselineManagement project administrators' }, { id: 1445393, name: 'bench-view-admin', description: 'Admin team' }, { id: 1824950, name: 'bgashler1-team', description: null }, { id: 2115345, name: 'BigdataXPlatform', description: 'The cross platform tool for Microsoft Bigdata services.' }, { id: 1861592, name: 'BigPark', description: null }, { id: 2201125, name: 'BikeSharing360', description: 'BikeSharing360 Connect(); 2016 keynote demo team' }, { id: 1891562, name: 'Bing', description: 'Open source software released by Bing employees' }, { id: 1968011, name: 'Bing Ads', description: 'Bing Ads developers' }, { id: 2066455, name: 'Bing IEC team', description: 'Bing IEC team' }, { id: 2082088, name: 'Bing Maps CAT', description: 'This is the Bing Maps Customer Advisory Team.' }, { id: 2082089, name: 'Bing Maps V8', description: 'This is the Bing Maps V8 web control dev team.' }, { id: 2144502, name: 'Bing.com', description: 'Bing.com Team @ Microsoft' }, { id: 1836423, name: 'BingAds', description: 'The ads app team.' }, { id: 2166622, name: 'bingcairo', description: '' }]
      });
    }, 200);
  });

  repoRouter.post('/repo/:name', (req, res) => {
    const name = req.params.name;
    console.log('POST body:', req.body);
    setTimeout(() => {
      if (name === 'error2') {
        return res.status(500).json({ message: 'Something bad happened while creating a new repo!' });
      }
      if (name === 'error3') {
        return res.status(500).end();
      }
      if (name === 'approve') {
        return res.status(201).json({
          url: 'https://github.com/Microsoft/the-repo-name-github-requested',
          title: 'Your request has been submitted',
          message: 'This repo has been flagged for manual review. Someone will review it shortly. Sorries!'
        });
      }
      return res.json({
        url: 'https://github.com/Microsoft/the-repo-name-github-created',
        title: 'Repository created',
        message: 'Your new repo, some-name, has been created:',
        results: [
          {
            message: 'This is a message'
          },
          {
            error: true,
            message: 'The CLA could not be hooked up. That sucks.'
          }
        ]
      });
    }, 200);
  });

  app.use('/api/client/newRepo/org/ContosoDev', require('body-parser').json());
  app.use('/api/client/newRepo/org/ContosoDev', repoRouter);
};
