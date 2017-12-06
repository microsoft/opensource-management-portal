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
    // Any admin or write team checked must be pre-checked and disabled too.
    let personalizedReadTeams = [];
    const selectedPersonalizedAdminTeamsFromModel = model.repo.get('selectedPersonalizedAdminTeams') || {};
    const selectedPersonalizedWriteTeamsFromModel = model.repo.get('selectedPersonalizedWriteTeams') || {};
    const selectedPersonalizedReadTeamsFromModel = model.repo.get('selectedPersonalizedReadTeams') || {};
    model.personalizedTeams.forEach(team => {
      const teamId = team.get('id');
      const isEveryoneTeam = team.get('broad');
      personalizedReadTeams.push({
        id: teamId,
        name: team.get('name'),
        description: team.get('description'),
        isChecked: isEveryoneTeam || (selectedPersonalizedAdminTeamsFromModel[teamId] ? true : false) || (selectedPersonalizedWriteTeamsFromModel[teamId] ? true : false) || (selectedPersonalizedReadTeamsFromModel[teamId] ? true : false),
        isDisabled: (selectedPersonalizedAdminTeamsFromModel[teamId] ? true : false) || (selectedPersonalizedWriteTeamsFromModel[teamId] ? true : false)
      });
    });
    Ember.set(controller, 'personalizedReadTeams', personalizedReadTeams);
    // Other teams - any write team checked must be pre-checked and disabled too (any admin pre-checked team will be checked in write teams).
    const selectedAdminTeams = model.repo.get('selectedAdminTeams') || {};
    const selectedWriteTeams = model.repo.get('selectedWriteTeams') || {};
    let selectedReadTeams = model.repo.get('selectedReadTeams') || {};
    const writeTeamIds = Object.keys(selectedWriteTeams);
    const readTeamIds = Object.keys(selectedReadTeams);
    readTeamIds.forEach(teamId => {
      if (selectedReadTeams[teamId].isDisabled && (!selectedAdminTeams[teamId] || !selectedWriteTeams[teamId])) {
        delete selectedReadTeams[teamId];
      }
    });
    writeTeamIds.forEach(teamId => {
      selectedReadTeams[teamId] = {
        name: selectedWriteTeams[teamId].name,
        description: selectedWriteTeams[teamId].description,
        isChecked: true,
        isDisabled: true
      };
    });
    model.repo.set('selectedReadTeams', selectedReadTeams);
    model.repo.save();
  },
  actions: {
    back(repo) {
      this.persistTeamsSelection(repo, 'personalizedReadTeams', 'selectedPersonalizedReadTeams', 'selectedReadTeams');
      this.transitionTo('new-repo.write');
    },
    next(repo) {
      this.persistTeamsSelection(repo, 'personalizedReadTeams', 'selectedPersonalizedReadTeams', 'selectedReadTeams');
      this.transitionTo('new-repo.legal');
    },
    loadAllTeams() {
      this.loadOrRefreshAllTeams();
    },
    refreshAllTeams() {
      this.loadOrRefreshAllTeams(true);
    },
    selectTeam(team, repo) {
      this.selectTeam(team, repo, 'selectedReadTeams');
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
