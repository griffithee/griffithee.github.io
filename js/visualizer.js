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
  let svgZoom = 1;
  let svgPanX = 0;
  let svgPanY = 0;

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
    if (typeof isoStr !== 'string' || !isoStr.trim()) return '';
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

  function safeText(value, fallback) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return fallback || '';
    }

    const text = String(value).trim();
    return text || fallback || '';
  }

  function isValidNode(node) {
    return !!node && typeof node === 'object' && typeof node.id === 'string';
  }

  function sanitizeDelegations(delegations) {
    if (!Array.isArray(delegations)) return [];
    return delegations.filter(isValidNode);
  }

  function sanitizeRoots(roots) {
    if (!Array.isArray(roots)) return [];

    return roots
      .filter(isValidNode)
      .map((root) => ({
        ...root,
        delegations: sanitizeDelegations(root.delegations),
      }));
  }

  /* Word-wrap text into at most 2 lines, breaking at word boundaries. */
  function wrapText(text, chars1, chars2) {
    const value = String(text || '');
    if (!value || value.length <= chars1) return { line1: value, line2: '' };
    const words = value.split(' ');
    let line1 = '';
    let line2 = '';
    for (const word of words) {
      if (!line1) { line1 = word; continue; }
      if ((line1 + ' ' + word).length <= chars1) {
        line1 += ' ' + word;
      } else if (!line2) {
        line2 = word;
      } else if ((line2 + ' ' + word).length <= chars2) {
        line2 += ' ' + word;
      } else {
        line2 = truncateText(line2 + ' ' + word, chars2);
        break;
      }
    }
    if (!line1) {
      line1 = truncateText(value, chars1);
    } else if (line1.length > chars1) {
      line1 = truncateText(line1, chars1);
    }
    return { line1, line2 };
  }

  /* Responsive layout configuration based on container width. */
  function getLayoutConfig(containerWidth) {
    const compact = containerWidth > 0 && containerWidth < 580;
    return {
      rootWidth: compact ? 260 : 340,
      rootHeight: compact ? 100 : 116,
      baseChildWidth: compact ? 190 : 240,
      childHeight: compact ? 86 : 96,
      placeholderWidth: compact ? 200 : 260,
      placeholderHeight: compact ? 56 : 66,
      childGap: compact ? 16 : 28,
      laneGap: compact ? 20 : 32,
      lanePadding: compact ? 16 : 24,
      childDropGap: compact ? 44 : 62,
      topPadding: compact ? 16 : 24,
      bottomPadding: compact ? 16 : 28,
      compact,
    };
  }

  function getStatusMeta(status) {
    const value = typeof status === 'string' ? status : '';
    return STATUS_META[value] || { label: safeText(value, 'unknown'), dotClass: 'closed', tagClass: 'tag-gray' };
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
    const cls = AGENT_CLASS[agent];
    if (!cls) {
      return `<span class="tag tag-gray">${escapeHtml(agent || 'Unknown')}</span>`;
    }
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
    const description = safeText(node.description, 'No description available');
    const from = safeText(node.from, 'Unknown');
    const to = safeText(node.to, 'Unknown');
    const registered = formatDate(node.registered) || 'unknown';

    return `
      <div class="detail-title">${escapeHtml(node.id)}</div>
      <div class="detail-grid">
        <span class="detail-label">description</span>
        <span class="detail-value">${escapeHtml(description)}</span>

        <span class="detail-label">from</span>
        <span class="detail-value">${renderAgentBadge(from)}</span>

        <span class="detail-label">to</span>
        <span class="detail-value">${renderAgentBadge(to)}</span>

        <span class="detail-label">status</span>
        <span class="detail-value">${renderStatusBadge(node.status)}</span>

        <span class="detail-label">registered</span>
        <span class="detail-value">${escapeHtml(registered)}</span>

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

  function buildSvgLayout(roots, containerWidth) {
    const cfg = getLayoutConfig(containerWidth || 0);
    const {
      laneGap, rootHeight, childHeight, placeholderWidth, placeholderHeight,
      childGap, topPadding, lanePadding, childDropGap, bottomPadding,
    } = cfg;

    const lanes = roots.map((root) => {
      const delegations = Array.isArray(root.delegations) ? root.delegations : [];
      const childCount = delegations.length;

      /* Shrink child nodes gracefully for 5+ siblings. */
      let childWidth = cfg.baseChildWidth;
      if (childCount >= 5) childWidth = Math.max(140, cfg.baseChildWidth - (childCount - 4) * 14);

      const rootWidth = Math.max(cfg.rootWidth, childWidth);
      const contentWidth = childCount > 0
        ? childCount * childWidth + Math.max(0, childCount - 1) * childGap
        : placeholderWidth;
      const laneWidth = Math.max(rootWidth, contentWidth) + lanePadding * 2;
      const rootX = laneWidth / 2;
      const rootY = topPadding;
      const rootBottom = rootY + rootHeight;
      /* childDropGap is total vertical space from root bottom to child top. */
      const childY = rootBottom + childDropGap;
      const childStartX = childCount > 0
        ? (laneWidth - contentWidth) / 2
        : (laneWidth - placeholderWidth) / 2;
      const childRowHeight = childCount > 0 ? childHeight : placeholderHeight;
      const laneHeight = childY + childRowHeight + bottomPadding;

      return {
        root,
        delegations,
        cfg,
        childWidth,
        rootWidth,
        laneWidth,
        laneHeight,
        rootX,
        rootY,
        rootBottom,
        childY,
        childStartX,
        childHeight,
        placeholderWidth,
        placeholderHeight,
      };
    });

    const overallWidth = Math.max(760, ...lanes.map((lane) => lane.laneWidth));
    const overallHeight = lanes.reduce((sum, lane) => sum + lane.laneHeight, 0)
      + Math.max(0, lanes.length - 1) * laneGap;

    return { lanes, overallWidth, overallHeight, cfg };
  }

  function renderSvgNode(node, options) {
    const {
      x, y, width, height, kind, selected,
      routeColor, statusColor, routeLabel, description,
      footerText, nodeType, nodeId, dataRootId,
    } = options;

    const kindLabel = kind === 'root' ? 'ROOT' : kind === 'delegation' ? 'DELEGATION' : 'EMPTY';
    const statusLabel = kind === 'placeholder' ? 'none' : getStatusMeta(node.status).label;
    const statusWidth = Math.max(72, statusLabel.length * 7 + 18);
    const fillOpacity = selected ? 0.24 : kind === 'placeholder' ? 0.08 : 0.14;
    const strokeWidth = selected ? 3.2 : 1.6;

    const routeMaxChars = kind === 'root' ? 29 : 22;
    const routeText = truncateText(routeLabel, routeMaxChars);
    const routeFontSize = kind === 'root' ? 18 : 15;

    /* Two-line word-wrapped description; only use second line if height allows. */
    const descChars = kind === 'root' ? 44 : 34;
    const descLines = kind === 'placeholder'
      ? { line1: 'No delegations', line2: '' }
      : wrapText(description, descChars, descChars);

    const footer = footerText || '';
    const rectFill = kind === 'placeholder' ? 'var(--bg-tertiary)' : routeColor;
    const textColor = kind === 'placeholder' ? 'var(--text-muted)' : 'var(--text-primary)';
    const secondaryColor = kind === 'placeholder' ? 'var(--text-muted)' : 'var(--text-secondary)';
    const roleAccent = kind === 'placeholder' ? 'var(--text-muted)' : routeColor;

    /* Compute y positions so nothing overlaps regardless of height. */
    const kindY = 37;
    const routeY = kindY + 12 + (kind === 'root' ? 7 : 4);
    const descY1 = routeY + routeFontSize + 4;
    const descY2 = descY1 + 14;
    const footerY = height - 10;

    const isInteractive = nodeType !== 'placeholder';
    const hasDelegations = isInteractive && nodeType === 'root' && node.delegations && node.delegations.length > 0;
    const ariaSelected = isInteractive ? ` aria-selected="${selected}"` : '';
    const ariaExpanded = hasDelegations ? ` aria-expanded="true"` : '';
    const roleAttr = isInteractive ? 'treeitem' : 'presentation';
    const tabIndex = isInteractive ? '0' : '-1';

    return `
      <g
        class="svg-node ${kind}${selected ? ' selected' : ''}"
        data-node-id="${escapeHtml(nodeId)}"
        data-node-type="${escapeHtml(nodeType)}"
        data-root-id="${escapeHtml(dataRootId)}"
        role="${roleAttr}"${ariaSelected}${ariaExpanded}
        tabindex="${tabIndex}"
        aria-label="${escapeHtml(routeLabel)} — ${escapeHtml(statusLabel)}"
        transform="translate(${x}, ${y})"
      >
        <title>${escapeHtml(routeLabel)} — ${escapeHtml(statusLabel)}${description ? ': ' + escapeHtml(description) : ''}</title>
        <rect
          x="0" y="0" width="${width}" height="${height}" rx="20" ry="20"
          class="node-card"
          fill="${rectFill}" fill-opacity="${fillOpacity}"
          stroke="${statusColor}" stroke-width="${strokeWidth}"
          vector-effect="non-scaling-stroke"
        ></rect>
        <rect x="14" y="14" width="${width - 28}" height="4" rx="2"
          fill="${roleAccent}" fill-opacity="0.92"
        ></rect>
        <rect x="${width - statusWidth - 14}" y="14" width="${statusWidth}" height="20" rx="10"
          fill="${statusColor}" fill-opacity="0.12"
          stroke="${statusColor}" stroke-opacity="0.7"
        ></rect>
        <text
          x="${width - statusWidth / 2 - 14}" y="28"
          text-anchor="middle"
          font-family="var(--font-mono)" font-size="10"
          fill="${statusColor}"
        >${escapeHtml(statusLabel)}</text>
        <text
          x="18" y="${kindY}"
          font-family="var(--font-mono)" font-size="10" font-weight="700" letter-spacing="0.08em"
          fill="${routeColor}"
        >${kindLabel}</text>
        <text
          x="18" y="${routeY}"
          font-family="var(--font-mono)" font-size="${routeFontSize}" font-weight="700"
          fill="${textColor}"
        >${escapeHtml(routeText)}</text>
        <text
          x="18" y="${descY1}"
          font-family="var(--font-mono)" font-size="12"
          fill="${secondaryColor}"
        >${escapeHtml(descLines.line1)}${descLines.line2 ? `<tspan x="18" dy="14">${escapeHtml(descLines.line2)}</tspan>` : ''}</text>
        <text
          x="18" y="${footerY}"
          font-family="var(--font-mono)" font-size="11"
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

    const containerWidth = containerRef ? containerRef.offsetWidth : 0;
    const layout = buildSvgLayout(roots, containerWidth);
    const laneGap = layout.cfg.laneGap;

    const svgContent = layout.lanes.map((lane, laneIndex) => {
      const laneX = (layout.overallWidth - lane.laneWidth) / 2;
      const laneY = layout.lanes
        .slice(0, laneIndex)
        .reduce((sum, prev) => sum + prev.laneHeight, 0) + laneIndex * laneGap;

      const root = lane.root;
      const rootSelected = isSelectedNode(root.id, 'root');
      const rootFrom = safeText(root.from, 'Unknown');
      const rootTo = safeText(root.to, 'Unknown');
      const routeColor = getAgentColor(root.from);
      const statusColor = getStatusColor(root.status);
      const delegations = lane.delegations;
      const childGap = lane.cfg.childGap;

      const childCenters = delegations.map(
        (_, i) => lane.childStartX + i * (lane.childWidth + childGap) + lane.childWidth / 2,
      );
      /* Bezier control point: midway between root bottom and child top. */
      const midY = lane.rootBottom + (lane.childY - lane.rootBottom) / 2;

      /* Smooth S-curves from root bottom-center to each child top-center. */
      const connectors = delegations.length > 0
        ? childCenters.map((cx) => `
            <path
              d="M ${lane.rootX},${lane.rootBottom} C ${lane.rootX},${midY} ${cx},${midY} ${cx},${lane.childY}"
              fill="none" stroke="var(--border)" stroke-width="1.5"
              marker-end="url(#tree-arrow)"
            ></path>
          `).join('')
        : `<path
            d="M ${lane.rootX},${lane.rootBottom} L ${lane.rootX},${lane.childY + 12}"
            fill="none" stroke="var(--border)" stroke-width="1.5"
            marker-end="url(#tree-arrow)"
          ></path>`;

      const delegationNodes = delegations.length > 0
        ? delegations.map((delegation, i) => {
          const childX = lane.childStartX + i * (lane.childWidth + childGap);
          const selected = isSelectedNode(delegation.id, 'delegation');
          return renderSvgNode(delegation, {
            x: childX, y: lane.childY,
            width: lane.childWidth, height: lane.childHeight,
            kind: 'delegation', selected,
            routeColor: getAgentColor(delegation.from),
            statusColor: getStatusColor(delegation.status),
            routeLabel: `${safeText(delegation.from, 'Unknown')} -> ${safeText(delegation.to, 'Unknown')}`,
            description: delegation.description,
            footerText: formatDate(delegation.registered) || 'unknown',
            nodeType: 'delegation', nodeId: delegation.id,
            dataRootId: root.id,
          });
        }).join('')
        : renderSvgNode(root, {
          x: (lane.laneWidth - lane.placeholderWidth) / 2, y: lane.childY,
          width: lane.placeholderWidth, height: lane.placeholderHeight,
          kind: 'placeholder', selected: false,
          routeColor: 'var(--text-muted)', statusColor: 'var(--text-muted)',
          routeLabel: 'No delegations', description: 'No delegations',
          footerText: '', nodeType: 'placeholder', nodeId: `placeholder-${root.id}`,
          dataRootId: root.id,
        });

      return `
          <g transform="translate(${laneX}, ${laneY})" role="group"
           aria-label="${escapeHtml(rootFrom)} to ${escapeHtml(rootTo)} delegation chain">
          ${connectors}
          ${renderSvgNode(root, {
            x: lane.rootX - lane.rootWidth / 2, y: lane.rootY,
            width: lane.rootWidth, height: lane.cfg.rootHeight,
            kind: 'root', selected: rootSelected,
            routeColor, statusColor,
            routeLabel: `${rootFrom} -> ${rootTo}`,
            description: root.description,
            footerText: `${formatDate(root.date) || 'unknown'}${delegations.length > 0 ? ` · ${delegations.length} delegation${delegations.length > 1 ? 's' : ''}` : ' · no delegations'}`,
            nodeType: 'root', nodeId: root.id,
            dataRootId: root.id,
          })}
          ${delegationNodes}
        </g>
      `;
    }).join('');

    const zoomTransform = `translate(${svgPanX}px, ${svgPanY}px) scale(${svgZoom})`;

    return `
      <div style="margin-bottom:var(--space-3);color:var(--text-muted);font-family:var(--font-mono);font-size:0.72rem;"
           aria-live="polite" id="viz-announce">
        SVG tree view — click a node for details. Use +/− or scroll to zoom.
      </div>
      <div class="viz-svg-wrap" style="position:relative;">
        <div class="viz-zoom-controls" style="position:absolute;top:8px;right:8px;z-index:2;display:flex;gap:4px;">
          <button class="viz-zoom-btn" data-zoom="in" type="button" title="Zoom in"
            style="background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-secondary);width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:15px;line-height:1;padding:0;">+</button>
          <button class="viz-zoom-btn" data-zoom="out" type="button" title="Zoom out"
            style="background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-secondary);width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:15px;line-height:1;padding:0;">−</button>
          <button class="viz-zoom-btn" data-zoom="reset" type="button" title="Reset zoom"
            style="background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-secondary);width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1;padding:0;">⊙</button>
        </div>
        <div class="viz-svg-scroll" style="overflow-x:auto;overflow-y:hidden;padding-bottom:var(--space-2);">
          <div class="viz-svg-inner" style="min-width:${layout.overallWidth}px;transform-origin:top left;transform:${zoomTransform};">
            <svg
              width="${layout.overallWidth}"
              height="${layout.overallHeight}"
              viewBox="0 0 ${layout.overallWidth} ${layout.overallHeight}"
              role="tree"
              aria-label="Agent delegation chain tree"
              style="display:block;margin:0 auto;"
            >
              <defs>
                <marker id="tree-arrow" viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)"></path>
                </marker>
              </defs>
              <style>
                .svg-node { cursor: pointer; }
                .svg-node .node-card { transition: filter 0.15s ease; }
                .svg-node:hover .node-card { filter: brightness(1.14); }
                .svg-node.selected .node-card { stroke-width: 3.2 !important; }
                .svg-node:focus { outline: none; }
                .svg-node:focus-visible .node-card {
                  filter: brightness(1.18) drop-shadow(0 0 5px rgba(88,166,255,0.5));
                  stroke-width: 2.8 !important;
                }
                @media (prefers-reduced-motion: reduce) {
                  .svg-node .node-card { transition: none; }
                }
              </style>
              ${svgContent}
            </svg>
          </div>
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

  function syncSelectionHighlight(container, nodeEl, nodeType) {
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

    syncSelectionHighlight(containerRef, nodeEl, nodeType);

    detailPanelRef.innerHTML = renderDetailPanel(nodeData, isRoot);
    detailPanelRef.classList.add('visible');
  }

  /* Apply zoom/pan transform directly to the inner wrapper (no re-render). */
  function applyZoomTransform(container) {
    const inner = container.querySelector('.viz-svg-inner');
    if (inner) {
      inner.style.transform = `translate(${svgPanX}px, ${svgPanY}px) scale(${svgZoom})`;
    }
    /* Expand the scroll wrapper height so content isn't clipped after scale. */
    const scroll = container.querySelector('.viz-svg-scroll');
    if (scroll && inner) {
      const svg = inner.querySelector('svg');
      if (svg) {
        scroll.style.height = `${(svg.getAttribute('height') || 400) * svgZoom + 16}px`;
      }
    }
  }

  function bindHandlers(container, detailPanel) {
    if (container.dataset.visualizerBound === 'true') return;
    container.dataset.visualizerBound = 'true';

    container.addEventListener('click', (e) => {
      /* Zoom controls — manipulate transform directly without re-render. */
      const zoomBtn = e.target.closest?.('[data-zoom]');
      if (zoomBtn) {
        const action = zoomBtn.dataset.zoom;
        if (action === 'in') svgZoom = Math.min(2.5, parseFloat((svgZoom + 0.2).toFixed(2)));
        else if (action === 'out') svgZoom = Math.max(0.4, parseFloat((svgZoom - 0.2).toFixed(2)));
        else if (action === 'reset') { svgZoom = 1; svgPanX = 0; svgPanY = 0; }
        applyZoomTransform(container);
        return;
      }

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

    /* Mouse-wheel zoom on the SVG scroll area — bound to container so it survives re-renders. */
    container.addEventListener('wheel', (e) => {
      if (!e.target.closest?.('.viz-svg-wrap')) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.12 : 0.12;
      svgZoom = Math.max(0.4, Math.min(2.5, parseFloat((svgZoom + delta).toFixed(2))));
      applyZoomTransform(container);
    }, { passive: false });
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

  function updateToolbarSnapshot(snapshot) {
    if (!toolbarRef) return;

    const titleEl = toolbarRef.querySelector('.visualizer-title');
    if (!titleEl) return;

    const value = String(snapshot || '').trim();
    if (value) {
      titleEl.textContent = `watcher/chain-registry.json · snapshot ${value}`;
    }
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
      const res = await fetch('data/chains.json');
      if (!res.ok) throw new Error('Failed to load chain data');
      const data = await res.json();
      const meta = data && typeof data.meta === 'object' && data.meta !== null ? data.meta : {};

      allRoots = sanitizeRoots(data.roots);
      rootsMap = {};
      delegationsMap = {};
      updateToolbarSnapshot(meta.snapshot);

      allRoots.forEach((root) => {
        rootsMap[root.id] = root;
        const delegations = root.delegations;

        delegations.forEach((delegation) => {
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
          const newView = btn.dataset.view;
          if (newView !== activeView) {
            svgZoom = 1;
            svgPanX = 0;
            svgPanY = 0;
          }
          activeView = newView;
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

function autoInitVisualizer() {
  if (document.getElementById('chain-list-container') && document.getElementById('chain-detail-panel')) {
    Visualizer.init('chain-list-container', 'chain-detail-panel');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInitVisualizer, { once: true });
} else {
  autoInitVisualizer();
}
