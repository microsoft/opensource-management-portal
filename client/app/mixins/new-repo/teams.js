import Ember from 'ember';

export default Ember.Mixin.create({
  persistTeamsSelection(repo, personalizedTeamsControllerName, selectedPersonalizedTeamsFieldName, selectedTeamsFieldName) {
    // Save all the selected teams into selected admin/write/read teams model hash based on the teams from the controller
    let selectedPersonalizedTeamsToModel = {};
    const personalizedAdminTeams = this.controller.get(personalizedTeamsControllerName);
    personalizedAdminTeams.forEach(team => {
      if (team.isChecked) {
        selectedPersonalizedTeamsToModel[team.id] = {
          name: team.name,
          description: team.description
        };
      }
    });
    repo.set(selectedPersonalizedTeamsFieldName, selectedPersonalizedTeamsToModel);
    // Remove unchecked other teams
    let selectedTeams = repo.get(selectedTeamsFieldName) || {};
    const teamIds = Object.keys(selectedTeams);
    teamIds.forEach(teamId => {
      if (!selectedTeams[teamId].isChecked) {
        delete selectedTeams[teamId];
      }
    });
    repo.set(selectedTeamsFieldName, selectedTeams);
    repo.save();
    return Object.keys(selectedPersonalizedTeamsToModel).length + Object.keys(selectedTeams).length; // total number of teams
  },
  selectTeam(team, repo, fieldName) {
    let selectedTeams = repo.get(fieldName) || {};
    if (selectedTeams[team.get('id')]) {
      return;
    }
    selectedTeams[team.get('id')] = {
      name: team.get('name'),
      description: team.get('description'),
      isChecked: true
    };
    repo.set(fieldName, selectedTeams);
    repo.save();
  }
});
