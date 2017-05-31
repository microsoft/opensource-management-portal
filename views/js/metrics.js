function displayRepoMetrics(repoId, orgId) {
  $.get('/api/client/metrics/repos/' + repoId, function (repoData) {
    if (!repoData.metrics[0]) {
      $('#metrics').hide();
      return;
    }
    displayStats(repoData.metrics[0]);
    $.get('/api/client/metrics/orgs/' + orgId, function (orgData) {
      displayChart(repoData.metrics[0], orgData.metrics[0]);
    });
  });
}

function displayStats(repoData) {
  $('#contributors').text(Number(repoData.Contributors).toLocaleString());
  $('#subscribers').text(Number(repoData.Subscribers).toLocaleString());
  $('#openIssues').text(Number(repoData.OpenIssues).toLocaleString());
  $('#closedIssues').text(Number(repoData.ClosedIssues).toLocaleString());
  $('#pullRequests').text(Number(repoData.PullRequests).toLocaleString());
  $('#closedPullRequests').text(Number(repoData.ClosedPullRequests).toLocaleString());
  $('#openPullRequests').text(Number(repoData.OpenPullRequests).toLocaleString());
  $('#avgDaysToClosePRs').text(repoData.AvgDaysToClosePullRequests ? repoData.AvgDaysToClosePullRequests.toFixed(1).toLocaleString() : 0);
  $('#avgDaysForFirstResponseToPRs').text(repoData.AvgDaysForFirstResponseToPullRequests ? repoData.AvgDaysForFirstResponseToPullRequests.toFixed(1).toLocaleString() : 0);
  $('#prsClosedToday').text(repoData.PullRequestsClosedToday);
  $('#prsOpenedToday').text(repoData.PullRequestsOpenedToday);
  $('#avgDaysToCloseIssues').text(repoData.AvgDaysToCloseIssues ? repoData.AvgDaysToCloseIssues.toFixed(1).toLocaleString() : 0);
  $('#avgDaysForFirstResponseToIssues').text(repoData.AvgDaysForFirstResponseToIssues ? repoData.AvgDaysForFirstResponseToIssues.toFixed(1).toLocaleString() : 0);
  $('#openedIssuesToday').text(repoData.OpenedIssuesToday);
  $('#closedIssuesToday').text(repoData.ClosedIssuesToday);
  $('#commits').text(Number(repoData.Commits).toLocaleString());
  $('#linesCommitted').text(Number(repoData.LinesCommitted).toLocaleString());
  $('#commitsToday').text(repoData.CommitsToday);
  $('#linesCommittedToday').text(Number(repoData.LinesCommittedToday).toLocaleString());
}

function displayChart(repoData, orgData) {
  var repo = {
    avgDaysToClosePRs: repoData.AvgDaysToClosePullRequests ? repoData.AvgDaysToClosePullRequests.toFixed(1).toLocaleString() : 0,
    avgDaysForFirstResponseToPRs: repoData.AvgDaysForFirstResponseToPullRequests ? repoData.AvgDaysForFirstResponseToPullRequests.toFixed(1).toLocaleString() : 0,
    avgDaysToCloseIssues: repoData.AvgDaysToCloseIssues ? repoData.AvgDaysToCloseIssues.toFixed(1).toLocaleString() : 0,
    avgDaysForFirstResponseToIssues: repoData.AvgDaysForFirstResponseToIssues ? repoData.AvgDaysForFirstResponseToIssues.toFixed(1).toLocaleString() : 0
  };
  var org = {
    avgDaysToClosePRs: orgData.AvgDaysToClosePullRequests ? orgData.AvgDaysToClosePullRequests.toFixed(1).toLocaleString() : 0,
    avgDaysForFirstResponseToPRs: orgData.AvgDaysForFirstResponseToPullRequests ? orgData.AvgDaysForFirstResponseToPullRequests.toFixed(1).toLocaleString() : 0,
    avgDaysToCloseIssues: orgData.AvgDaysToCloseIssues ? orgData.AvgDaysToCloseIssues.toFixed(1).toLocaleString() : 0,
    avgDaysForFirstResponseToIssues: orgData.AvgDaysForFirstResponseToIssues ? orgData.AvgDaysForFirstResponseToIssues.toFixed(1).toLocaleString() : 0
  }
  c3.generate({
    bindto: '#metricsChart',
    data: {
      x: 'x',
      columns: [
        ['x', 'Avg days to close PRs', 'Avg days for first response to PRs', 'Avg days to close issues', 'Avg days for first response to open issues'],
        ['This repo', repo.avgDaysToClosePRs, repo.avgDaysForFirstResponseToPRs, repo.avgDaysToCloseIssues, repo.avgDaysForFirstResponseToIssues],
        [orgData.OrgName + ' org', org.avgDaysToClosePRs, org.avgDaysForFirstResponseToPRs, org.avgDaysToCloseIssues, org.avgDaysForFirstResponseToIssues],
      ],
      type: 'bar',
      colors: {
        'This repo': '#0078d7',
        [orgData.OrgName + ' org']: '#ffb900'
      }
    },
    axis: {
      x: {
        label: {
          position: 'bottom'
        },
        type: 'category'
      },
      y: {
        label: {
          text: 'Days',
          position: 'outermiddle'
        }
      }
    }
  });
}
