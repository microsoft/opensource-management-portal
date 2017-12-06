import { moduleFor, test } from 'ember-qunit';

moduleFor('route:new-approval-confirmation', 'Unit | Route | new approval confirmation', {
  // Specify the other units that are required for this test.
  needs: ['service:ajax', 'service:flashMessages']
});

test('it exists', function(assert) {
  let route = this.subject();
  assert.ok(route);
});
