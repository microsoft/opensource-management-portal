import Ember from 'ember';
import RSVP from 'rsvp';
import Teams from 'client/mixins/new-repo/teams';

export default Ember.Route.extend(Teams, {
  flashMessages: Ember.inject.service(),
  spinner: Ember.inject.service('spinner'),
  util: Ember.inject.service(),
  model() {
    return RSVP.hash({
      repo: this.store.findRecord('repo', 1),
      personalizedTeams: this.store.findAll('personalized-team')
    });
  },
  setupController(controller, model) {
    this._super(...arguments);
    Ember.set(controller, 'orgName', this.get('util').getOrgName());
    // Copy admin teams from personalized teams model to controller while marking each field whether it is checked or not based on selected admin team model hash
    let personalizedAdminTeams = [];
    const selectedPersonalizedAdminTeamsFromModel = model.repo.get('selectedPersonalizedAdminTeams') || {};
    model.personalizedTeams.forEach(team => {
      const teamId = team.get('id');
      if (!team.get('broad')) { // Exclude Everyone team
        personalizedAdminTeams.push({
          id: teamId,
          name: team.get('name'),
          description: team.get('description'),
          isChecked: selectedPersonalizedAdminTeamsFromModel[teamId] ? true : false
        });
      }
    });
    Ember.set(controller, 'personalizedAdminTeams', personalizedAdminTeams);
  },
  actions: {
    back(repo) {
      this.persistTeamsSelection(repo, 'personalizedAdminTeams', 'selectedPersonalizedAdminTeams', 'selectedAdminTeams');
      this.transitionTo('new-repo.basics');
    },
    next(repo) {
      if (this.persistTeamsSelection(repo, 'personalizedAdminTeams', 'selectedPersonalizedAdminTeams', 'selectedAdminTeams') < 1) {
        return Ember.get(this, 'flashMessages').danger('At least one admin team must be selected.');
      }
      this.transitionTo('new-repo.write');
    },
    loadAllTeams() {
      this.loadOrRefreshAllTeams();
    },
    refreshAllTeams() {
      this.loadOrRefreshAllTeams(true);
    },
    selectTeam(team, repo) {
      this.selectTeam(team, repo, 'selectedAdminTeams');
      this.refresh();
    }
  },
  loadOrRefreshAllTeams(shouldRefresh) {
    this.get('spinner').show('1');
    this.store.query('team', shouldRefresh ? { refresh: true } : {}).then(teams => {
      teams = teams.filter(team => {
        return !team.get('broad'); // Exclude Everyone team
      });
      this.controller.set('allTeams', teams);
    }).catch(error => {
      Ember.debug(error);
      Ember.get(this, 'flashMessages').danger(error.errors && error.errors[0] ? error.errors[0].detail : 'Unexpected error occurred.');
    }).finally(() => {
      this.get('spinner').hide('1');
    });
  }
});
