import Ember from 'ember';

export default Ember.Route.extend({
  ajax: Ember.inject.service(),
  flashMessages: Ember.inject.service(),
  model() {
    return this.store.findRecord('newReleaseApproval', 1).then(newReleaseApproval => {
      if (newReleaseApproval.get('confirmedPolicyException')) {
        return { isPolicyException: true };
      }
      if (newReleaseApproval.get('smallProject') === 'Yes') {
        return { isSmallLibTool: true };
      }
      return this.get('ajax').raw(`/api/client/releaseApprovals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json'
        },
        data: JSON.stringify(this.populateApprovalData(newReleaseApproval))
      }).then(({ response }) => {
        return { approvalUrl: response.releaseApprovals[0].url };
      }).catch(({ jqXHR }) => {
        const message = (jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.message) ? jqXHR.responseJSON.message : 'Unexpected error occurred.';
        Ember.get(this, 'flashMessages').danger(message);
        return {};
      });
    });
  },
  afterModel() {
    this.store.unloadAll('newReleaseApproval');
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
  }
});
