import { test } from 'qunit';
import moduleForAcceptance from 'client/tests/helpers/module-for-acceptance';
import FakeServer, { stubRequest } from 'ember-cli-fake-server';

moduleForAcceptance('Acceptance | new approval', {
  beforeEach() {
    FakeServer.start();
  },
  afterEach() {
    FakeServer.stop();
  }
});

test('visiting /new-approval', (assert) => {
  visit('/new-approval');

  andThen(() => {
    assert.equal(currentRouteName(), 'new-approval');
    assert.equal(currentURL(), '/new-approval');
    assert.equal(find('h2').text(), 'New release registration');
  });
});

test('validation errors', (assert) => {
  visit('/new-approval');
  click('#public-open-source label.ember-radio-button:eq(0)');  // Yes
  click('#project-type label.ember-radio-button:eq(0)'); // Product code
  click('#3rdparty label.ember-radio-button:eq(1)');  // No
  click('#telemetry label.ember-radio-button:eq(1)'); // No
  click('button');

  andThen(() => {
    assert.equal(currentRouteName(), 'new-approval');
    assert.ok(find('#project div.alert').text().length > 10);
    assert.ok(find('#version div.alert').text().length > 10);
    assert.ok(find('#project-description div.alert').text().length > 10);
    assert.ok(find('#business-goals div.alert').text().length > 10);
    assert.ok(find('#modern-ui div.alert').text().length > 10);
  });
});

test('confirmation success - no approval required for policy exempt projects', (assert) => {
  visit('/new-approval');
  click('#public-open-source label.ember-radio-button:eq(1)');  // No
  click('#exemption-justification label.ember-radio-button:eq(2)'); // Hackathon
  click('label[for=policyCheckbox]');
  click('button');

  andThen(() => {
    assert.equal(currentRouteName(), 'new-approval-confirmation');
    assert.equal(find('div.alert').text().length, 0);
    assert.ok(find('h4').text().length > 0);
  });
});

test('confirmation success - no approval required for small tools', (assert) => {
  visit('/new-approval');
  click('#public-open-source label.ember-radio-button:eq(0)');  // Yes
  click('#project-type label.ember-radio-button:eq(2)'); // Sample code
  click('#3rdparty label.ember-radio-button:eq(1)');  // No
  click('#telemetry label.ember-radio-button:eq(1)'); // No
  click('#small-project label.ember-radio-button:eq(0)'); // Yes
  click('button');

  andThen(() => {
    assert.equal(currentRouteName(), 'new-approval-confirmation');
    assert.equal(find('div.alert').text().length, 0);
    assert.ok(find('h4').text().length > 0);
  });
});

test('confirmation failure', (assert) => {
  stubRequest('post', '/api/client/releaseApprovals', (request) => {
    request.error({});
  });
  visit('/new-approval');
  populateNewApproval();
  click('button');

  andThen(() => {
    assert.equal(currentRouteName(), 'new-approval-confirmation');
    assert.equal(currentURL(), '/new-approval-confirmation');
    assert.ok(find('div.alert').text().length > 10);
  });
});

test('confirmation success', (assert) => {
  stubRequest('post', '/api/client/releaseApprovals', (request) => {
    request.ok({ releaseApprovals: [{ url: 'http://test' }] });
  });
  visit('/new-approval');
  populateNewApproval();
  click('button');

  andThen(() => {
    assert.equal(currentRouteName(), 'new-approval-confirmation');
    assert.equal(currentURL(), '/new-approval-confirmation');
    assert.equal(find('h2').text(), 'New release registration confirmation');
    assert.equal(find('div.alert').text().length, 0);
    assert.ok(find('h4').text().length > 0);
  });
});

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