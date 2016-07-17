//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();

router.get('/', function (req, res, next) {
  var repo = req.repo;
  var oss = repo.oss;
  oss.addBreadcrumb(req, 'Collaborators');
  repo.getOutsideCollaborators(function (error, outsideCollaborators, corporateCollaborators) {
    if (error) {
      return next(error);
    }
    var dc = oss.dataClient();
    dc.getAllEmployees(function (ignored, employees) {
      oss.render(req, res, 'org/team/repos/repo/collaborators', repo.name + ' Collaborators', {
        collaborators: outsideCollaborators,
        corporateCollaborators: corporateCollaborators,
        repoCollaboratorsUrl: req.teamReposUrl + repo.name + '/collaborators',
        employees: employees,
        repo: repo,
      });
    });
  });
});

router.post('/add', function (req, res, next) {
  var repo = req.repo;
  var username = req.body.username;
  var permissionLevel = req.body.permission;
  var corporateCollaborator = req.body.corporate;
  if (!(permissionLevel == 'admin' || permissionLevel == 'push' || permissionLevel == 'pull')) {
    return next(new Error('Permission level "' + permissionLevel + '" not recognized.'));
  }
  var oss = repo.oss;
  repo.addCollaborator(username, permissionLevel, function (error) {
    if (error) {
      return next(error);
    }
    // CONSIDER: Audit log.
    var collaboratorType = corporateCollaborator ? 'Corporate Collaborator' : 'Outside Collaborator';
    oss.saveUserAlert(req, 'Added or updated ' + username, collaboratorType);
    res.redirect(req.teamReposUrl + repo.name + '/collaborators');
  });
});

router.post('/:username/remove', function (req, res, next) {
  var repo = req.repo;
  var username = req.params.username;
  var oss = repo.oss;
  repo.removeCollaborator(username, function (error) {
    if (error) {
      return next(error);
    }
    // CONSIDER: Audit log.
    oss.saveUserAlert(req, 'Removed ' + username, 'Collaborator Removed');
    res.redirect(req.teamReposUrl + repo.name + '/collaborators');
  });
});

module.exports = router;
