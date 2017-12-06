import Ember from 'ember';
import FilteredPaginationMixin from 'client/mixins/new-repo/filtered-pagination';
import { module, test } from 'qunit';

module('Unit | Mixin | filtered pagination');

// Replace this with your real tests.
test('it works', function(assert) {
  let FilteredPaginationObject = Ember.Object.extend(FilteredPaginationMixin);
  let subject = FilteredPaginationObject.create();
  assert.ok(subject);
});
