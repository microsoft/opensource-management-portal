//

// from ancient data client
// var storageAccountName = options.config.github.links.table.account;
// var storageAccountKey = options.config.github.links.table.key;
// var prefix = options.config.github.links.table.prefix;
// try {
//   if (!storageAccountName || !storageAccountKey) {
//     throw new Error('Storage account information is not configured.');
//   }
//   this.table = azure.createTableService(storageAccountName, storageAccountKey);
// } catch (storageAccountError) {
//   return callback(storageAccountError);
// }
// this.entGen = azure.TableUtilities.entityGenerator;
// if (prefix === undefined) {
//   prefix = '';
// }
// this.options = {
//   partitionKey: prefix + 'pk',
//   linksTableName: prefix + 'links',
//   pendingApprovalsTableName: prefix + 'pending',
//   errorsTableName: prefix + 'errors',
//   settingsTableName: `${prefix}settings`,
//   encryption: options.config.github.links.table.encryption,
// };

/*
get pending approvals

var dc = this;
var teams = null;
var i;
if (typeof teamsIn === 'number') {
  teams = [teamsIn.toString()];
}
else if (typeof teamsIn === 'string') {
  teams = [teamsIn];
} else if (typeof teamsIn === 'function') {
  callback = teamsIn;
  teams = []; // Special case: empty list means all pending approvals
} else {
  if (!(teamsIn && teamsIn.length)) {
    throw new Error('Unknown "teams" type for getPendingApprovals. Please file a bug.');
  }
  // New permissions system refactoring...
  if (teamsIn.length > 0 && teamsIn[0] && teamsIn[0].id) {
    teams = [];
    for (i = 0; i < teamsIn.length; i++) {
      teams.push(teamsIn[i].id);
    }
  }
}
var query = new azure.TableQuery()
  .where('PartitionKey eq ?', this.options.partitionKey)
  .and('active eq ?', true);
if (teams.length > 0) {
  var clauses = [];
  for (i = 0; i < teams.length; i++) {
    clauses.push('teamid eq ?string?');
  }
  var args = [clauses.join(' or ')].concat(teams);
  query.and.apply(query, args);
}
dc.table.queryEntities(dc.options.pendingApprovalsTableName,
  query,
  null,
  function (error, results) {
    if (error) return callback(error);
    var entries = [];
    if (results && results.entries && results.entries.length) {
      for (var i = 0; i < results.entries.length; i++) {
        var r = results.entries[i];
        if (r && r.active && r.active._) {
          entries.push(dc.reduceEntity(r));
        }
      }
    }
    callback(null, entries);
  });

  */
