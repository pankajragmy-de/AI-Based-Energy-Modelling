// App Logic for Meta Energy Visualizer

document.addEventListener('DOMContentLoaded', () => {
    // === UI Elements ===
    const emptyState = document.getElementById('empty-state');
    const canvas = document.getElementById('canvas');
    const svgLayer = document.getElementById('canvas-svg');
    
    // Properties Panel
    const panelProps = document.getElementById('panel-properties');
    const panelResults = document.getElementById('panel-results');
    const tabProps = document.getElementById('tab-properties');
    const tabResults = document.getElementById('tab-results');
    const noSelection = document.getElementById('no-selection');
    const propForm = document.getElementById('properties-form');
    
    // Results
    const resEmpty = document.getElementById('results-empty');
    const resContent = document.getElementById('results-content');
    
    // Overlay
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    // === State ===
    let nodes = [];
    let connections = [];
    let selectedNodeId = null;
    let draggedType = null;
    
    let isDrawing = false;
    let drawStartPort = null;
    let tempLine = null;

    let chartInstance = null;
    let propChartInstance = null;

    const COMPONENT_META = {
        'node': { desc: 'Creates a standard electrical bus or region to which other components connect. Ensures power balance (sum of inputs = sum of outputs).' },
        'solar': { desc: 'Solar Photovoltaic array. Generation depends on the selected meteorological time-series data (GHI, DNI).' },
        'wind': { desc: 'Wind Turbine Generator. Converts wind speed time-series into electrical power based on a defined power curve.' },
        'load': { desc: 'Urban electrical demand profile. Represents the inelastic consumption of consumers over time.' },
        'battery': { desc: 'Lithium-Ion Battery Energy Storage System (BESS). Dispatches energy to maximize system value based on round-trip efficiency.' },
        'electrolyzer': { desc: 'Power-to-Gas (PEM). Consumes electricity to produce Hydrogen. Often coupled with TESPy for detailed thermodynamic state modeling.' },
        'mtress_hp': { desc: 'DLR MTRESS Air/Ground Source Heat Pump. Couples the electrical grid to the thermal grid using a dynamic Coefficient of Performance (COP).' },
        'mtress_chp': { desc: 'DLR MTRESS Combined Heat and Power engine. Cogen plant that produces both electricity and usable heat from combustible fuels.' },
        'mtress_tes': { desc: 'DLR MTRESS Thermal Energy Storage. A stratified hot water tank used to decouple heat generation from heat demand.' },
        'mtress_st': { desc: 'DLR MTRESS Solar Thermal collector. Directly converts solar irradiance into thermal energy for district heating networks.' },
        'amiris': { desc: 'DLR AMIRIS Market Agent. An agent-based model simulating the bidding behavior of this power plant on the day-ahead electricity exchange.' },
        'flexigis': { desc: 'DLR FlexiGIS Node. Maps urban infrastructure to synthetic low-voltage grid topologies for detailed spatial distribution analysis.' }
    };

    // === Initialization ===
    initDragAndDrop();
    initTabs();
    initRunPipeline();

    // === Drag and Drop from Sidebar ===
    function initDragAndDrop() {
        const items = document.querySelectorAll('.component-item');
        
        items.forEach(item => {
            // Drag start logic
            item.addEventListener('dragstart', (e) => {
                draggedType = item.dataset.type;
                e.dataTransfer.setData('text/plain', draggedType);
            });
            
            // Click to add functionality for easier UX
            item.addEventListener('click', (e) => {
                const rect = canvas.getBoundingClientRect();
                // Spawn randomly near center
                const x = rect.width / 2 + (Math.random() * 60 - 30);
                const y = rect.height / 2 + (Math.random() * 60 - 30);
                createNode(item.dataset.type, x, y);
            });
        });

        canvas.addEventListener('dragenter', (e) => {
            e.preventDefault();
        });

        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            if(!draggedType) return;
            
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            createNode(draggedType, x, y);
            draggedType = null;
        });
    }

    // === Commodity Port Definitions per Component Type ===
    // Each port: { pos, side: 'top'|'bottom'|'left'|'right', commodity, label, dir: 'in'|'out' }
    const COMPONENT_PORTS = {
        'node':        [{ side:'left',   commodity:'elec',  label:'Electricity IN',  dir:'in'  }, { side:'right',  commodity:'elec',  label:'Electricity OUT', dir:'out' }],
        'solar':       [{ side:'bottom', commodity:'elec',  label:'AC Power OUT',    dir:'out' }],
        'wind':        [{ side:'bottom', commodity:'elec',  label:'AC Power OUT',    dir:'out' }],
        'load':        [{ side:'top',    commodity:'elec',  label:'Electricity IN',  dir:'in'  }],
        'battery':     [{ side:'left',   commodity:'elec',  label:'Charge IN',       dir:'in'  }, { side:'right',  commodity:'elec',  label:'Discharge OUT',   dir:'out' }],
        'electrolyzer':[{ side:'left',   commodity:'elec',  label:'Electricity IN',  dir:'in'  }, { side:'top',    commodity:'water', label:'Water IN',         dir:'in'  }, { side:'right',  commodity:'h2',   label:'Hydrogen OUT', dir:'out' }, { side:'bottom', commodity:'heat', label:'Waste Heat OUT', dir:'out' }],
        'mtress_hp':   [{ side:'left',   commodity:'elec',  label:'Electricity IN',  dir:'in'  }, { side:'bottom', commodity:'cool',  label:'Ambient Heat IN',  dir:'in'  }, { side:'right',  commodity:'heat',  label:'District Heat OUT', dir:'out' }],
        'mtress_chp':  [{ side:'left',   commodity:'gas',   label:'Biogas IN',       dir:'in'  }, { side:'top',    commodity:'elec',  label:'Electricity OUT',  dir:'out' }, { side:'right',  commodity:'heat',  label:'Heat OUT',      dir:'out' }, { side:'bottom', commodity:'co2',  label:'CO₂ Exhaust',    dir:'out' }],
        'mtress_tes':  [{ side:'left',   commodity:'heat',  label:'Heat IN',         dir:'in'  }, { side:'right',  commodity:'heat',  label:'Heat OUT',         dir:'out' }],
        'mtress_st':   [{ side:'bottom', commodity:'heat',  label:'Thermal Energy OUT', dir:'out'}],
        'amiris':      [{ side:'left',   commodity:'elec',  label:'Market Power IN', dir:'in'  }, { side:'right',  commodity:'elec',  label:'Market Power OUT', dir:'out' }],
        'flexigis':    [{ side:'left',   commodity:'elec',  label:'Grid IN',         dir:'in'  }, { side:'right',  commodity:'elec',  label:'Grid OUT',         dir:'out' }],
    };

    const COMMODITY_COLOR = {
        'elec':  { bg: '#FBBF24', label: 'Electricity' },
        'heat':  { bg: '#F87171', label: 'Heat' },
        'cool':  { bg: '#60A5FA', label: 'Ambient/Cool' },
        'h2':    { bg: '#C084FC', label: 'Hydrogen' },
        'gas':   { bg: '#34D399', label: 'Gas/Biogas' },
        'water': { bg: '#67E8F9', label: 'Water' },
        'co2':   { bg: '#9CA3AF', label: 'CO₂' },
    };

    // === Canvas Core Logic ===
    function createNode(type, x, y) {
        if(emptyState) emptyState.style.display = 'none';
        
        const id = 'node_' + Date.now();
        const nodeObj = {
            id, type, x, y,
            data: { label: formatLabel(type), capacity: 100 }
        };
        nodes.push(nodeObj);
        
        const el = document.createElement('div');
        el.className = `canvas-node ${getColorClass(type)}`;
        el.id = id;
        el.style.left = `${x - 55}px`;
        el.style.top = `${y - 35}px`;

        // Build ports based on commodity definitions
        const ports = COMPONENT_PORTS[type] || [
            { side:'left', commodity:'elec', label:'IN', dir:'in' },
            { side:'right', commodity:'elec', label:'OUT', dir:'out' }
        ];
        const portHtml = ports.map(p => {
            const c = COMMODITY_COLOR[p.commodity] || { bg: '#9CA3AF', label: p.commodity };
            return `<div class="port port-${p.side} commodity-port"
                        style="background-color:${c.bg}; box-shadow: 0 0 6px ${c.bg};"
                        data-node="${id}" data-pos="${p.side}" data-commodity="${p.commodity}" data-dir="${p.dir}"
                        data-portlabel="${p.label}">
                        <span class="port-tooltip">${p.label}<br><span style="color:${c.bg}; font-weight:700">${c.label}</span></span>
                    </div>`;
        }).join('');

        const meta = COMPONENT_META[type] || { desc: '' };
        el.innerHTML = `
            <div class="node-tooltip-popup">
                <strong>${formatLabel(type)}</strong>
                <p>${meta.desc}</p>
            </div>
            <i class="${getIconClass(type)}"></i>
            <span class="label">${nodeObj.data.label}</span>
            ${portHtml}
        `;
        
        // Node Dragging
        makeNodeDraggable(el, nodeObj);
        
        // Selection
        el.addEventListener('mousedown', (e) => {
            if(e.target.classList.contains('port')) return;
            selectNode(id);
        });
        
        canvas.appendChild(el);
        selectNode(id);
        initPorts(el);
    }

    function makeNodeDraggable(el, nodeObj) {
        let isDragging = false;
        let pX, pY;

        el.addEventListener('mousedown', (e) => {
            if(e.target.classList.contains('port')) return;
            isDragging = true;
            pX = e.clientX; pY = e.clientY;
            el.style.cursor = 'grabbing';
            el.style.zIndex = 30;
        });

        document.addEventListener('mousemove', (e) => {
            if(!isDragging) return;
            const dx = e.clientX - pX;
            const dy = e.clientY - pY;
            pX = e.clientX; pY = e.clientY;
            
            nodeObj.x += dx;
            nodeObj.y += dy;
            
            el.style.left = `${nodeObj.x - 50}px`;
            el.style.top = `${nodeObj.y - 30}px`;
            
            updateConnections();
        });

        document.addEventListener('mouseup', () => {
            if(isDragging) {
                isDragging = false;
                el.style.cursor = 'grab';
                el.style.zIndex = 20;
            }
        });
    }

    // === Connecting Lines (Edges) ===
    function initPorts(nodeEl) {
        const ports = nodeEl.querySelectorAll('.port');
        ports.forEach(port => {
            port.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                isDrawing = true;
                drawStartPort = port;
                
                tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                tempLine.setAttribute('class', 'connection-line');
                svgLayer.appendChild(tempLine);
            });
        });
    }

    canvas.addEventListener('mousemove', (e) => {
        if(!isDrawing) return;
        
        const rect = canvas.getBoundingClientRect();
        const startX = drawStartPort.getBoundingClientRect().left - rect.left + 6;
        const startY = drawStartPort.getBoundingClientRect().top - rect.top + 6;
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        
        // Draw bezier curve
        const d = `M ${startX} ${startY} C ${startX + 50} ${startY}, ${endX - 50} ${endY}, ${endX} ${endY}`;
        tempLine.setAttribute('d', d);
    });

    canvas.addEventListener('mouseup', (e) => {
        if(!isDrawing) return;
        isDrawing = false;
        
        // Find if dropped on a port
        let target = e.target;
        if(target.classList.contains('port') && target !== drawStartPort) {
            const sourceNodeId = drawStartPort.dataset.node;
            const targetNodeId = target.dataset.node;
            
            // Prevent duplicate or self connections
            if(sourceNodeId !== targetNodeId) {
                connections.push({
                    id: 'edge_' + Date.now(),
                    source: sourceNodeId,
                    target: targetNodeId,
                    sourcePort: drawStartPort,
                    targetPort: target
                });
            }
        }
        
        // Remove temp line, redraw all permanent
        tempLine.remove();
        tempLine = null;
        updateConnections();
    });

    function updateConnections() {
        // Clear SVG
        svgLayer.innerHTML = '';
        
        const rect = canvas.getBoundingClientRect();
        
        connections.forEach(conn => {
            const sRect = conn.sourcePort.getBoundingClientRect();
            const tRect = conn.targetPort.getBoundingClientRect();
            
            const startX = sRect.left - rect.left + 6;
            const startY = sRect.top - rect.top + 6;
            const endX = tRect.left - rect.left + 6;
            const endY = tRect.top - rect.top + 6;
            
            // Curve logic based on ports
            let cp1x = startX, cp1y = startY, cp2x = endX, cp2y = endY;
            
            if(conn.sourcePort.dataset.pos === 'right') cp1x += 50;
            else if(conn.sourcePort.dataset.pos === 'left') cp1x -= 50;
            else if(conn.sourcePort.dataset.pos === 'top') cp1y -= 50;
            else if(conn.sourcePort.dataset.pos === 'bottom') cp1y += 50;
            
            if(conn.targetPort.dataset.pos === 'left') cp2x -= 50;
            else if(conn.targetPort.dataset.pos === 'right') cp2x += 50;
            else if(conn.targetPort.dataset.pos === 'top') cp2y -= 50;
            else if(conn.targetPort.dataset.pos === 'bottom') cp2y += 50;

            const d = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('class', 'connection-line');
            path.id = conn.id;
            svgLayer.appendChild(path);
        });
    }

    // === Sidebar UI Interaction ===
    function selectNode(id) {
        document.querySelectorAll('.canvas-node').forEach(n => n.classList.remove('selected'));
        if(id) {
            document.getElementById(id).classList.add('selected');
            selectedNodeId = id;
            updatePropertiesForm();
            switchTab('properties');
        } else {
            selectedNodeId = null;
            noSelection.style.display = 'block';
            document.getElementById('properties-content').classList.add('hidden');
        }
    }

    canvas.addEventListener('mousedown', (e) => {
        if(e.target === canvas || e.target.id === 'empty-state') {
            selectNode(null);
        }
    });

    function updatePropertiesForm() {
        const _node = nodes.find(n => n.id === selectedNodeId);
        if(!_node) return;
        
        noSelection.style.display = 'none';
        document.getElementById('properties-content').classList.remove('hidden');
        
        // Header
        const meta = COMPONENT_META[_node.type] || { desc: 'Generic system component.' };
        document.getElementById('prop-header-area').innerHTML = `
            <div class="flex items-center gap-3 mb-2">
                <div class="${getColorClass(_node.type).replace('border-t-2', 'border-2')} w-10 h-10 rounded-lg bg-darker flex items-center justify-center">
                    <i class="${getIconClass(_node.type)} text-lg"></i>
                </div>
                <div>
                    <h3 class="font-bold text-white text-lg">${formatLabel(_node.type)}</h3>
                    <p class="text-[10px] text-accent uppercase tracking-widest font-mono">ID: ${_node.id}</p>
                </div>
            </div>
            <p class="text-[11px] text-gray-400 mt-3 leading-relaxed border-l-2 border-gray-700 pl-2">${meta.desc}</p>
        `;
        
        propForm.innerHTML = `
            <div class="space-y-1">
                <label class="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Node Name</label>
                <input type="text" value="${_node.data.label}" id="prop_label" class="w-full bg-darker border border-gray-700/50 rounded p-2 text-sm text-white focus:border-accent focus:outline-none transition-colors">
            </div>
            <div class="space-y-1">
                <label class="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Installed Capacity (MW)</label>
                <input type="number" value="${_node.data.capacity}" id="prop_cap" class="w-full bg-darker border border-gray-700/50 rounded p-2 text-sm text-white focus:border-accent focus:outline-none transition-colors">
            </div>
            <button type="button" class="w-full mt-4 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white py-2.5 rounded font-bold text-xs transition-colors shadow-sm" onclick="deleteObj('${_node.id}')">
                <i class="fa-solid fa-trash mr-1 text-xs"></i> Delete Node
            </button>
        `;
        
        // Listeners
        document.getElementById('prop_label').addEventListener('input', e => {
            _node.data.label = e.target.value;
            document.querySelector(`#${_node.id} .label`).innerText = e.target.value;
        });
        document.getElementById('prop_cap').addEventListener('input', e => {
            _node.data.capacity = e.target.value;
        });

        // Time Series
        document.getElementById('ts-container').classList.remove('hidden');
        renderPropertyChart(_node.type);
    }

    function renderPropertyChart(type) {
        const ctx = document.getElementById('propertyChart').getContext('2d');
        if(propChartInstance) propChartInstance.destroy();
        
        // Generate random realistic-looking timeseries data
        let points = [];
        let val = 50;
        for(let i=0; i<24; i++) {
            if(type === 'solar' || type === 'mtress_st') {
                val = (i > 6 && i < 18) ? Math.sin((i-6)*Math.PI/12) * 100 : 0;
            } else if(type === 'load') {
                val = 40 + Math.sin(i*Math.PI/12)*20 + Math.random()*10;
            } else {
                val += (Math.random() - 0.5) * 20;
                val = Math.max(0, Math.min(100, val));
            }
            points.push(val);
        }
        
        propChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array.from({length: 24}, (_, i) => `${i}:00`),
                datasets: [{
                    data: points,
                    borderColor: '#4FD1C5',
                    backgroundColor: 'rgba(79, 209, 197, 0.2)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false, min: 0 }
                }
            }
        });
    }

    window.deleteObj = function(id) {
        nodes = nodes.filter(n => n.id !== id);
        connections = connections.filter(c => c.source !== id && c.target !== id);
        document.getElementById(id).remove();
        updateConnections();
        selectNode(null);
        if(nodes.length === 0) emptyState.style.display = 'block';
    }

    function initTabs() {
        tabProps.addEventListener('click', () => switchTab('properties'));
        tabResults.addEventListener('click', () => switchTab('results'));
    }

    function switchTab(tab) {
        if(tab === 'properties') {
            tabProps.className = 'flex-1 py-3 text-sm font-semibold border-b-2 border-accent text-accent';
            tabResults.className = 'flex-1 py-3 text-sm font-semibold border-b-2 border-transparent text-gray-500 hover:text-white';
            panelProps.style.display = 'flex';
            panelResults.style.display = 'none';
        } else {
            tabResults.className = 'flex-1 py-3 text-sm font-semibold border-b-2 border-accent text-accent';
            tabProps.className = 'flex-1 py-3 text-sm font-semibold border-b-2 border-transparent text-gray-500 hover:text-white';
            panelProps.style.display = 'none';
            panelResults.style.display = 'flex';
        }
    }

    // === Execution Engine & Results ===
    function initRunPipeline() {
        const btn = document.getElementById('runBtn');
        const fmwk = document.getElementById('frameworkSelect');
        
        btn.addEventListener('click', () => {
            if(nodes.length === 0) {
                alert("Please add components to the canvas first.");
                return;
            }
            
            const frameworkName = fmwk.options[fmwk.selectedIndex].text.split(' ')[0];
            
            // Show Overlay
            overlay.classList.remove('pointer-events-none', 'opacity-0');
            loadingText.innerText = `Translating UCDM to ${frameworkName} Adapter...`;
            
            // Simulate Backend Execution Time
            setTimeout(() => {
                loadingText.innerText = "Solving Optimization Pathway...";
                
                setTimeout(() => {
                    overlay.classList.add('pointer-events-none', 'opacity-0');
                    displayResults(frameworkName);
                    
                    // Animate connection flows
                    document.querySelectorAll('.connection-line').forEach(l => l.classList.add('active-flow'));
                    
                }, 1500);
            }, 1000);
        });
    }

    function displayResults(framework) {
        switchTab('results');
        resEmpty.style.display = 'none';
        resContent.style.display = 'flex';
        
        // Mock Cost
        const cost = Math.floor(Math.random() * 500) + 100;
        document.getElementById('res-cost').innerText = `€${cost}.45 M`;
        
        // Setup Attribution Link based on Phase 4 data
        let attrHtml = "";
        if(framework === "PyPSA") {
            attrHtml = `Generated by <a href="#" class="text-white font-bold underline">PyPSA</a> via TU Berlin. Licensed under MIT.`;
        } else if(framework === "OEMOF") {
            attrHtml = `Generated by <a href="#" class="text-white font-bold underline">OEMOF</a> via RLI. Licensed under MIT.`;
        } else {
             attrHtml = `Generated by ${framework} engine.`;
        }
        document.getElementById('res-attribution-text').innerHTML = attrHtml;
        
        renderChart();
    }

    function renderChart() {
        const ctx = document.getElementById('mixChart').getContext('2d');
        if(chartInstance) chartInstance.destroy();
        
        chartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Solar', 'Wind', 'Grid Import', 'Battery Dispatch'],
                datasets: [{
                    data: [45, 25, 20, 10],
                    backgroundColor: ['#FBBF24', '#60A5FA', '#9CA3AF', '#34D399'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: '#9CA3AF', font: { size: 10 } }
                    }
                }
            }
        });
    }

    // === Helpers ===
    function formatLabel(type) {
        switch(type) {
            case 'node': return 'Network Bus';
            case 'solar': return 'Solar PV Array';
            case 'wind': return 'Wind Farm';
            case 'load': return 'City Demand';
            case 'battery': return 'BESS 100MWh';
            case 'electrolyzer': return 'H2 Electrolyzer';
            case 'mtress_hp': return 'MTRESS Heat Pump';
            case 'mtress_chp': return 'MTRESS CHP Engine';
            case 'mtress_tes': return 'MTRESS Thermal Storage';
            case 'mtress_st': return 'MTRESS Solar Thermal';
            case 'amiris': return 'AMIRIS Market Agent';
            case 'flexigis': return 'FlexiGIS GIS Node';
            default: return 'Component';
        }
    }
    
    function getColorClass(type) {
        if(type === 'solar' || type === 'wind') return 'border-t-2 border-t-yellow-400';
        if(type === 'load' || type === 'battery') return 'border-t-2 border-t-green-400';
        if(type === 'electrolyzer') return 'border-t-2 border-t-purple-400';
        if(type.startsWith('mtress')) return 'border-t-2 border-t-pink-400';
        if(type === 'amiris') return 'border-t-2 border-t-indigo-400';
        if(type === 'flexigis') return 'border-t-2 border-t-teal-400';
        return 'border-t-2 border-t-gray-400';
    }
    function getIconClass(type) {
        switch(type) {
            case 'node': return 'fa-solid fa-circle-dot text-gray-400';
            case 'solar': return 'fa-regular fa-sun text-yellow-400';
            case 'wind': return 'fa-solid fa-wind text-blue-400';
            case 'load': return 'fa-solid fa-city text-red-400';
            case 'battery': return 'fa-solid fa-battery-half text-green-400';
            case 'electrolyzer': return 'fa-solid fa-water text-purple-400';
            case 'mtress_hp': return 'fa-solid fa-fire-burner text-pink-400';
            case 'mtress_chp': return 'fa-solid fa-industry text-pink-400';
            case 'mtress_tes': return 'fa-solid fa-database text-pink-400';
            case 'mtress_st': return 'fa-solid fa-solar-panel text-pink-400';
            case 'amiris': return 'fa-solid fa-money-bill-trend-up text-indigo-400';
            case 'flexigis': return 'fa-solid fa-map-location-dot text-teal-400';
            default: return 'fa-solid fa-bolt text-accent';
        }
    }
});
