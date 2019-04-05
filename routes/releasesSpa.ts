import express = require('express');
import { ReposAppRequest } from '../transitional';
const router = express.Router();

router.get('/', function (req: ReposAppRequest, res) {
  req.reposContext = req.reposContext || {};
  req.reposContext.releaseTab = true;
  req.individualContext.webContext.render({
    view: './emberApp',
    title: 'Releases',
  });
});

module.exports = router;
