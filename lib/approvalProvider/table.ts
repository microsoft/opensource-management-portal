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
