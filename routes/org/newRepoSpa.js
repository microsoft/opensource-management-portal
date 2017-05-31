const express = require('express');
const router = express.Router();

router.get('/', function (req, res) {
  const org = req.org;
  const orgName = org.name.toLowerCase();
  org.oss.render(req, res, 'org/newRepoSpa', 'New repository', {
    orgName: orgName,
    orgConfig: org.inner.settings,
    org: org
  });
});

module.exports = router;