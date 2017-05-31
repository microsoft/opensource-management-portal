//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const sql = require('mssql');

exports.getClaRepositorySettings = function getClaRepositorySettings(dbConection, repoId, callback) {
  const query = `SELECT * FROM dbo.Repositories WHERE ObjectId = '${repoId}'`;
  const request = new sql.Request(dbConection);
  request.query(query, (queryError, results) => {
    if (queryError) {
      return callback(queryError);
    }
    var result = null;
    if (results && results.length > 0) {
      result = results[0];
    }
    return callback(null, result);
  });
};

exports.upsertClaRepositoryData = function upsertClaRepositoryData(dbConection, claData, callback) {
  const selectQuery = `SELECT Id FROM dbo.Repositories WHERE ObjectId = '${claData.repoGitHubId}'`;
  const request = new sql.Request(dbConection);
  request.query(selectQuery, (err, results) => {
    if (err) {
      return callback(err);
    }
    if (results.length === 0) { // Insert new entry
      const insertQuery = 'INSERT INTO dbo.Repositories(Name, OrganizationId, Description, IsPrivate, Provider, ObjectId, AutomateCLA, CLAHookId, ' +
        'NotifierEmails, LicenseId, CreatedOn, CreatedAtProvider, UpdatedAtProvider, SourceUrl, IsFork, IsRepoIgnored, CreatedBy, TransferRequested) ' +
        'VALUES(@name, @organizationId, @description, @isPrivate, 0, @repoGitHubId, \'True\', @webHookId, ' +
        '@emails, @licenseId, GETDATE(), @createdAtProvider, @updatedAtProvider, @sourceUrl, @isFork, \'False\', \'ospo-repos\', \'False\')';
      new sql.Request(dbConection)
        .input('name', claData.repoName)
        .input('organizationId', claData.organizationId)
        .input('description', claData.description)
        .input('isPrivate', claData.isPrivate)
        .input('repoGitHubId', claData.repoGitHubId)
        .input('webHookId', claData.webHookId)
        .input('emails', claData.emails)
        .input('licenseId', claData.licenseId)
        .input('createdAtProvider', claData.createdAt)
        .input('updatedAtProvider', claData.updatedAt)
        .input('sourceUrl', claData.sourceUrl)
        .input('isFork', claData.isFork)
        .query(insertQuery, (error) => {
          return callback(error ? error : null);
        });
    } else { // Update existing entry
      const id = results[0].Id;
      const updateQuery = 'UPDATE dbo.Repositories SET Name=@name, OrganizationId=@organizationId, Description=@description, ' +
        'IsPrivate=@isPrivate, Provider=0, ObjectId=@repoGitHubId, AutomateCLA=\'True\', CLAHookId=@webHookId, NotifierEmails=@emails, ' +
        'LicenseId=@licenseId, UpdatedOn=GETDATE(), CreatedAtProvider=@createdAtProvider, UpdatedAtProvider=@updatedAtProvider, ' +
        'SourceUrl=@sourceUrl, IsFork=@isFork, IsRepoIgnored=\'False\', LastUpdatedBy=\'ospo-repos\', TransferRequested=\'False\' WHERE Id=@id';
      new sql.Request(dbConection)
        .input('name', claData.repoName)
        .input('organizationId', claData.organizationId)
        .input('description', claData.description)
        .input('isPrivate', claData.isPrivate)
        .input('repoGitHubId', claData.repoGitHubId)
        .input('webHookId', claData.webHookId)
        .input('emails', claData.emails)
        .input('licenseId', claData.licenseId)
        .input('createdAtProvider', claData.createdAt)
        .input('updatedAtProvider', claData.updatedAt)
        .input('sourceUrl', claData.sourceUrl)
        .input('isFork', claData.isFork)
        .input('id', id)
        .query(updateQuery, (error) => {
          return callback(error ? error : null);
        });
    }
  });
};