import { moduleFor, test } from 'ember-qunit';

moduleFor('route:new-repo/admin', 'Unit | Route | new repo/admin', {
  // Specify the other units that are required for this test.
  needs: ['service:flashMessages', 'service:spinner', 'service:util']
});

test('it exists', function(assert) {
  let route = this.subject();
  assert.ok(route);
});
