import { moduleForModel, test } from 'ember-qunit';

moduleForModel('wizard-steps', 'Unit | Serializer | wizard steps', {
  // Specify the other units that are required for this test.
  needs: ['serializer:wizard-steps', 'transform:raw']
});

// Replace this with your real tests.
test('it serializes records', function(assert) {
  let record = this.subject();

  let serializedRecord = record.serialize();

  assert.ok(serializedRecord);
});
