import { moduleFor, test } from 'ember-qunit';

moduleFor('route:new-repo/write', 'Unit | Route | new repo/write', {
  // Specify the other units that are required for this test.
  needs: ['service:flashMessages', 'service:spinner', 'service:util']
});

test('it exists', function(assert) {
  let route = this.subject();
  assert.ok(route);
});
