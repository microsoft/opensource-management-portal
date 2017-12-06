import Ember from 'ember';

export default Ember.Controller.extend({
  page: 1,
  pageSize: 10,
  allRecordsFilter: '',
  allRecordsTotalCount: Ember.computed.alias('releaseApprovals.length'),
  allRecordsFilteredCount: Ember.computed.alias('filteredAllRecords.length'),
  filteredAllRecords: Ember.computed('allRecordsFilter', 'allRecordsTotalCount', function () { // Computed properties are not fat arrow ES6 friendly yet.
    const lowerCaseFilterValue = this.get('allRecordsFilter').toLowerCase();
    const allRecords = this.get('releaseApprovals');
    return allRecords.filter(record => {
      if (record.get('title') && record.get('title').toLowerCase().includes(lowerCaseFilterValue)) {
        return record;
      }
    });
  }),
  numPages: Ember.computed('allRecordsFilteredCount', function () {
    const pageSize = this.get('pageSize');
    const allRecordsFilteredCount = this.get('allRecordsFilteredCount');
    return Math.ceil(allRecordsFilteredCount / pageSize);
  }),
  pages: Ember.computed('page', 'allRecordsFilteredCount', function () {
    const numPages = this.get('numPages');
    const currentPage = this.get('page');
    let pagesArray = [];
    if (numPages <= 7) {
      for (let i = 1; i <= numPages; i++) {
        pagesArray.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 5; i++) {
          pagesArray.push(i);
        }
        pagesArray.push(null);
        pagesArray.push(numPages);
      } else if (currentPage >= numPages - 2) {
        pagesArray.push(1);
        pagesArray.push(null);
        for (let i = numPages-4; i <= numPages; i++) {
          pagesArray.push(i);
        }
      } else {
        pagesArray.push(1);
        if(currentPage - 2 > 2){
          pagesArray.push(null);
        }
        for (let i = currentPage - 2; i <= currentPage + 2; i++){
          pagesArray.push(i);
        }
        if(currentPage + 1 < numPages){
          pagesArray.push(null);
        }
        pagesArray.push(numPages);
      }
    }
    return pagesArray;
  }),
  paged: Ember.computed('page', 'allRecordsFilteredCount', function () {
    if (this.get('page') > this.get('numPages')) {
      this.set('page', 1);
    }
    const page = this.get('page') - 1;
    const pageSize = this.get('pageSize');
    const start = page * pageSize;
    const end = start + pageSize;
    return this.get('filteredAllRecords').slice(start, end);
  }),
  previousPage: Ember.computed('page', 'allRecordsFilteredCount', function () {
    return this.changePage(this.get('page'), this.get('numPages'), -1);
  }),
  nextPage: Ember.computed('page', 'allRecordsFilteredCount', function () {
    return this.changePage(this.get('page'), this.get('numPages'), 1);
  }),
  changePage(page, numPages, step) {
    const newPage = page + step;
    if (newPage <= numPages && newPage >= 1) {
      return newPage;
    }
  },
  actions: {
    updatePage(page) {
      this.set('page', page);
    }
  }
});
