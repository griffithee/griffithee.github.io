/* Chain Visualizer - loads chains.json and renders an interactive delegation tree */

const Visualizer = (() => {
  let allRoots = [];
  let activeFilter = 'all';
  let activeView = 'svg';
  let selectedNode = null;
  let selectedNodeId = null;
  let selectedNodeType = null;
  let rootsMap = {};
  let delegationsMap = {};
  let containerRef = null;
  let detailPanelRef = null;
  let toolbarRef = null;

  const STATUS_META = {
    dispatched: { label: 'dispatched', dotClass: 'dispatched', tagClass: 'tag-blue' },
    in_progress: { label: 'in progress', dotClass: 'active', tagClass: 'tag-green' },
    delegating: { label: 'delegating', dotClass: 'dispatched', tagClass: 'tag-blue' },
    delegated: { label: 'delegated', dotClass: 'dispatched', tagClass: 'tag-blue' },
    returning: { label: 'returning', dotClass: 'returning', tagClass: 'tag-orange' },
    closed: { label: 'closed', dotClass: 'closed', tagClass: 'tag-gray' },
    blocked: { label: 'blocked', dotClass: 'blocked', tagClass: 'tag-red' },
  };

  const AGENT_CLASS = {
    Grok: 'agent-grok',
    'Claude Code': 'agent-claude',
    Codex: 'agent-codex',
    Hermes: 'agent-hermes',
  };

  const AGENT_COLOR = {
    Grok: 'var(--accent-purple)',
    'Claude Code': 'var(--accent-blue)',
    Codex: 'var(--accent-green)',
    Hermes: 'var(--accent-orange)',
  };

  const STATUS_COLOR = {
    dispatched: 'var(--accent-blue)',
    in_progress: 'var(--accent-green)',
    delegating: 'var(--accent-blue)',
    delegated: 'var(--accent-blue)',
    returning: 'var(--accent-orange)',
    closed: 'var(--text-muted)',
    blocked: 'var(--accent-orange)',
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugToLabel(id) {
    return String(id || '')
      .replace(/^\d{4}-\d{2}-\d{2}-from-/, '')
      .replace(/-to-/, ' -> ')
      .replace(/-/g, ' ');
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function truncateText(text, maxLength) {
    const value = String(text || '');
    if (value.length <= maxLength) return value;
    if (maxLength <= 3) return value.slice(0, maxLength);
    return `${value.slice(0, maxLength - 3)}...`;
  }

  function getStatusMeta(status) {
    return STATUS_META[status] || { label: status, dotClass: 'closed', tagClass: 'tag-gray' };
  }

  function getStatusColor(status) {
    return STATUS_COLOR[status] || 'var(--text-secondary)';
  }

  function getAgentColor(agent) {
    return AGENT_COLOR[agent] || 'var(--text-secondary)';
  }

  function renderStatusBadge(status) {
    const meta = getStatusMeta(status);
    return `<span class="tag ${meta.tagClass}">${escapeHtml(meta.label)}</span>`;
  }

  function renderAgentBadge(agent) {
    const cls = AGENT_CLASS[agent] || 'agent-claude';
    return `<span class="agent-badge ${cls}">${escapeHtml(agent)}</span>`;
  }

  function filterRoots(roots) {
    if (activeFilter === 'all') return roots;
    if (activeFilter === 'active') return roots.filter((r) => r.status !== 'closed');
    if (activeFilter === 'closed') return roots.filter((r) => r.status === 'closed');
    return roots;
  }

  function isSelectedNode(nodeId, nodeType) {
    return selectedNodeId === nodeId && selectedNodeType === nodeType;
  }

  function findSelectedNodeInRoots(roots) {
    if (!selectedNodeId || !selectedNodeType) return null;

    if (selectedNodeType === 'root') {
      const root = roots.find((r) => r.id === selectedNodeId);
      if (root) return { node: root, isRoot: true };
    }

    if (selectedNodeType === 'delegation') {
      for (const root of roots) {
        const match = (root.delegations || []).find((d) => d.id === selectedNodeId);
        if (match) return { node: match, isRoot: false, rootId: root.id };
      }
    }

    return null;
  }

  function renderDetailPanel(node, isRoot) {
    const delegationCount = isRoot ? (node.delegations || []).length : null;

    return `
      <div class="detail-title">${escapeHtml(node.id)}</div>
      <div class="detail-grid">
        <span class="detail-label">description</span>
        <span class="detail-value">${escapeHtml(node.description)}</span>

        <span class="detail-label">from</span>
        <span class="detail-value">${renderAgentBadge(node.from)}</span>

        <span class="detail-label">to</span>
        <span class="detail-value">${renderAgentBadge(node.to)}</span>

        <span class="detail-label">status</span>
        <span class="detail-value">${renderStatusBadge(node.status)}</span>

        <span class="detail-label">registered</span>
        <span class="detail-value">${escapeHtml(formatDate(node.registered))}</span>

        ${delegationCount !== null ? `
        <span class="detail-label">delegations</span>
        <span class="detail-value">${delegationCount === 0 ? 'none' : `${delegationCount} sub-task${delegationCount > 1 ? 's' : ''}`}</span>
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

    const selectedMatch = findSelectedNodeInRoots(roots);
    const openRootId = selectedMatch?.rootId || null;

    return roots.map((root) => {
      const meta = getStatusMeta(root.status);
      const delegations = Array.isArray(root.delegations) ? root.delegations : [];
      const hasDelegations = delegations.length > 0;
      const rootId = `root-${root.id}`;
      const delegationsOpen = openRootId === root.id;

      const delegationHtml = hasDelegations
        ? delegations
          .map((d) => {
            const dm = getStatusMeta(d.status);
            const selected = isSelectedNode(d.id, 'delegation') ? ' selected' : '';

            return `
              <div class="delegation-item${selected}" data-node-id="${escapeHtml(d.id)}" data-node-type="delegation" data-root-id="${escapeHtml(root.id)}">
                <span class="delegation-connector">L-</span>
                <span class="status-dot ${dm.dotClass}"></span>
                ${renderAgentBadge(d.from)}
                <span style="color:var(--text-muted);font-size:0.65rem;">-></span>
                ${renderAgentBadge(d.to)}
                <span class="delegation-slug" title="${escapeHtml(d.id)}">${escapeHtml(slugToLabel(d.id))}</span>
                <span class="tag ${dm.tagClass}" style="flex-shrink:0">${escapeHtml(dm.label)}</span>
              </div>
            `;
          })
          .join('')
        : `<div class="no-delegations">no sub-delegations</div>`;

      const selected = isSelectedNode(root.id, 'root') ? ' selected' : '';

      return `
        <div class="chain-root-item${selected}" id="${escapeHtml(rootId)}">
          <div class="chain-root-header" data-root-id="${escapeHtml(root.id)}" data-node-id="${escapeHtml(root.id)}" data-node-type="root">
            <span class="chain-toggle ${hasDelegations ? '' : 'no-toggle'}${delegationsOpen ? ' open' : ''}" data-toggle-id="${escapeHtml(rootId)}">${hasDelegations ? (delegationsOpen ? '▼' : '▶') : '·'}</span>
            <span class="status-dot ${meta.dotClass}"></span>
            ${renderAgentBadge(root.from)}
            <span style="color:var(--text-muted);font-size:0.65rem;flex-shrink:0;">-></span>
            ${renderAgentBadge(root.to)}
            <span class="chain-root-slug" title="${escapeHtml(root.id)}">${escapeHtml(slugToLabel(root.id))}</span>
            <span class="tag ${meta.tagClass}" style="flex-shrink:0">${escapeHtml(meta.label)}</span>
            <span class="chain-root-date">${escapeHtml(root.date)}</span>
          </div>
          <div class="chain-delegations${delegationsOpen ? ' open' : ''}" id="delegations-${escapeHtml(rootId)}">
            ${delegationHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function buildSvgLayout(roots) {
    const laneGap = 32;
    const rootWidth = 340;
    const rootHeight = 104;
    const childWidth = 240;
    const childHeight = 84;
    const placeholderWidth = 260;
    const placeholderHeight = 62;
    const childGap = 28;
    const topPadding = 24;
    const lanePadding = 24;
    const rootToBranchGap = 34;
    const branchToChildrenGap = 28;
    const bottomPadding = 28;

    const lanes = roots.map((root) => {
      const delegations = Array.isArray(root.delegations) ? root.delegations : [];
      const childCount = delegations.length;
      const contentWidth = childCount > 0
        ? childCount * childWidth + Math.max(0, childCount - 1) * childGap
        : placeholderWidth;
      const laneWidth = Math.max(rootWidth, contentWidth) + lanePadding * 2;
      const rootX = laneWidth / 2;
      const rootY = topPadding;
      const rootBottom = rootY + rootHeight;
      const branchY = rootBottom + rootToBranchGap;
      const childY = branchY + branchToChildrenGap;
      const childStartX = childCount > 0
        ? (laneWidth - contentWidth) / 2
        : (laneWidth - placeholderWidth) / 2;
      const childRowHeight = childCount > 0 ? childHeight : placeholderHeight;
      const laneHeight = childY + childRowHeight + bottomPadding;

      return {
        root,
        delegations,
        laneWidth,
        laneHeight,
        rootX,
        rootY,
        rootBottom,
        branchY,
        childY,
        childStartX,
        childWidth,
        childHeight,
        placeholderWidth,
        placeholderHeight,
      };
    });

    const overallWidth = Math.max(760, ...lanes.map((lane) => lane.laneWidth));
    const overallHeight = lanes.reduce((sum, lane) => sum + lane.laneHeight, 0) + Math.max(0, lanes.length - 1) * laneGap;

    return { lanes, overallWidth, overallHeight };
  }

  function renderSvgNode(node, options) {
    const {
      x,
      y,
      width,
      height,
      kind,
      selected,
      routeColor,
      statusColor,
      routeLabel,
      description,
      footerText,
      nodeType,
      nodeId,
      dataRootId,
    } = options;

    const kindLabel = kind === 'root' ? 'ROOT' : kind === 'delegation' ? 'DELEGATION' : 'EMPTY';
    const statusLabel = kind === 'placeholder' ? 'none' : getStatusMeta(node.status).label;
    const statusWidth = Math.max(72, statusLabel.length * 7 + 18);
    const fillOpacity = selected ? 0.24 : kind === 'placeholder' ? 0.08 : 0.14;
    const strokeWidth = selected ? 3.2 : 1.6;
    const routeText = truncateText(routeLabel, kind === 'root' ? 29 : 22);
    const descriptionText = kind === 'placeholder'
      ? 'No delegations'
      : truncateText(description, kind === 'root' ? 42 : 34);
    const footer = footerText || '';

    const rectFill = kind === 'placeholder' ? 'var(--bg-tertiary)' : routeColor;
    const textColor = kind === 'placeholder' ? 'var(--text-muted)' : 'var(--text-primary)';
    const secondaryColor = kind === 'placeholder' ? 'var(--text-muted)' : 'var(--text-secondary)';
    const roleAccent = kind === 'placeholder' ? 'var(--text-muted)' : routeColor;

    return `
      <g
        class="svg-node ${kind}${selected ? ' selected' : ''}"
        data-node-id="${escapeHtml(nodeId)}"
        data-node-type="${escapeHtml(nodeType)}"
        data-root-id="${escapeHtml(dataRootId)}"
        role="button"
        tabindex="0"
        aria-label="${escapeHtml(routeText)}"
        transform="translate(${x}, ${y})"
      >
        <title>${escapeHtml(routeText)} - ${escapeHtml(statusLabel)}</title>
        <rect
          x="0"
          y="0"
          width="${width}"
          height="${height}"
          rx="20"
          ry="20"
          class="node-card"
          fill="${rectFill}"
          fill-opacity="${fillOpacity}"
          stroke="${statusColor}"
          stroke-width="${strokeWidth}"
          vector-effect="non-scaling-stroke"
        ></rect>
        <rect
          x="14"
          y="14"
          width="${width - 28}"
          height="4"
          rx="2"
          fill="${roleAccent}"
          fill-opacity="0.92"
        ></rect>
        <rect
          x="${width - statusWidth - 14}"
          y="14"
          width="${statusWidth}"
          height="20"
          rx="10"
          fill="${statusColor}"
          fill-opacity="0.12"
          stroke="${statusColor}"
          stroke-opacity="0.7"
        ></rect>
        <text
          x="${width - statusWidth / 2 - 14}"
          y="28"
          text-anchor="middle"
          font-family="var(--font-mono)"
          font-size="10"
          fill="${statusColor}"
        >${escapeHtml(statusLabel)}</text>
        <text
          x="18"
          y="37"
          font-family="var(--font-mono)"
          font-size="10"
          font-weight="700"
          letter-spacing="0.08em"
          fill="${routeColor}"
        >${kindLabel}</text>
        <text
          x="18"
          y="60"
          font-family="var(--font-mono)"
          font-size="${kind === 'root' ? '18' : '15'}"
          font-weight="700"
          fill="${textColor}"
        >${escapeHtml(routeText)}</text>
        <text
          x="18"
          y="80"
          font-family="var(--font-mono)"
          font-size="12"
          fill="${secondaryColor}"
        >${escapeHtml(descriptionText)}</text>
        <text
          x="18"
          y="${height - 18}"
          font-family="var(--font-mono)"
          font-size="11"
          fill="${secondaryColor}"
        >${escapeHtml(footer)}</text>
      </g>
    `;
  }

  function renderSvgTree(roots) {
    if (roots.length === 0) {
      return `<div style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.8rem;padding:var(--space-4);">
        No chains match the current filter.
      </div>`;
    }

    const layout = buildSvgLayout(roots);
    const note = `
      <div style="margin-bottom:var(--space-3);color:var(--text-muted);font-family:var(--font-mono);font-size:0.72rem;">
        SVG tree view: click a node for details. Horizontal scrolling is enabled on narrow screens.
      </div>
    `;

    const svgContent = layout.lanes.map((lane, laneIndex) => {
      const laneX = (layout.overallWidth - lane.laneWidth) / 2;
      const laneY = layout.lanes
        .slice(0, laneIndex)
        .reduce((sum, previousLane) => sum + previousLane.laneHeight, 0) + Math.max(0, laneIndex) * 32;
      const root = lane.root;
      const rootSelected = isSelectedNode(root.id, 'root');
      const routeColor = getAgentColor(root.from);
      const statusColor = getStatusColor(root.status);
      const delegations = lane.delegations;
      const childCenters = delegations.map((_, index) => lane.childStartX + index * (lane.childWidth + 28) + lane.childWidth / 2);
      const rootBottom = lane.rootY + 104;

      const connectors = delegations.length > 0
        ? `
          <line
            x1="${lane.rootX}"
            y1="${rootBottom}"
            x2="${lane.rootX}"
            y2="${lane.branchY}"
            stroke="var(--border)"
            stroke-width="1.5"
            marker-end="url(#tree-arrow)"
          ></line>
          <line
            x1="${childCenters[0]}"
            y1="${lane.branchY}"
            x2="${childCenters[childCenters.length - 1]}"
            y2="${lane.branchY}"
            stroke="var(--border)"
            stroke-width="1.5"
          ></line>
          ${childCenters.map((childCenter) => `
            <line
              x1="${childCenter}"
              y1="${lane.branchY}"
              x2="${childCenter}"
              y2="${lane.childY}"
              stroke="var(--border)"
              stroke-width="1.5"
              marker-end="url(#tree-arrow)"
            ></line>
          `).join('')}
        `
        : `
          <line
            x1="${lane.rootX}"
            y1="${rootBottom}"
            x2="${lane.rootX}"
            y2="${lane.branchY}"
            stroke="var(--border)"
            stroke-width="1.5"
            marker-end="url(#tree-arrow)"
          ></line>
        `;

      const delegationNodes = delegations.length > 0
        ? delegations.map((delegation, index) => {
          const childX = lane.childStartX + index * (lane.childWidth + 28);
          const selected = isSelectedNode(delegation.id, 'delegation');
          return renderSvgNode(delegation, {
            x: childX,
            y: lane.childY,
            width: lane.childWidth,
            height: lane.childHeight,
            kind: 'delegation',
            selected,
            routeColor: getAgentColor(delegation.from),
            statusColor: getStatusColor(delegation.status),
            routeLabel: `${delegation.from} -> ${delegation.to}`,
            description: delegation.description,
            footerText: formatDate(delegation.registered),
            nodeType: 'delegation',
            nodeId: delegation.id,
            dataRootId: root.id,
          });
        }).join('')
        : renderSvgNode(root, {
          x: (lane.laneWidth - lane.placeholderWidth) / 2,
          y: lane.childY,
          width: lane.placeholderWidth,
          height: lane.placeholderHeight,
          kind: 'placeholder',
          selected: false,
          routeColor: 'var(--text-muted)',
          statusColor: 'var(--text-muted)',
          routeLabel: 'No delegations',
          description: 'No delegations',
          footerText: '',
          nodeType: 'placeholder',
          nodeId: `placeholder-${root.id}`,
          dataRootId: root.id,
        });

      return `
        <g transform="translate(${laneX}, ${laneY})">
          ${connectors}
          ${renderSvgNode(root, {
            x: lane.rootX - 170,
            y: lane.rootY,
            width: 340,
            height: 104,
            kind: 'root',
            selected: rootSelected,
            routeColor,
            statusColor,
            routeLabel: `${root.from} -> ${root.to}`,
            description: root.description,
            footerText: `${formatDate(root.date)}${delegations.length > 0 ? ` -> ${delegations.length} delegation${delegations.length > 1 ? 's' : ''}` : ' -> no delegations'}`,
            nodeType: 'root',
            nodeId: root.id,
            dataRootId: root.id,
          })}
          ${delegationNodes}
        </g>
      `;
    }).join('');

    return `
      ${note}
      <div style="overflow-x:auto;overflow-y:hidden;padding-bottom:var(--space-2);">
        <div style="min-width:${layout.overallWidth}px;">
          <svg
            width="${layout.overallWidth}"
            height="${layout.overallHeight}"
            viewBox="0 0 ${layout.overallWidth} ${layout.overallHeight}"
            role="img"
            aria-label="Agent delegation chain tree"
            style="display:block;margin:0 auto;"
          >
            <defs>
              <marker id="tree-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)"></path>
              </marker>
            </defs>
            <style>
              .svg-node { cursor: pointer; }
              .svg-node .node-card { transition: transform 0.15s ease, filter 0.15s ease; }
              .svg-node:hover .node-card { filter: brightness(1.04); }
              .svg-node.selected .node-card { stroke-width: 3.2; }
              .svg-node.selected text { font-weight: 700; }
            </style>
            ${svgContent}
          </svg>
        </div>
      </div>
    `;
  }

  function renderView(roots) {
    if (activeView === 'list') {
      return `<div class="chain-list">${renderChainList(roots)}</div>`;
    }
    return renderSvgTree(roots);
  }

  function clearSelection(detailPanel) {
    selectedNode = null;
    selectedNodeId = null;
    selectedNodeType = null;
    detailPanel.innerHTML = '';
    detailPanel.classList.remove('visible');
  }

  function syncSelectionHighlight(container, nodeEl, nodeType, nodeId) {
    container.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));

    if (!nodeEl) return;

    if (nodeType === 'root') {
      const rootItem = nodeEl.closest('.chain-root-item');
      if (rootItem) {
        rootItem.classList.add('selected');
      } else {
        nodeEl.classList.add('selected');
      }
    } else if (nodeType === 'delegation' || nodeType === 'placeholder') {
      nodeEl.classList.add('selected');
    }
  }

  function selectNode(nodeData, isRoot, nodeType, nodeEl) {
    selectedNode = nodeData;
    selectedNodeId = nodeData.id;
    selectedNodeType = nodeType;

    syncSelectionHighlight(containerRef, nodeEl, nodeType, nodeData.id);

    detailPanelRef.innerHTML = renderDetailPanel(nodeData, isRoot);
    detailPanelRef.classList.add('visible');
  }

  function bindHandlers(container, detailPanel) {
    if (container.dataset.visualizerBound === 'true') return;
    container.dataset.visualizerBound = 'true';

    container.addEventListener('click', (e) => {
      const toggle = e.target.closest?.('[data-toggle-id]');
      const nodeEl = e.target.closest?.('[data-node-id]');
      const nodeId = nodeEl?.dataset?.nodeId || nodeEl?.getAttribute('data-node-id');
      const nodeType = nodeEl?.dataset?.nodeType || nodeEl?.getAttribute('data-node-type');

      if (toggle && (!nodeType || nodeType !== 'delegation')) {
        const delegId = `delegations-${toggle.dataset.toggleId}`;
        const delegEl = document.getElementById(delegId);
        if (delegEl) {
          const isOpen = delegEl.classList.contains('open');
          delegEl.classList.toggle('open');
          toggle.classList.toggle('open', !isOpen);
          toggle.textContent = isOpen ? '▶' : '▼';
        }
      }

      if (!nodeEl || !nodeId || !nodeType || nodeType === 'placeholder') return;

      let nodeData = null;
      let isRoot = false;

      if (nodeType === 'root') {
        nodeData = rootsMap[nodeId];
        isRoot = true;
      } else if (nodeType === 'delegation') {
        nodeData = delegationsMap[nodeId];
      }

      if (!nodeData) return;

      selectNode(nodeData, isRoot, nodeType, nodeEl);
    });

    container.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const nodeEl = e.target.closest?.('[data-node-id]');
      if (!nodeEl) return;
      e.preventDefault();
      nodeEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  function ensureToolbarControls(toolbar) {
    if (!toolbar || toolbar.querySelector('[data-view-toggle]')) return;

    const viewControls = document.createElement('div');
    viewControls.className = 'filter-btns';
    viewControls.dataset.viewToggle = 'true';
    viewControls.style.marginLeft = 'auto';
    viewControls.innerHTML = `
      <button class="filter-btn active" type="button" data-view="svg">svg</button>
      <button class="filter-btn" type="button" data-view="list">list</button>
    `;

    toolbar.appendChild(viewControls);
  }

  function updateViewButtons(toolbar) {
    toolbar.querySelectorAll('[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === activeView);
    });
  }

  function updateSelectedDetailPanel(filteredRoots) {
    const selected = findSelectedNodeInRoots(filteredRoots);
    if (!selected) {
      clearSelection(detailPanelRef);
      return;
    }

    selectedNode = selected.node;
    detailPanelRef.innerHTML = renderDetailPanel(selected.node, selected.isRoot);
    detailPanelRef.classList.add('visible');
  }

  async function init(containerId, detailId) {
    const container = document.getElementById(containerId);
    const detailPanel = document.getElementById(detailId);
    if (!container || !detailPanel) return;

    containerRef = container;
    detailPanelRef = detailPanel;

    const toolbar = container.closest('.visualizer-wrap')?.querySelector('.visualizer-toolbar');
    toolbarRef = toolbar || null;
    ensureToolbarControls(toolbarRef);

    try {
      const res = await fetch('/data/chains.json');
      if (!res.ok) throw new Error('Failed to load chain data');
      const data = await res.json();

      allRoots = Array.isArray(data.roots) ? data.roots : [];
      rootsMap = {};
      delegationsMap = {};

      allRoots.forEach((root) => {
        rootsMap[root.id] = root;
        (root.delegations || []).forEach((delegation) => {
          delegationsMap[delegation.id] = delegation;
        });
      });

      function render() {
        const filtered = filterRoots(allRoots);
        container.innerHTML = renderView(filtered);
        bindHandlers(container, detailPanel);
        updateSelectedDetailPanel(filtered);
        if (toolbarRef) updateViewButtons(toolbarRef);
      }

      render();

      toolbarRef?.querySelectorAll('[data-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          toolbarRef.querySelectorAll('[data-filter]').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          activeFilter = btn.dataset.filter;
          render();
        });
      });

      toolbarRef?.querySelectorAll('[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeView = btn.dataset.view;
          render();
        });
      });
    } catch (err) {
      container.innerHTML = `<div style="color:var(--text-muted);font-size:0.8rem;font-family:var(--font-mono);padding:var(--space-4);">
        Could not load chain data: ${escapeHtml(err.message)}
      </div>`;
    }
  }

  return { init };
})();
