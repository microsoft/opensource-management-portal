import { test } from 'qunit';
import moduleForAcceptance from 'client/tests/helpers/module-for-acceptance';
import FakeServer, { stubRequest } from 'ember-cli-fake-server';

moduleForAcceptance('Acceptance | new repo', {
  beforeEach() {
    FakeServer.start();
  },
  afterEach() {
    FakeServer.stop();
  }
});

test('visiting /', (assert) => {
  visit('/');

  andThen(() => {
    assert.equal(currentRouteName(), 'new-repo.index');
    assert.equal(currentURL(), '/new-repo');
    assert.equal(find('h2#title').text(), 'Release registration');
  });
});

test('skip registration if migrating project from CodePlex', (assert) => {
  stubAllRequests();
  visit('/');
  click('label.ember-radio-button:eq(2)'); // CodePlex
  click('button');

  andThen(() => {
    assert.equal(currentRouteName(), 'new-repo.basics');
    assert.equal(currentURL(), '/new-repo/basics');
    assert.equal(find('h2').text(), 'GitHub basics');
  });
});

test('policy review acceptance', (assert) => {
  stubAllRequests();
  visit('/');
  click('label.ember-radio-button:eq(0)'); // New release
  click('button');
  click('#public-open-source label.ember-radio-button:eq(1)');  // No
  click('#exemption-justification label.ember-radio-button:eq(2)'); // Hackathon
  click('label[for=policyCheckbox]');
  click('button');

  andThen(() => {
    assert.equal(currentRouteName(), 'new-repo.basics');
    assert.equal(currentURL(), '/new-repo/basics');
    assert.equal(find('h2').text(), 'GitHub basics');
  });
});

test('existing release review', (assert) => {
  stubAllRequests();
  visit('/');
  click('label.ember-radio-button:eq(1)'); // Existing release review
  click('button');

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/existing-approval');
  });
  click('button:eq(0)');
  runHappyPath(assert);
});

test('new release registration', (assert) => {
  stubAllRequests();
  visit('/');
  click('label.ember-radio-button:eq(0)'); // New release
  click('button');

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/new-approval');
  });
  populateNewApproval();
  click('button:eq(0)');
  runHappyPath(assert);
});

function stubAllRequests() {
  stubRequest('get', `/api/client/newRepo/org/${window.location.pathname.split('/')[1]}/metadata`, (request) => {
    request.ok({
      approval: {
        fields: {
          approvalTypes: ['New release registration', 'Existing release review', 'Exemption: small libraries, tools, and samples', 'Migrate project from CodePlex', 'Exemption: other'],
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
        languages: ['Actionscript', 'Ada', 'Agda', 'VisualStudio', 'Waf', 'WordPress', 'Xojo', 'Yeoman', 'Yii', 'ZendFramework', 'Zephir'],
      },
      supportsCla: true,
      templates: [
        { id: 'mit', spdx: 'mit', name: 'MIT', recommended: true, legalEntities: ['Microsoft'] }, { id: 'microsoft.docs', name: 'MIT and Creative Commons Attribution 4.0', description: 'Official microsoft.docs repo', spdx: '(mit and cc-by-4.0)', legalEntities: ['Microsoft'] }, { id: 'dnfmit', spdx: 'mit', name: 'MIT', legalEntities: ['.NET Foundation'] }, { id: 'dnfmit.docs', name: 'MIT and Creative Commons Attribution 4.0', description: 'Docs repo', spdx: '(mit and cc-by-4.0)', legalEntities: ['.NET Foundation'] }, { id: 'other', name: 'Other', legalEntities: ['Microsoft', '.NET Foundation'] }
      ],
      visibilities: ['private', 'public']
    });
  });

  stubRequest('get', `/api/client/newRepo/org/${window.location.pathname.split('/')[1]}/repo/testRepo`, (request) => {
    request.notFound();
  });

  stubRequest('get', `/api/client/newRepo/org/${window.location.pathname.split('/')[1]}/personalizedTeams`, (request) => {
    request.ok({
      personalizedTeams: [
        { name: 'Everyone', id: 864314, description: 'FTE\'s, interns, vendors and contractors in the Microsoft Organization on GitHub', role: 'member', broad: true },
        { name: 'ospo', id: 1825629, description: 'Open Source Programs Office', role: 'member' },
        { name: 'ospo-protected', id: 2062349, description: 'This team is used by the Open Source Programs Office to provide additional granularity in protecting branches and other specific resources related to Open Source management.', role: 'maintainer' },
        { name: 'ospo-testing', id: 2152502, description: 'Testing group for OSPO', role: 'maintainer' },
        { name: 'azure-members', id: 736397, description: 'All Microsoft employees, v- and a- who are members of the Azure organization. Best for very broad, automatic read access.', role: 'maintainer' }
      ]
    });
  });

  stubRequest('post', `/api/client/newRepo/org/${window.location.pathname.split('/')[1]}/repo/testRepo`, (request) => {
    request.ok({
      url: 'https://github.com/Microsoft/the-repo-name-github-created',
      title: 'Repository created',
      message: 'Your new repo, some-name, has been created:'
    });
  });

  stubRequest('get', '/api/client/releaseApprovals', (request) => {
    request.ok({
      releaseApprovals: [{
        id: '123',
        title: 'test release',
        url: 'http://test',
        license: 'Other'
      }, {
        id: '456',
        title: 'test release 2',
        url: 'http://test2',
        license: 'MIT'
      }]
    });
  });

  stubRequest('post', '/api/client/releaseApprovals', (request) => {
    request.ok({ releaseApprovals: [{ url: 'http://test' }] });
  });
}

function runHappyPath(assert) {
  click('button.btn-primary'); // Next

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/basics');
  });
  fillIn('input:eq(0)', 'testRepo');
  fillIn('input:eq(1)', 'test');
  click('button:eq(1)'); // Next

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/admin');
  });
  click('input:eq(0)');
  click('button.btn-primary'); // Next

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/write');
  });
  click('button.btn-primary'); // Next

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/read');
  });
  click('button.btn-primary'); // Next

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/legal');
  });
  click('button.btn-primary'); // Next

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/contents');
  });
  click('button.btn-primary'); // Next

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/review');
  });
  click('a.btn-primary'); // Submit

  andThen(() => {
    assert.equal(currentURL(), '/new-repo/congrats');
    assert.equal(find('h2').text(), 'Repository created');
  });
  click('a.btn-primary'); // Create another repo

  andThen(() => {
    assert.equal(currentURL(), '/new-repo');
  });
}

function populateNewApproval() {
  click('#public-open-source label.ember-radio-button:eq(0)');  // Yes
  click('#project-type label.ember-radio-button:eq(4)'); // Utility lib
  click('#3rdparty label.ember-radio-button:eq(1)');  // No
  click('#telemetry label.ember-radio-button:eq(1)'); // No
  click('#small-project label.ember-radio-button:eq(1)'); // No
  fillIn('#project input', 'test');
  fillIn('#version input', '1.0');
  fillIn('#project-description textarea', 'test');
  fillIn('#business-goals textarea', 'test');
  click('#modern-ui label.ember-radio-button:eq(1)'); // No
}
