/* Chain Visualizer — loads chains.json and renders an interactive delegation tree */

const Visualizer = (() => {
  let allRoots = [];
  let activeFilter = 'all';
  let selectedNode = null;

  const STATUS_META = {
    dispatched:  { label: 'dispatched',  dotClass: 'dispatched', tagClass: 'tag-blue' },
    in_progress: { label: 'in progress', dotClass: 'active',     tagClass: 'tag-green' },
    delegating:  { label: 'delegating',  dotClass: 'dispatched', tagClass: 'tag-blue' },
    delegated:   { label: 'delegated',   dotClass: 'dispatched', tagClass: 'tag-blue' },
    returning:   { label: 'returning',   dotClass: 'returning',  tagClass: 'tag-orange' },
    closed:      { label: 'closed',      dotClass: 'closed',     tagClass: 'tag-gray' },
    blocked:     { label: 'blocked',     dotClass: 'blocked',    tagClass: 'tag-red' },
  };

  const AGENT_CLASS = {
    'Grok':       'agent-grok',
    'Claude Code': 'agent-claude',
    'Codex':      'agent-codex',
    'Hermes':     'agent-hermes',
  };

  function getStatusMeta(status) {
    return STATUS_META[status] || { label: status, dotClass: 'closed', tagClass: 'tag-gray' };
  }

  function slugToLabel(id) {
    return id
      .replace(/^\d{4}-\d{2}-\d{2}-from-/, '')
      .replace(/-to-/, ' → ')
      .replace(/-/g, ' ');
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderStatusBadge(status) {
    const meta = getStatusMeta(status);
    return `<span class="tag ${meta.tagClass}">${meta.label}</span>`;
  }

  function renderAgentBadge(agent) {
    const cls = AGENT_CLASS[agent] || 'agent-claude';
    return `<span class="agent-badge ${cls}">${agent}</span>`;
  }

  function filterRoots(roots) {
    if (activeFilter === 'all') return roots;
    if (activeFilter === 'active') return roots.filter(r => r.status !== 'closed');
    if (activeFilter === 'closed') return roots.filter(r => r.status === 'closed');
    return roots;
  }

  function renderDetailPanel(node, isRoot) {
    const meta = getStatusMeta(node.status);
    const delegationCount = isRoot ? (node.delegations || []).length : null;

    return `
      <div class="detail-title">${node.id}</div>
      <div class="detail-grid">
        <span class="detail-label">description</span>
        <span class="detail-value">${node.description}</span>

        <span class="detail-label">from</span>
        <span class="detail-value">${renderAgentBadge(node.from)}</span>

        <span class="detail-label">to</span>
        <span class="detail-value">${renderAgentBadge(node.to)}</span>

        <span class="detail-label">status</span>
        <span class="detail-value">${renderStatusBadge(node.status)}</span>

        <span class="detail-label">registered</span>
        <span class="detail-value">${formatDate(node.registered)}</span>

        ${delegationCount !== null ? `
        <span class="detail-label">delegations</span>
        <span class="detail-value">${delegationCount === 0 ? 'none' : delegationCount + ' sub-task' + (delegationCount > 1 ? 's' : '')}</span>
        ` : ''}
      </div>
    `;
  }

  function renderChainList(roots) {
    if (roots.length === 0) {
      return `<div style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.8rem;padding:var(--space-4);">
        No chains match the current filter.
      </div>`;
    }

    return roots.map(root => {
      const meta = getStatusMeta(root.status);
      const hasDelegations = root.delegations && root.delegations.length > 0;
      const rootId = 'root-' + root.id;

      const delegationHtml = hasDelegations
        ? root.delegations.map(d => {
            const dm = getStatusMeta(d.status);
            return `
              <div class="delegation-item" data-node-id="${d.id}" data-node-type="delegation" data-root-id="${root.id}">
                <span class="delegation-connector">╰─</span>
                <span class="status-dot ${dm.dotClass}"></span>
                ${renderAgentBadge(d.from)}
                <span style="color:var(--text-muted);font-size:0.65rem;">→</span>
                ${renderAgentBadge(d.to)}
                <span class="delegation-slug" title="${d.id}">${slugToLabel(d.id)}</span>
                <span class="tag ${dm.tagClass}" style="flex-shrink:0">${dm.label}</span>
              </div>
            `;
          }).join('')
        : `<div class="no-delegations">no sub-delegations</div>`;

      return `
        <div class="chain-root-item" id="${rootId}">
          <div class="chain-root-header" data-root-id="${root.id}" data-node-id="${root.id}" data-node-type="root">
            <span class="chain-toggle ${hasDelegations ? '' : 'no-toggle'}" data-toggle-id="${rootId}">▶</span>
            <span class="status-dot ${meta.dotClass}"></span>
            ${renderAgentBadge(root.from)}
            <span style="color:var(--text-muted);font-size:0.65rem;flex-shrink:0;">→</span>
            ${renderAgentBadge(root.to)}
            <span class="chain-root-slug" title="${root.id}">${slugToLabel(root.id)}</span>
            <span class="tag ${meta.tagClass}" style="flex-shrink:0">${meta.label}</span>
            <span class="chain-root-date">${root.date}</span>
          </div>
          <div class="chain-delegations" id="delegations-${rootId}">
            ${delegationHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function attachHandlers(container, detailPanel, rootsData) {
    const rootsMap = {};
    const delegationsMap = {};
    rootsData.forEach(r => {
      rootsMap[r.id] = r;
      (r.delegations || []).forEach(d => { delegationsMap[d.id] = d; });
    });

    container.addEventListener('click', e => {
      const toggle = e.target.closest('[data-toggle-id]');
      const nodeEl = e.target.closest('[data-node-id]');

      if (toggle && !nodeEl?.dataset?.nodeType?.includes('delegation')) {
        const delegId = 'delegations-' + toggle.dataset.toggleId;
        const delegEl = document.getElementById(delegId);
        if (delegEl) {
          const isOpen = delegEl.classList.contains('open');
          delegEl.classList.toggle('open');
          toggle.classList.toggle('open', !isOpen);
          toggle.textContent = isOpen ? '▶' : '▼';
        }
      }

      if (nodeEl) {
        const nodeId = nodeEl.dataset.nodeId;
        const nodeType = nodeEl.dataset.nodeType;

        document.querySelectorAll('.delegation-item.selected, .chain-root-item.selected').forEach(el => {
          el.classList.remove('selected');
        });

        let nodeData = null;
        let isRoot = false;

        if (nodeType === 'root') {
          nodeData = rootsMap[nodeId];
          isRoot = true;
          nodeEl.closest('.chain-root-item')?.classList.add('selected');
        } else if (nodeType === 'delegation') {
          nodeData = delegationsMap[nodeId];
          nodeEl.classList.add('selected');
        }

        if (nodeData) {
          selectedNode = nodeData;
          detailPanel.innerHTML = renderDetailPanel(nodeData, isRoot);
          detailPanel.classList.add('visible');
        }
      }
    });
  }

  async function init(containerId, detailId) {
    const container = document.getElementById(containerId);
    const detailPanel = document.getElementById(detailId);
    if (!container || !detailPanel) return;

    try {
      const res = await fetch('/data/chains.json');
      if (!res.ok) throw new Error('Failed to load chain data');
      const data = await res.json();
      allRoots = data.roots || [];

      function render() {
        const filtered = filterRoots(allRoots);
        container.innerHTML = `<div class="chain-list">${renderChainList(filtered)}</div>`;
        attachHandlers(container, detailPanel, filtered);
        if (selectedNode) { detailPanel.classList.remove('visible'); selectedNode = null; }
      }

      render();

      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeFilter = btn.dataset.filter;
          render();
        });
      });

    } catch (err) {
      container.innerHTML = `<div style="color:var(--text-muted);font-size:0.8rem;font-family:var(--font-mono);padding:var(--space-4);">
        Could not load chain data: ${err.message}
      </div>`;
    }
  }

  return { init };
})();
