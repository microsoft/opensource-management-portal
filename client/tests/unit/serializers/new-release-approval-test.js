import { moduleForModel, test } from 'ember-qunit';

moduleForModel('new-release-approval', 'Unit | Serializer | new release approval', {
  // Specify the other units that are required for this test.
  needs: ['serializer:new-release-approval']
});

// Replace this with your real tests.
test('it serializes records', function(assert) {
  let record = this.subject();

  let serializedRecord = record.serialize();

  assert.ok(serializedRecord);
});
