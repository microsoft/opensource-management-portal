import Ember from 'ember';

export default Ember.Component.extend({
  didRender() {
    setupPopover();
    // Copied from https://github.com/Microsoft/ospo-witness-extension/blob/develop/witness/scripts/popover.js
    function setupPopover() {
      const showDelayTime = 1000;
      const hideDelayTime = 40;

      function Popover(target, content) {
        this.element = target;
        this.content = content;
        this.popoverElement = null;
        this.state = {
          shouldPop: false,
          isOpening: false
        };
        this.startTime = null;
        this.setup();
      }

      Popover.prototype.setup = function () {
        const self = this;
        self.element.on('mouseenter', function () {
          self.state.shouldPop = true;
          setTimeout(self.showPopover.bind(self), showDelayTime);
        }).on('mouseleave', function () {
          self.state.shouldPop = false;
          setTimeout(self.hidePopover.bind(self), hideDelayTime);
        }).on('click', function () {
          self.state.shouldPop = false;
          self.hidePopover();
        }).on('mouseover', function (event) {
          event.stopPropagation();
        });

        self.element.popover({
          trigger: 'manual',
          html: true,
          placement: 'auto top',
          content: function () {
            return self.content;
          }
        });
      };

      Popover.prototype.addPopEvent = function () {
        const self = this;
        self.popoverElement.on('mouseenter', function () {
          self.state.shouldPop = true;
        }).on('mouseleave', function () {
          self.state.shouldPop = false;
          self.hidePopover();
        });
      };

      Popover.prototype.showPopover = function () {
        if (this.state.shouldPop && !this.state.isOpening) {
          // Show popover and assign popover DOM to popoverElement.
          this.popoverElement = this.element.popover('show').data('bs.popover').tip();
          this.addPopEvent();
          this.state.isOpening = true;
          this.startTime = performance.now();
        }
      };

      Popover.prototype.hidePopover = function () {
        if (!this.state.shouldPop && this.state.isOpening) {
          this.element.popover('hide');
          this.state.isOpening = false;
        }
      };

      const popoverList = [];
      Ember.$('body').on('mouseover', '.pop', function () {
        // Use delegate to add popover to dynamic .pop elements.
        // This will only execute once because mouseover event stop propagating from the .pop element.
        const content = Ember.$('#${id}-popover'.replace('${id}', this.id)).html();
        const thisElement = Ember.$(this);
        popoverList.push(new Popover(thisElement, content));
        thisElement.mouseenter();
      });
    }
  }
});
