import { moduleForComponent, test } from 'ember-qunit';
import hbs from 'htmlbars-inline-precompile';

moduleForComponent('new-repo-steps', 'Integration | Component | new repo steps', {
  integration: true
});

test('it renders', function(assert) {

  // Set any properties with this.set('myProperty', 'value');
  // Handle any actions with this.on('myAction', function(val) { ... });

  this.render(hbs`{{new-repo-steps step="index"}}`);
  assert.equal(this.$('div > ul > li:nth-child(1)').text().trim(), 'Release registration');

  // Template block usage:
  // this.render(hbs`
  //   {{new-repo-steps step=0}}
  // `);

  // assert.include('New repository steps', this.$().text().trim());
});
