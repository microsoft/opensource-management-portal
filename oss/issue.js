//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// CONSIDER: Cleanup issue.js.

function OpenSourceIssue (repoInstance, issueNumber, optionalInitialData) {
    this.repo = repoInstance;
    if (!repoInstance.full_name) {
        throw new Error('No full_name set for this instance.');
    }
    this.oss = repoInstance.oss;
    this.number = issueNumber;
    if (optionalInitialData) {
        throw new Error('optionalInitialData is not yet supported for the OpenSourceIssue type.');
    }
}

OpenSourceIssue.prototype.createComment = function (body, callback) {
    this.oss.createGenericGitHubClient().issue(this.repo.full_name, this.number).createComment({
        body: body
    }, callback);
};

OpenSourceIssue.prototype.update = function (patch, callback) {
    this.oss.createGenericGitHubClient().issue(this.repo.full_name, this.number).update(patch, callback);
};

OpenSourceIssue.prototype.close = function (callback) {
    this.oss.createGenericGitHubClient().issue(this.repo.full_name, this.number).update({
        state: 'closed',
    }, callback);
};

module.exports = OpenSourceIssue;
