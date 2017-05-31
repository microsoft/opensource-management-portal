var engine = new Bloodhound({
  name: 'allOrgsRepos',
  local: [],
  remote: {
    url: '/repos/search?q=%QUERY',
    wildcard: '%QUERY',
  },
  datumTokenizer: function(d) {
    return Bloodhound.tokenizers.whitespace(d.val);
  },
  queryTokenizer: Bloodhound.tokenizers.whitespace,
});

engine.initialize();

$('.typeahead').typeahead(null, {
  name: 'allOrgsRepos',
  displayKey: 'val',
  source: engine,
});
