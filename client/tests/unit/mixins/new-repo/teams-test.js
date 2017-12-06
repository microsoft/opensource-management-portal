import Ember from 'ember';
import NewRepoTeamsMixin from 'client/mixins/new-repo/teams';
import { module, test } from 'qunit';

module('Unit | Mixin | new repo/teams');

// Replace this with your real tests.
test('it works', function(assert) {
  let NewRepoTeamsObject = Ember.Object.extend(NewRepoTeamsMixin);
  let subject = NewRepoTeamsObject.create();
  assert.ok(subject);
});
