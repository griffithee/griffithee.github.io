// Projects browser: filterable card grid loaded from data/projects.json
(function () {
  'use strict';

  var AGENT_CLASS = {
    Grok: 'agent-grok',
    Claude: 'agent-claude',
    Codex: 'agent-codex',
    Hermes: 'agent-hermes',
  };

  var STATUS_TAG_CLASS = {
    production: 'tag-green',
    active: 'tag-blue',
    prototype: 'tag-orange',
    scaffolded: 'tag-gray',
  };

  var FILTER_LABELS = {
    all: 'all',
    active: 'active',
    production: 'production',
    prototype: 'prototype',
    writing: 'writing',
    infrastructure: 'infrastructure',
    experiment: 'experiment',
  };

  function init() {
    var container = document.getElementById('projects-browser-container');
    if (!container) return;

    fetch('data/projects.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { render(container, data.projects, data.updated); })
      .catch(function () {
        container.innerHTML =
          '<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.8rem;">Could not load project data.</p>';
      });
  }

  function render(container, projects, updatedDate) {
    var tags = collectTags(projects);

    var filterHtml = tags.map(function (tag) {
      return '<button class="filter-btn' + (tag === 'all' ? ' active' : '') +
        '" data-filter="' + tag + '">' + (FILTER_LABELS[tag] || tag) + '</button>';
    }).join('');

    var cardsHtml = projects.map(renderCard).join('');

    var metaLine = updatedDate
      ? '<p style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono);margin-top:var(--space-4);">data/projects.json · last updated ' + updatedDate + '</p>'
      : '';

    container.innerHTML =
      '<div class="filter-btns" id="pb-filters">' + filterHtml + '</div>' +
      '<div class="card-grid" id="pb-grid" style="margin-top:var(--space-4);">' + cardsHtml + '</div>' +
      metaLine;

    wireFilters(container);
  }

  function collectTags(projects) {
    var seen = { all: true };
    var order = ['all', 'active', 'production', 'prototype', 'writing', 'infrastructure', 'experiment'];
    var extra = [];
    projects.forEach(function (p) {
      (p.tags || []).forEach(function (t) {
        if (!seen[t]) { seen[t] = true; extra.push(t); }
      });
    });
    return order.filter(function (t) { return seen[t]; }).concat(
      extra.filter(function (t) { return order.indexOf(t) === -1; })
    );
  }

  function wireFilters(container) {
    var grid = container.querySelector('#pb-grid');
    container.querySelector('#pb-filters').addEventListener('click', function (e) {
      var btn = e.target;
      if (!btn.classList.contains('filter-btn')) return;
      var filter = btn.dataset.filter;

      container.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      grid.querySelectorAll('.card[data-tags]').forEach(function (card) {
        var cardTags = card.dataset.tags.split(',');
        card.style.display = (filter === 'all' || cardTags.indexOf(filter) !== -1) ? '' : 'none';
      });
    });
  }

  function renderCard(p) {
    var agentBadges = (p.agents || []).map(function (a) {
      return '<span class="agent-badge ' + (AGENT_CLASS[a] || 'agent-claude') + '">' + a + '</span>';
    }).join('');

    var statusClass = STATUS_TAG_CLASS[p.status] || 'tag-gray';
    var isDashed = p.status === 'scaffolded';

    return '<article class="card" data-tags="' + (p.tags || []).join(',') + '"' +
      (isDashed ? ' style="border-style:dashed;opacity:0.7;"' : '') + '>' +
      '<div class="card-header">' +
      '<div class="card-title">' + escHtml(p.name) + '</div>' +
      '<span class="tag ' + statusClass + '">' + escHtml(p.status) + '</span>' +
      '</div>' +
      '<p class="card-desc">' + escHtml(p.desc) + '</p>' +
      '<div class="card-meta">' + agentBadges +
      '<a href="' + p.link + '" style="font-size:0.75rem;color:var(--text-muted);margin-left:auto;">details →</a>' +
      '</div></article>';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
