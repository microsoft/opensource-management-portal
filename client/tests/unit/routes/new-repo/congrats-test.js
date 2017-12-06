import { moduleFor, test } from 'ember-qunit';

moduleFor('route:new-repo/congrats', 'Unit | Route | new repo/congrats', {
  // Specify the other units that are required for this test.
  needs: ['service:ajax', 'service:flashMessages', 'service:spinner', 'service:util']
});

test('it exists', function(assert) {
  let route = this.subject();
  assert.ok(route);
});
