import { moduleFor, test } from 'ember-qunit';

moduleFor('route:new-repo/new-approval', 'Unit | Route | new repo/new approval', {
  // Specify the other units that are required for this test.
  needs: ['service:ajax', 'service:flashMessages', 'service:spinner']
});

test('it exists', function(assert) {
  let route = this.subject();
  assert.ok(route);
});
