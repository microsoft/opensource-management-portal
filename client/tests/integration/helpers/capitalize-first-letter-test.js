
import { moduleForComponent, test } from 'ember-qunit';
import hbs from 'htmlbars-inline-precompile';

moduleForComponent('capitalize-first-letter', 'helper:capitalize-first-letter', {
  integration: true
});

test('It capitalizes a single string', function(assert) {
  this.set('inputValue', 'public');

  this.render(hbs`{{capitalize-first-letter inputValue}}`);

  assert.equal(this.$().text().trim(), 'Public');
});

