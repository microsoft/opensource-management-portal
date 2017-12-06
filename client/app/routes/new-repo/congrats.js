import Ember from 'ember';

export default Ember.Route.extend({
  ajax: Ember.inject.service(),
  flashMessages: Ember.inject.service(),
  util: Ember.inject.service(),
  beforeModel() {
    let newReleaseApproval = this.store.peekRecord('new-release-approval', 1);
    if (!newReleaseApproval) {
      newReleaseApproval = this.store.createRecord('newReleaseApproval', { id: 1 });
      newReleaseApproval.save();
    }
  },
  model() {
    return Ember.RSVP.hash({
      repo: this.store.findRecord('repo', 1),
      newReleaseApproval: this.store.findRecord('newReleaseApproval', 1)
    }).then(({ repo, newReleaseApproval }) => {
      return new Ember.RSVP.Promise((resolve, reject) => {
        if (repo.get('approvalType') !== 'New release registration') {
          resolve({ repo });
        } else {
          this.get('ajax').raw(`/api/client/releaseApprovals`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              Accept: 'application/json'
            },
            data: JSON.stringify(this.populateApprovalData(newReleaseApproval))
          }).then(({ response }) => {
            resolve({ repo, response });
          }).catch(error => {
            reject(error);
          });
        }
      });
    }).then(({ repo, response }) => {
      const model = {
        newApprovalUrl: undefined,
        newRepoResponse: undefined
      };
      if (response) {
        const newApprovalUrl = response.releaseApprovals[0].url;
        repo.set('approvalUrl', newApprovalUrl);
        repo.save();
        model.newApprovalUrl = newApprovalUrl;
      }
      const name = repo.get('name');
      const orgName = this.get('util').getOrgName();
      return this.get('ajax').raw(`/api/client/newRepo/org/${orgName}/repo/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json'
        },
        data: JSON.stringify(this.populateData(repo))
      }).then(({ response }) => {
        model.newRepoResponse = response;
        return model;
      });
    }).catch(({ jqXHR }) => {
      const message = (jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.message) ? jqXHR.responseJSON.message : 'Unexpected error occurred.';
      Ember.get(this, 'flashMessages').danger(message);
      return;
    }).finally(() => {
      this.store.unloadAll('repo');
      this.store.unloadAll('newReleaseApproval');
    });
  },
  actions: {
    willTransition(transition) {
      if (transition.targetName.startsWith('new-repo')) { // Example: hitting the back button
        this.controller.set('model', null);
        this.transitionTo('new-repo');
      }
    }
  },
  populateApprovalData(newReleaseApproval) {
    const request = [{
      name: newReleaseApproval.get('projectName'),
      version: newReleaseApproval.get('projectVersion'),
      details: newReleaseApproval.get('projectDescription'),
      businessGoals: newReleaseApproval.get('businessGoals'),
      usageDetails: newReleaseApproval.get('usage') === '' ? undefined : newReleaseApproval.get('usage'),
      license: newReleaseApproval.get('license'),
      technologyArea: newReleaseApproval.get('technologyArea'),
      naturalUI: newReleaseApproval.get('naturalUI'),
      naturalUIDetails: newReleaseApproval.get('naturalUIDetails'),
      multimediaCodecs: newReleaseApproval.get('multimediaCodecs'),
      multimediaCodecDetails: newReleaseApproval.get('multimediaCodecDetails'),
      backendSearch: newReleaseApproval.get('backendSearch'),
      backendSearchDetails: newReleaseApproval.get('backendSearchDetails'),
      connectivityProtocols: newReleaseApproval.get('connectivityProtocols'),
      protocolDetails: newReleaseApproval.get('protocolDetails'),
      repositoryName: newReleaseApproval.get('hosting'),
      includes3rdparty: newReleaseApproval.get('includes3rdparty') === 'Yes' ? true : false,
      includes3rdpartyDetails: newReleaseApproval.get('includes3rdpartyDetails'),
      sendsDataToMicrosoft: newReleaseApproval.get('sendsDataToMicrosoft') === 'Yes' ? true : false,
      modernUI: newReleaseApproval.get('includesModernUI'),
      modernUIDetails: newReleaseApproval.get('modernUIDetails')
    }];
    return request;
  },
  populateData(repo) {
    const request = {
      name: repo.get('name'),
      projectType: repo.get('projectType'),
      description: repo.get('description'),
      private: repo.get('visibility').toLowerCase() === 'private',
      approvalType: repo.get('approvalType'),
      approvalUrl: repo.get('approvalUrl'),
      justification: repo.get('justification'),
      legalEntity: repo.get('legalEntity'),
      claMails: repo.get('legalEmails'),
      template: repo.get('license'),
      gitIgnoreTemplate: repo.get('gitIgnoreLanguage'),
      selectedAdminTeams: [],
      selectedWriteTeams: [],
      selectedReadTeams: []
    };
    const selectedPersonalizedAdminTeams = repo.get('selectedPersonalizedAdminTeams') || {};
    const personalizedAdminTeamIds = Object.keys(selectedPersonalizedAdminTeams);
    const selectedPersonalizedWriteTeams = repo.get('selectedPersonalizedWriteTeams') || {};
    const personalizedWriteTeamIds = Object.keys(selectedPersonalizedWriteTeams);
    const selectedPersonalizedReadTeams = repo.get('selectedPersonalizedReadTeams') || {};
    const personalizedReadTeamIds = Object.keys(selectedPersonalizedReadTeams);
    const selectedAllAdminTeams = repo.get('selectedAdminTeams') || {};
    const allAdminTeamIds = Object.keys(selectedAllAdminTeams);
    const selectedAllWriteTeams = repo.get('selectedWriteTeams') || {};
    const allWriteTeamIds = Object.keys(selectedAllWriteTeams);
    const selectedAllReadTeams = repo.get('selectedReadTeams') || {};
    const allReadTeamIds = Object.keys(selectedAllReadTeams);
    personalizedAdminTeamIds.forEach(id => {
      request.selectedAdminTeams.push(parseInt(id, 10));
    });
    personalizedWriteTeamIds.forEach(id => {
      request.selectedWriteTeams.push(parseInt(id, 10));
    });
    personalizedReadTeamIds.forEach(id => {
      request.selectedReadTeams.push(parseInt(id, 10));
    });
    allAdminTeamIds.forEach(id => {
      request.selectedAdminTeams.push(parseInt(id, 10));
    });
    allWriteTeamIds.forEach(id => {
      request.selectedWriteTeams.push(parseInt(id, 10));
    });
    allReadTeamIds.forEach(id => {
      request.selectedReadTeams.push(parseInt(id, 10));
    });
    return request;
  }
});
