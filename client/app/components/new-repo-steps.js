import Ember from 'ember';

export default Ember.Component.extend({
  store: Ember.inject.service(),
  currentWizardSteps: [
    { value: 'index', text: 'Release registration' },
    { value: 'new-approval', text: 'New release registration' },
    { value: 'basics', text: 'GitHub basics' },
    { value: 'admin', text: 'Administrators' },
    { value: 'write', text: 'Write permissions' },
    { value: 'read', text: 'Read permissions' },
    { value: 'legal', text: 'Contributor License Agreement' },
    { value: 'contents', text: 'Repo template' },
    { value: 'review', text: 'Review' },
    { value: 'congrats', text: 'Confirmation' }
  ],
  init() {
    this._super(...arguments);
    const store = this.get('store');
    const wizardSteps = store.peekRecord('wizard-steps', 1);
    if (wizardSteps) {
      this.set('currentWizardSteps', wizardSteps.get('steps'));
      if (this.updateCurrentWizardSteps()) {
        wizardSteps.set('steps', this.get('currentWizardSteps'));
        wizardSteps.save();
      }
    } else {
      this.updateCurrentWizardSteps();
      const wizardSteps = store.createRecord('wizard-steps', {
        id: 1,
        steps: this.get('currentWizardSteps')
      });
      wizardSteps.save();
    }
  },
  didUpdateAttrs() {
    this._super(...arguments);
    if (this.updateCurrentWizardSteps()) {
      this.get('store').findRecord('wizard-steps', 1).then(wizardSteps => {
        wizardSteps.set('steps', this.get('currentWizardSteps'));
        wizardSteps.save();
      });
    }
  },
  updateCurrentWizardSteps() {
    const currentStep = this.get('step');
    const approvalType = this.get('approvalType') || '';
    if (currentStep === 'index') {
      if (approvalType.toLowerCase().includes('existing release')) {
        this.addStep('existing-approval', 'Existing release review');
        this.removeStep('new-approval');
        return true;
      }
      if (approvalType.toLowerCase().includes('new release')) {
        this.addStep('new-approval', 'New release registration');
        this.removeStep('existing-approval');
        return true;
      }
      if (approvalType.toLowerCase().includes('codeplex')) {
        this.removeStep('new-approval');
        this.removeStep('existing-approval');
        return true;
      }
    }
    if (currentStep === 'new-approval') {
      this.addStep('new-approval', 'New release registration');
      this.removeStep('existing-approval');
      return true;
    }
    if (currentStep === 'existing-approval') {
      this.addStep('existing-approval', 'Existing release review');
      this.removeStep('new-approval');
      return true;
    }
    return false; // No update
  },
  isStepIncludedInWizardSteps(step) {
    const steps = this.get('currentWizardSteps');
    for (let i = 0; i < steps.length; i++) {
      if (step === steps[i].value) {
        return true;
      }
    }
    return false;
  },
  getStepIndex(step) {
    const steps = this.get('currentWizardSteps');
    for (let i = 0; i < steps.length; i++) {
      if (step === steps[i].value) {
        return i;
      }
    }
    return -1;
  },
  addStep(value, text, index = 1) {
    if (!this.isStepIncludedInWizardSteps(value)) {
      const steps = this.get('currentWizardSteps').copy();
      steps.splice(index, 0, { value: value, text: text });
      this.set('currentWizardSteps', steps);
    }
  },
  removeStep(value) {
    const stepIndex = this.getStepIndex(value);
    if (stepIndex >= 0) {
      const steps = this.get('currentWizardSteps').copy();
      steps.splice(stepIndex, 1);
      this.set('currentWizardSteps', steps);
    }
  }
});
