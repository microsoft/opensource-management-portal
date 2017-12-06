/* eslint-env node */
module.exports = function(app) {
  var express = require('express');
  var releaseApprovalRouter = express.Router();

  releaseApprovalRouter.get('/', function (req, res) {
    setTimeout(() => {
      const releaseApprovals = [];
      for (let i = 0; i < 157; i++) {
        releaseApprovals.push({
          id: Number(1234567 + i),
          title: 'Test release name ' + Math.random().toString().substr(2, 5),
          state: i % 5 === 0 ? 'Pending Review' : 'Legal Review',
          url: 'https://local-witness.visualstudio.com/web/wi.aspx?pcguid=d517f115-4046-468e-a74d-a6bf8cd8add7&id=11319' + i,
          license: i%2 === 0 ? 'MIT' : 'Other'
        });
      }
      return res.json({
        releaseApprovals: releaseApprovals
      });
    }, 500);
  });

  releaseApprovalRouter.post('/', function (req, res) {
    console.log('Release approvals POST body:', req.body);
    const name = req.body[0].name;
    setTimeout(() => {
      if (name === 'error4') {
        return res.status(500).json({ message: 'Something bad happened while creating new release!' });
      }
      return res.json({
        releaseApprovals: [
          {
            id: 7654321,
            title: 'Test release approval ' + Math.random().toString().substr(2, 5),
            state: 'Legal Review',
            url: 'https://local-witness.visualstudio.com/web/wi.aspx?pcguid=d517f115-4046-468e-a74d-a6bf8cd8add7&id=11341'
          }
        ]
      });
    }, 500);
  });

  app.use('/api/client/releaseApprovals', require('body-parser').json());
  app.use('/api/client/releaseApprovals', releaseApprovalRouter);
};
