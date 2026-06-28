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
    fitness: 'fitness',
    infrastructure: 'infrastructure',
    experiment: 'experiment',
  };

  function init() {
    var container = document.getElementById('projects-browser-container');
    if (!container) return;

    fetch('data/projects.json')
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to load project data');
        return r.json();
      })
      .then(function (data) { render(container, data); })
      .catch(function () {
        container.innerHTML =
          '<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.8rem;">Could not load project data.</p>';
      });
  }

  function render(container, data) {
    var projects = Array.isArray(data && data.projects) ? data.projects : [];
    var updatedDate = data && typeof data.updated === 'string' ? data.updated : '';
    var tags = collectTags(projects);

    var filterHtml = tags.map(function (tag) {
      return '<button class="filter-btn' + (tag === 'all' ? ' active' : '') +
        '" data-filter="' + escHtml(tag) + '">' + escHtml(FILTER_LABELS[tag] || tag) + '</button>';
    }).join('');

    var cardsHtml = projects.map(renderCard).join('');

    var metaLine = updatedDate
      ? '<p style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono);margin-top:var(--space-4);">data/projects.json · last updated ' + escHtml(updatedDate) + '</p>'
      : '';
    var emptyState = projects.length === 0
      ? '<div style="padding:var(--space-4);color:var(--text-muted);font-family:var(--font-mono);font-size:0.8rem;border:1px dashed var(--border);border-radius:var(--radius-md);">No project entries available.</div>'
      : '';

    container.innerHTML =
      '<div class="filter-btns" id="pb-filters">' + filterHtml + '</div>' +
      '<div class="card-grid" id="pb-grid" style="margin-top:var(--space-4);">' + (cardsHtml || emptyState) + '</div>' +
      metaLine;

    wireFilters(container);
  }

  function collectTags(projects) {
    var seen = Object.create(null);
    seen.all = true;
    var order = ['all', 'active', 'production', 'prototype', 'writing', 'fitness', 'infrastructure', 'experiment'];
    var extra = [];
    projects.forEach(function (p) {
      var item = p && typeof p === 'object' ? p : {};
      var tags = Array.isArray(item.tags) ? item.tags : [];
      tags.forEach(function (t) {
        if (typeof t !== 'string') return;
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
    p = p && typeof p === 'object' ? p : {};

    var name = safeText(p.name, 'Untitled project');
    var desc = safeText(p.desc, 'No description available');
    var status = safeText(p.status, 'unknown');
    var agents = Array.isArray(p.agents)
      ? p.agents.filter(function (a) { return typeof a === 'string' && a.trim(); })
      : [];
    var tags = Array.isArray(p.tags) ? p.tags.filter(function (t) { return typeof t === 'string'; }) : [];
    var agentBadges = agents.length > 0 ? agents.map(function (a) {
      if (AGENT_CLASS[a]) {
        return '<span class="agent-badge ' + AGENT_CLASS[a] + '">' + escHtml(a) + '</span>';
      }
      return '<span class="tag tag-gray">' + escHtml(a) + '</span>';
    }).join('') : '<span class="tag tag-gray">agents unknown</span>';

    var statusClass = STATUS_TAG_CLASS[status] || 'tag-gray';
    var isDashed = status === 'scaffolded';
    var href = safeHref(p.link);
    var detailsHtml = href
      ? '<a href="' + href + '" style="font-size:0.75rem;color:var(--text-muted);margin-left:auto;">details →</a>'
      : '<span style="font-size:0.75rem;color:var(--text-muted);margin-left:auto;">details unavailable</span>';

    return '<article class="card" data-tags="' + escHtml(tags.join(',')) + '"' +
      (isDashed ? ' style="border-style:dashed;opacity:0.7;"' : '') + '>' +
      '<div class="card-header">' +
      '<div class="card-title">' + escHtml(name) + '</div>' +
      '<span class="tag ' + statusClass + '">' + escHtml(status) + '</span>' +
      '</div>' +
      '<p class="card-desc">' + escHtml(desc) + '</p>' +
      '<div class="card-meta">' + agentBadges +
      detailsHtml +
      '</div></article>';
  }

  function safeText(value, fallback) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return fallback || '';
    }

    var text = String(value).trim();
    return text || fallback || '';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeHref(value) {
    if (!value) return '';

    try {
      var raw = String(value).trim();
      if (!raw) return '';

      var url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return '';
      var allowed = ['http:', 'https:'];
      if (allowed.indexOf(url.protocol) === -1) return '';
      return escHtml(url.href);
    } catch (err) {
      return '';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
