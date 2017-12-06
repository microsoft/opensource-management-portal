import { moduleForModel, test } from 'ember-qunit';

moduleForModel('new-release-approval', 'Unit | Model | new release approval', {
  // Specify the other units that are required for this test.
  needs: []
});

test('it exists', function(assert) {
  let model = this.subject();
  // let store = this.store();
  assert.ok(!!model);
});
