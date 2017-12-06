import { moduleFor, test } from 'ember-qunit';

moduleFor('route:new-repo/basics', 'Unit | Route | new repo/basics', {
  // Specify the other units that are required for this test.
  needs: ['service:ajax', 'service:flashMessages', 'service:spinner', 'service:util']
});

test('it exists', function(assert) {
  let route = this.subject();
  assert.ok(route);
});
