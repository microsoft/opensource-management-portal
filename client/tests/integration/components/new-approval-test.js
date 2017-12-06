import { moduleForComponent, test } from 'ember-qunit';
import hbs from 'htmlbars-inline-precompile';

moduleForComponent('new-approval', 'Integration | Component | new approval', {
  integration: true
});

test('it renders', function(assert) {

  // Set any properties with this.set('myProperty', 'value');
  // Handle any actions with this.on('myAction', function(val) { ... });

  this.render(hbs`{{new-approval}}`);

  assert.ok(this.$().text().trim().length > 100, '');

  // Template block usage:
  this.render(hbs`
    {{#new-approval}}
      template block text
    {{/new-approval}}
  `);

  assert.ok(this.$().text().trim().length > 100, 'template block text');
});
