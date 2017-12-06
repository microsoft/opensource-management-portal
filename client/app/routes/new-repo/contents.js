import Ember from 'ember';
import RSVP from 'rsvp';

export default Ember.Route.extend({
  beforeModel() {
    let newReleaseApproval = this.store.peekRecord('new-release-approval', 1);
    if (!newReleaseApproval) {
      newReleaseApproval = this.store.createRecord('newReleaseApproval', { id: 1 });
      newReleaseApproval.save();
    }
  },
  model() {
    return RSVP.hash({
      repo: this.store.findRecord('repo', 1),
      metadata: this.store.findAll('metadatum').then(metadata => metadata.objectAt(0)),
      newReleaseApproval: this.store.findRecord('newReleaseApproval', 1)
    });
  },
  setupController(controller, { repo, metadata, newReleaseApproval }) {
    this._super(...arguments);
    if (!repo.get('gitIgnoreLanguage')) {
      repo.set('gitIgnoreLanguage', metadata.get('gitIgnore').default);
    }
    // Set licenses list and pre-select the license:
    const legalEntity = repo.get('legalEntity');
    const templates = metadata.get('templates');
    let license = repo.get('license');
    let preSelectedLicense = repo.get('preSelectedLicense');
    if (newReleaseApproval.get('approvalType')=== 'New release registration') {
      preSelectedLicense = newReleaseApproval.get('license');
    }
    if (newReleaseApproval.get('projectType') === 'documentation') {
      for (let template of templates) {
        if (template.legalEntities.includes(legalEntity) && template.spdx.includes('mit and cc-by-4.0')) {
          preSelectedLicense = template.id;
          break;
        }
      }
    }
    if (preSelectedLicense) {
      preSelectedLicense = preSelectedLicense.toLowerCase();
      license = preSelectedLicense;
      repo.set('license', license);
    }
    const filteredLicenseTemplates = templates.filter(template => {
      let shouldInclude = true;
      if (preSelectedLicense) {
        if (preSelectedLicense === 'other' && template.id !== 'other') {
          shouldInclude = false;
        }
        if (preSelectedLicense !== 'other' && template.id === 'other') {
          shouldInclude = false;
        }
        if (preSelectedLicense === 'microsoft.docs' && template.id !== 'microsoft.docs') {
          shouldInclude = false;
        }
        if (preSelectedLicense === 'dnfmit.docs' && template.id !== 'dnfmit.docs') {
          shouldInclude = false;
        }
      }
      return shouldInclude && template.legalEntities.includes(legalEntity);
    });
    Ember.set(controller, 'filteredLicenseTemplates', filteredLicenseTemplates);
    const legalEntityLicenses = filteredLicenseTemplates.map(template => {
      return template.id;
    });
    if (!legalEntityLicenses.includes(license)) {
      repo.set('license', legalEntityLicenses[0]);
    }
  },
  actions: {
    selectEntity(selection) {
      this.currentModel.repo.set('gitIgnoreLanguage', selection);
    },
    next(repo) {
      repo.save();
      this.transitionTo('new-repo.review');
    }
  }
});
