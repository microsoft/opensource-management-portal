import { moduleFor, test } from 'ember-qunit';

moduleFor('route:new-repo/review', 'Unit | Route | new repo/review', {
  // Specify the other units that are required for this test.
  needs: ['service:util']
});

test('it exists', function(assert) {
  let route = this.subject();
  assert.ok(route);
});
