function displayRepoMetrics(repoId, orgId, companyName) {
  $('#metrics').hide();
  $.get('/api/client/metrics/repos/' + repoId, function (repoData) {
    if (!repoData.metrics[0]) {
      return;
    }
    displayStats(repoData.metrics[0]);
    $.get('/api/client/metrics/orgs/' + orgId, function (orgData) {
      $('#metrics').show();
      displayResponseTimesChart(repoData.metrics[0], orgData.metrics[0]);
      displayContributorsChart(repoData.metrics[0], companyName);
    });
  });
}

function displayStats(repoData) {
  $('#contributors').text(Number(repoData.Contributors).toLocaleString());
  $('#subscribers').text(Number(repoData.Subscribers).toLocaleString());
  $('#openIssues').text(Number(repoData.OpenIssues).toLocaleString());
  $('#assignedOpenIssues').text(Number(repoData.AssignedOpenIssues).toLocaleString());
  $('#unassignedOpenIssues').text(Number(repoData.UnassignedOpenIssues).toLocaleString());
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

function displayResponseTimesChart(repoData, orgData) {
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
  var colors = {
    'This repo': '#0078d7'
  };
  colors[orgData.OrgName + ' org'] = '#ffb900'; // Make IE happy
  c3.generate({
    bindto: '#avgResponsesChart',
    data: {
      x: 'x',
      columns: [
        ['x', 'Avg days to close PRs', 'Avg days for first response to PRs', 'Avg days to close issues', 'Avg days for first response to open issues'],
        ['This repo', repo.avgDaysToClosePRs, repo.avgDaysForFirstResponseToPRs, repo.avgDaysToCloseIssues, repo.avgDaysForFirstResponseToIssues],
        [orgData.OrgName + ' org', org.avgDaysToClosePRs, org.avgDaysForFirstResponseToPRs, org.avgDaysToCloseIssues, org.avgDaysForFirstResponseToIssues]
      ],
      type: 'bar',
      colors: colors
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

function displayContributorsChart(repoData, companyName) {
  if (repoData.CompanyContributors === 0 && repoData.CommunityContributors === 0) {
    $('#contributorsChartTitle').hide();
    return;
  }
  var colors = {
    'Community contributors': '#107c10'
  };
  colors[companyName + ' contributors'] = '#737373'; // Make IE happy
  c3.generate({
    bindto: '#contributorsChart',
    data: {
      columns: [
        [companyName + ' contributors', repoData.CompanyContributors],
        ['Community contributors', repoData.CommunityContributors]
      ],
      type: 'pie',
      colors: colors,
    },
    tooltip: {
      format: {
        value: function (value, ratio) {
          return d3.format('%')(ratio) + ' (' + value + ')';
        }
      }
    }
  });
}