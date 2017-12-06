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
    // Copy write teams from personalized teams model to controller while marking each field whether it is checked or not based on selected write team model hash
    // Any admin team checked must be pre-checked and disabled too.
    let personalizedWriteTeams = [];
    const selectedPersonalizedAdminTeamsFromModel = model.repo.get('selectedPersonalizedAdminTeams') || {};
    const selectedPersonalizedWriteTeamsFromModel = model.repo.get('selectedPersonalizedWriteTeams') || {};
    model.personalizedTeams.forEach(team => {
      const teamId = team.get('id');
      if (!team.get('broad')) { // Exclude Everyone team
        personalizedWriteTeams.push({
          id: teamId,
          name: team.get('name'),
          description: team.get('description'),
          isChecked: (selectedPersonalizedWriteTeamsFromModel[teamId] ? true : false) || (selectedPersonalizedAdminTeamsFromModel[teamId] ? true : false),
          isDisabled: selectedPersonalizedAdminTeamsFromModel[teamId] ? true : false
        });
      }
    });
    Ember.set(controller, 'personalizedWriteTeams', personalizedWriteTeams);
    // Other teams - any admin team checked must be pre-checked and disabled too.
    const selectedAdminTeams = model.repo.get('selectedAdminTeams') || {};
    let selectedWriteTeams = model.repo.get('selectedWriteTeams') || {};
    const adminTeamIds = Object.keys(selectedAdminTeams);
    const writeTeamIds = Object.keys(selectedWriteTeams);
    writeTeamIds.forEach(teamId => {
      if (selectedWriteTeams[teamId].isDisabled && !selectedAdminTeams[teamId]) {
        delete selectedWriteTeams[teamId];
      }
    });
    adminTeamIds.forEach(teamId => {
      selectedWriteTeams[teamId] = {
        name: selectedAdminTeams[teamId].name,
        description: selectedAdminTeams[teamId].description,
        isChecked: true,
        isDisabled: true
      };
    });
    model.repo.set('selectedWriteTeams', selectedWriteTeams);
    model.repo.save();
  },
  actions: {
    back(repo) {
      this.persistTeamsSelection(repo, 'personalizedWriteTeams', 'selectedPersonalizedWriteTeams', 'selectedWriteTeams');
      this.transitionTo('new-repo.admin');
    },
    next(repo) {
      this.persistTeamsSelection(repo, 'personalizedWriteTeams', 'selectedPersonalizedWriteTeams', 'selectedWriteTeams');
      this.transitionTo('new-repo.read');
    },
    loadAllTeams() {
      this.loadOrRefreshAllTeams();
    },
    refreshAllTeams() {
      this.loadOrRefreshAllTeams(true);
    },
    selectTeam(team, repo) {
      this.selectTeam(team, repo, 'selectedWriteTeams');
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
      Ember.get(this, 'flashMessages').danger(error.errors && error.errors[0] ? error.errors[0].detail : 'Unexpected error occurred.');
    }).finally(() => {
      this.get('spinner').hide('1');
    });
  }
});
