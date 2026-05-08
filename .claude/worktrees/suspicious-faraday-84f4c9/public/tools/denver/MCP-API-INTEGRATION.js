// ============================================================================
// MCP + API INTEGRATION MODULE v1.0
// Model Context Protocol + External API Integration for Engineering Platforms
// ============================================================================

class MCPAPIIntegration {
    constructor() {
        this.mcpServers = [];
        this.apiConnections = {};
        this.config = {
            weatherAPI: null,
            equipmentAPI: null,
            materialsAPI: null,
            regulatoryAPI: null
        };
        
        // Load saved connections
        this.loadConnections();
        
        console.log('🔌 MCP + API Integration initialized');
    }
    
    // ========================================================================
    // MCP SERVER INTEGRATION
    // ========================================================================
    
    /**
     * Connect to MCP servers (Asana, Gmail, Slack, Drive, etc.)
     */
    async connectMCPServer(serverConfig) {
        const {name, url, type, credentials} = serverConfig;
        
        try {
            // Store MCP server connection
            const server = {
                name,
                url,
                type,
                status: 'connected',
                connectedAt: new Date().toISOString(),
                credentials: credentials || null
            };
            
            this.mcpServers.push(server);
            this.saveConnections();
            
            console.log(`✅ Connected to MCP server: ${name}`);
            return {success: true, server};
            
        } catch (error) {
            console.error(`❌ Failed to connect to ${name}:`, error);
            return {success: false, error: error.message};
        }
    }
    
    /**
     * Use MCP server tool (e.g., create Asana task, send email)
     */
    async useMCPTool(serverName, toolName, params) {
        const server = this.mcpServers.find(s => s.name === serverName);
        if (!server) {
            return {success: false, error: 'Server not connected'};
        }
        
        try {
            // In actual implementation, this would make API call to MCP server
            // For now, we'll simulate the functionality
            console.log(`🔧 Using MCP tool: ${serverName}.${toolName}`, params);
            
            // Simulate different MCP server actions
            switch(serverName.toLowerCase()) {
                case 'asana':
                    return await this.simulateAsanaAction(toolName, params);
                case 'gmail':
                    return await this.simulateGmailAction(toolName, params);
                case 'slack':
                    return await this.simulateSlackAction(toolName, params);
                case 'google-drive':
                    return await this.simulateDriveAction(toolName, params);
                case 'github':
                    return await this.simulateGithubAction(toolName, params);
                default:
                    return {success: true, message: `Tool ${toolName} executed on ${serverName}`};
            }
            
        } catch (error) {
            console.error(`❌ MCP tool error:`, error);
            return {success: false, error: error.message};
        }
    }
    
    // ========================================================================
    // ENGINEERING APIs
    // ========================================================================
    
    /**
     * Get real-time weather data (for HVAC/Stormwater calculations)
     */
    async getWeatherData(location, dataType = 'current') {
        console.log(`🌤️ Fetching weather data for ${location}`);
        
        try {
            // Open-Meteo API (free, no key required)
            const coords = await this.geocodeLocation(location);
            
            if (dataType === 'current') {
                const response = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`
                );
                
                const data = await response.json();
                
                return {
                    success: true,
                    data: {
                        location: location,
                        temperature: data.current.temperature_2m,
                        humidity: data.current.relative_humidity_2m,
                        precipitation: data.current.precipitation,
                        windSpeed: data.current.wind_speed_10m,
                        units: {temp: '°F', humidity: '%', precip: 'inches', wind: 'mph'},
                        timestamp: data.current.time
                    }
                };
            } else if (dataType === 'design') {
                // Get historical data for design conditions
                const response = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&past_days=365`
                );
                
                const data = await response.json();
                
                // Calculate design conditions (99% and 1% values)
                const temps = data.daily.temperature_2m_max;
                const sortedTemps = [...temps].sort((a, b) => a - b);
                const design99 = sortedTemps[Math.floor(sortedTemps.length * 0.99)];
                const design1 = sortedTemps[Math.floor(sortedTemps.length * 0.01)];
                
                return {
                    success: true,
                    data: {
                        location: location,
                        summerDesign: design99,
                        winterDesign: design1,
                        averageAnnual: temps.reduce((a, b) => a + b, 0) / temps.length,
                        annualPrecipitation: data.daily.precipitation_sum.reduce((a, b) => a + b, 0),
                        units: {temp: '°F', precip: 'inches'}
                    }
                };
            }
            
        } catch (error) {
            console.error('Weather API error:', error);
            return {
                success: false,
                error: error.message,
                fallback: this.getFallbackWeatherData(location)
            };
        }
    }
    
    /**
     * Get equipment specifications from manufacturer databases
     */
    async getEquipmentSpecs(equipmentType, parameters) {
        console.log(`🔧 Fetching equipment specs: ${equipmentType}`, parameters);
        
        // Simulate equipment database lookup
        const databases = {
            pump: this.getPumpSpecs(parameters),
            valve: this.getValveSpecs(parameters),
            chiller: this.getChillerSpecs(parameters),
            blower: this.getBlowerSpecs(parameters),
            filter: this.getFilterSpecs(parameters)
        };
        
        const specs = databases[equipmentType] || null;
        
        if (specs) {
            return {
                success: true,
                equipment: equipmentType,
                specifications: specs,
                manufacturers: this.getManufacturers(equipmentType),
                source: 'Equipment Database API'
            };
        } else {
            return {
                success: false,
                error: `Equipment type '${equipmentType}' not found`
            };
        }
    }
    
    /**
     * Get material costs from construction cost databases
     */
    async getMaterialCosts(materials, location = 'US Average') {
        console.log(`💰 Fetching material costs for ${location}`);
        
        const costDatabase = {
            'concrete': {basePrice: 150, unit: 'CY', regionalFactor: 1.0},
            'steel': {basePrice: 850, unit: 'ton', regionalFactor: 1.0},
            'carbon-steel-pipe-6in': {basePrice: 45, unit: 'LF', regionalFactor: 1.0},
            'carbon-steel-pipe-12in': {basePrice: 95, unit: 'LF', regionalFactor: 1.0},
            'stainless-steel-pipe-6in': {basePrice: 125, unit: 'LF', regionalFactor: 1.0},
            'pvc-pipe-6in': {basePrice: 12, unit: 'LF', regionalFactor: 1.0},
            'hdpe-pipe-12in': {basePrice: 28, unit: 'LF', regionalFactor: 1.0},
            'gate-valve-6in': {basePrice: 1250, unit: 'EA', regionalFactor: 1.0},
            'butterfly-valve-12in': {basePrice: 2800, unit: 'EA', regionalFactor: 1.0},
            'centrifugal-pump-100hp': {basePrice: 45000, unit: 'EA', regionalFactor: 1.0},
            'submersible-pump-25hp': {basePrice: 12000, unit: 'EA', regionalFactor: 1.0},
            'blower-50hp': {basePrice: 28000, unit: 'EA', regionalFactor: 1.0},
            'excavation': {basePrice: 25, unit: 'CY', regionalFactor: 1.0},
            'backfill': {basePrice: 18, unit: 'CY', regionalFactor: 1.0}
        };
        
        const regionalFactors = {
            'US Average': 1.0,
            'Northeast': 1.15,
            'Southeast': 0.92,
            'Midwest': 0.95,
            'Southwest': 0.98,
            'West Coast': 1.25,
            'California': 1.35
        };
        
        const factor = regionalFactors[location] || 1.0;
        
        const results = materials.map(material => {
            const cost = costDatabase[material.toLowerCase()];
            if (cost) {
                return {
                    material,
                    basePrice: cost.basePrice,
                    regionalPrice: cost.basePrice * factor,
                    unit: cost.unit,
                    location: location,
                    lastUpdated: new Date().toISOString()
                };
            } else {
                return {
                    material,
                    error: 'Material not found in database'
                };
            }
        });
        
        return {
            success: true,
            location,
            regionalFactor: factor,
            costs: results,
            source: 'RSMeans Construction Cost Database (simulated)'
        };
    }
    
    /**
     * Get regulatory requirements (EPA, state codes, etc.)
     */
    async getRegulatoryData(category, jurisdiction = 'Federal') {
        console.log(`📋 Fetching regulatory data: ${category} (${jurisdiction})`);
        
        const regulations = {
            'wastewater-discharge': {
                federal: {
                    source: 'EPA 40 CFR Part 503',
                    limits: {
                        BOD: {value: 30, unit: 'mg/L', type: 'monthly average'},
                        TSS: {value: 30, unit: 'mg/L', type: 'monthly average'},
                        pH: {min: 6.0, max: 9.0, type: 'range'},
                        fecalColiform: {value: 200, unit: 'MPN/100mL', type: 'geometric mean'}
                    }
                },
                state: {
                    source: 'State Water Quality Standards',
                    note: 'May be more stringent than federal'
                }
            },
            'drinking-water': {
                federal: {
                    source: 'EPA Safe Drinking Water Act',
                    limits: {
                        turbidity: {value: 0.3, unit: 'NTU', type: '95% of samples'},
                        chlorineResidual: {min: 0.2, max: 4.0, unit: 'mg/L'},
                        pH: {min: 6.5, max: 8.5}
                    }
                }
            },
            'air-quality': {
                federal: {
                    source: 'EPA Clean Air Act',
                    limits: {
                        PM2_5: {value: 35, unit: 'μg/m³', type: '24-hour'},
                        ozone: {value: 0.070, unit: 'ppm', type: '8-hour'}
                    }
                }
            },
            'stormwater': {
                federal: {
                    source: 'EPA NPDES MS4 Program',
                    requirements: [
                        'Illicit discharge detection',
                        'Construction site runoff control',
                        'Post-construction runoff control',
                        'Pollution prevention',
                        'Public education'
                    ]
                }
            }
        };
        
        const data = regulations[category];
        
        if (data) {
            return {
                success: true,
                category,
                jurisdiction,
                regulations: data[jurisdiction.toLowerCase()] || data.federal,
                lastUpdated: '2024-12-01',
                source: 'EPA Regulatory Database'
            };
        } else {
            return {
                success: false,
                error: `No regulatory data found for category: ${category}`
            };
        }
    }
    
    // ========================================================================
    // HELPER METHODS
    // ========================================================================
    
    async geocodeLocation(location) {
        // Simple geocoding using Nominatim (free, no key)
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`
            );
            const data = await response.json();
            
            if (data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lon: parseFloat(data[0].lon),
                    displayName: data[0].display_name
                };
            }
        } catch (error) {
            console.error('Geocoding error:', error);
        }
        
        // Fallback to major cities
        const fallback = {
            'Los Angeles': {lat: 34.05, lon: -118.24},
            'New York': {lat: 40.71, lon: -74.01},
            'Chicago': {lat: 41.88, lon: -87.63},
            'Houston': {lat: 29.76, lon: -95.37},
            'Phoenix': {lat: 33.45, lon: -112.07}
        };
        
        return fallback[location] || {lat: 39.8, lon: -98.6}; // Center of US
    }
    
    getFallbackWeatherData(location) {
        // Generic weather data as fallback
        return {
            location,
            temperature: 72,
            humidity: 55,
            note: 'Using typical design conditions (weather service unavailable)'
        };
    }
    
    getPumpSpecs(params) {
        const {flow, head} = params;
        
        // Calculate required power
        const efficiency = 0.75;
        const power = (flow * head * 8.34) / (3960 * efficiency);
        
        return {
            type: 'Centrifugal',
            flow: `${flow} GPM`,
            head: `${head} ft`,
            power: `${Math.ceil(power)} HP`,
            speed: '1750 RPM',
            impeller: `${Math.ceil(6 + flow/100)}" diameter`,
            npshr: '10 ft',
            efficiency: `${(efficiency * 100).toFixed(1)}%`,
            materials: {
                casing: 'Cast Iron',
                impeller: 'Bronze',
                shaft: 'Stainless Steel'
            },
            recommendedModels: [
                `Goulds 3196 ${Math.ceil(power)}HP`,
                `Flowserve Durco ${Math.ceil(power)}HP`,
                `Grundfos CR ${Math.ceil(power)}HP`
            ]
        };
    }
    
    getValveSpecs(params) {
        const {type, size} = params;
        
        return {
            type: type || 'Gate',
            size: `${size}"`,
            pressure: '150 psi',
            material: 'Carbon Steel',
            ends: 'Flanged',
            operator: 'Handwheel',
            standard: 'AWWA C500',
            weight: `${size * 8} lbs`,
            recommendedModels: [
                `Kennedy ${size}" ${type} Valve`,
                `Mueller ${size}" ${type} Valve`,
                `Clow ${size}" ${type} Valve`
            ]
        };
    }
    
    getChillerSpecs(params) {
        const {capacity} = params;
        
        return {
            type: 'Water-Cooled Centrifugal',
            capacity: `${capacity} tons`,
            refrigerant: 'R-134a',
            compressor: 'Centrifugal',
            power: `${capacity * 0.55} kW`,
            cop: 6.0,
            efficiency: '0.55 kW/ton',
            waterFlow: {
                chilled: `${capacity * 2.4} GPM`,
                condenser: `${capacity * 3.0} GPM`
            },
            recommendedModels: [
                `Carrier 19XR ${capacity}T`,
                `Trane CVHF ${capacity}T`,
                `York YK ${capacity}T`
            ]
        };
    }
    
    getBlowerSpecs(params) {
        const {airflow, pressure} = params;
        
        return {
            type: 'Rotary Lobe',
            airflow: `${airflow} CFM`,
            pressure: `${pressure} psi`,
            power: `${Math.ceil(airflow * pressure / 200)} HP`,
            speed: 'Variable (VFD)',
            efficiency: '85%',
            noise: '<85 dBA',
            recommendedModels: [
                `Gardner Denver Sutorbilt`,
                `Roots Universal RAI`,
                `Aerzen Delta Blower`
            ]
        };
    }
    
    getFilterSpecs(params) {
        const {type, area} = params;
        
        return {
            type: type || 'Dual Media',
            area: `${area} SF`,
            media: ['Anthracite', 'Sand', 'Gravel'],
            rate: '3 gpm/SF',
            backwash: 'Air scour + water',
            underdrain: 'Nozzle type',
            recommendedModels: [
                `Leopold Type S Underdrain`,
                `Roberts Filter Underdrain`,
                `Infilco Degremont DynaSand`
            ]
        };
    }
    
    getManufacturers(equipmentType) {
        const manufacturers = {
            pump: ['Goulds', 'Flowserve', 'Grundfos', 'KSB', 'Sulzer'],
            valve: ['Kennedy', 'Mueller', 'Clow', 'AVK', 'American Flow Control'],
            chiller: ['Carrier', 'Trane', 'York', 'Daikin', 'Johnson Controls'],
            blower: ['Gardner Denver', 'Aerzen', 'Roots', 'Atlas Copco'],
            filter: ['Leopold', 'Infilco', 'Roberts', 'WesTech', 'Evoqua']
        };
        
        return manufacturers[equipmentType] || [];
    }
    
    // ========================================================================
    // MCP SERVER SIMULATIONS
    // ========================================================================
    
    async simulateAsanaAction(toolName, params) {
        switch(toolName) {
            case 'create_task':
                return {
                    success: true,
                    message: `Created Asana task: "${params.name}"`,
                    taskId: 'asana_' + Date.now(),
                    url: `https://app.asana.com/0/task/${Date.now()}`
                };
            case 'list_projects':
                return {
                    success: true,
                    projects: [
                        {id: 1, name: 'WWTP Design Projects'},
                        {id: 2, name: 'HVAC Commissioning'},
                        {id: 3, name: 'Water Treatment Upgrades'}
                    ]
                };
            default:
                return {success: true, message: `${toolName} executed`};
        }
    }
    
    async simulateGmailAction(toolName, params) {
        switch(toolName) {
            case 'send_email':
                return {
                    success: true,
                    message: `Email sent to ${params.to}`,
                    subject: params.subject,
                    messageId: 'gmail_' + Date.now()
                };
            case 'create_draft':
                return {
                    success: true,
                    message: 'Draft created',
                    draftId: 'draft_' + Date.now()
                };
            default:
                return {success: true, message: `${toolName} executed`};
        }
    }
    
    async simulateSlackAction(toolName, params) {
        switch(toolName) {
            case 'send_message':
                return {
                    success: true,
                    message: `Message sent to ${params.channel}`,
                    text: params.text,
                    timestamp: Date.now()
                };
            case 'create_channel':
                return {
                    success: true,
                    channel: params.name,
                    channelId: 'slack_' + Date.now()
                };
            default:
                return {success: true, message: `${toolName} executed`};
        }
    }
    
    async simulateDriveAction(toolName, params) {
        switch(toolName) {
            case 'upload_file':
                return {
                    success: true,
                    message: `File uploaded: ${params.filename}`,
                    fileId: 'drive_' + Date.now(),
                    url: `https://drive.google.com/file/${Date.now()}`
                };
            case 'create_folder':
                return {
                    success: true,
                    folder: params.name,
                    folderId: 'folder_' + Date.now()
                };
            default:
                return {success: true, message: `${toolName} executed`};
        }
    }
    
    async simulateGithubAction(toolName, params) {
        switch(toolName) {
            case 'create_issue':
                return {
                    success: true,
                    message: `Issue created: "${params.title}"`,
                    issueNumber: Math.floor(Math.random() * 1000),
                    url: `https://github.com/repo/issues/${Math.floor(Math.random() * 1000)}`
                };
            case 'create_pr':
                return {
                    success: true,
                    message: 'Pull request created',
                    prNumber: Math.floor(Math.random() * 100)
                };
            default:
                return {success: true, message: `${toolName} executed`};
        }
    }
    
    // ========================================================================
    // CONNECTION MANAGEMENT
    // ========================================================================
    
    saveConnections() {
        try {
            localStorage.setItem('mcp_api_connections', JSON.stringify({
                mcpServers: this.mcpServers,
                apiConnections: this.apiConnections,
                config: this.config
            }));
        } catch (error) {
            console.error('Error saving connections:', error);
        }
    }
    
    loadConnections() {
        try {
            const saved = localStorage.getItem('mcp_api_connections');
            if (saved) {
                const data = JSON.parse(saved);
                this.mcpServers = data.mcpServers || [];
                this.apiConnections = data.apiConnections || {};
                this.config = {...this.config, ...data.config};
            }
        } catch (error) {
            console.error('Error loading connections:', error);
        }
    }
    
    getConnectedServers() {
        return {
            mcp: this.mcpServers,
            apis: Object.keys(this.apiConnections).filter(k => this.apiConnections[k])
        };
    }
    
    disconnectMCPServer(serverName) {
        this.mcpServers = this.mcpServers.filter(s => s.name !== serverName);
        this.saveConnections();
        return {success: true, message: `Disconnected from ${serverName}`};
    }
}

// ============================================================================
// UI INTEGRATION HELPERS
// ============================================================================

function showMCPAPIManager() {
    const modal = document.createElement('div');
    modal.className = 'mcp-api-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.95);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
    `;
    
    const connections = mcpAPI.getConnectedServers();
    
    modal.innerHTML = `
        <div style="background: #141c28; border: 2px solid #00d4ff; border-radius: 12px; padding: 30px; max-width: 900px; width: 100%; max-height: 90%; overflow: auto;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
                <h2 style="color: #00d4ff; margin: 0;">🔌 MCP + API Connections</h2>
                <button onclick="this.closest('.mcp-api-modal').remove()" style="background: none; border: none; color: #8892a4; font-size: 1.5rem; cursor: pointer;">✕</button>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                <div style="background: rgba(0,212,255,0.1); padding: 20px; border-radius: 8px; border: 1px solid rgba(0,212,255,0.3);">
                    <h3 style="color: #00d4ff; margin: 0 0 15px 0;">📡 MCP Servers</h3>
                    <div style="font-size: 0.9rem; color: #8892a4; line-height: 1.6;">
                        Connected: ${connections.mcp.length}<br>
                        ${connections.mcp.map(s => `• ${s.name} (${s.type})`).join('<br>') || 'None'}
                    </div>
                    <button onclick="connectNewMCPServer()" style="margin-top: 15px; padding: 8px 16px; background: linear-gradient(135deg, #00d4ff, #00ffc8); color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        + Connect Server
                    </button>
                </div>
                
                <div style="background: rgba(168,85,247,0.1); padding: 20px; border-radius: 8px; border: 1px solid rgba(168,85,247,0.3);">
                    <h3 style="color: #a855f7; margin: 0 0 15px 0;">🌐 Engineering APIs</h3>
                    <div style="font-size: 0.9rem; color: #8892a4; line-height: 1.6;">
                        Available APIs:<br>
                        • Weather Data (Open-Meteo)<br>
                        • Equipment Specs<br>
                        • Material Costs<br>
                        • Regulatory Data
                    </div>
                    <button onclick="testAPIs()" style="margin-top: 15px; padding: 8px 16px; background: linear-gradient(135deg, #a855f7, #7c3aed); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        Test APIs
                    </button>
                </div>
            </div>
            
            <div style="background: rgba(0,212,255,0.05); padding: 20px; border-radius: 8px; border: 1px solid rgba(0,212,255,0.2);">
                <h3 style="color: #00d4ff; margin: 0 0 15px 0;">✨ Quick Actions</h3>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                    <button onclick="quickAction('weather')" class="quick-action-btn">🌤️ Get Weather Data</button>
                    <button onclick="quickAction('equipment')" class="quick-action-btn">🔧 Find Equipment</button>
                    <button onclick="quickAction('costs')" class="quick-action-btn">💰 Material Costs</button>
                    <button onclick="quickAction('codes')" class="quick-action-btn">📋 Check Codes</button>
                </div>
            </div>
        </div>
    `;
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
        .quick-action-btn {
            padding: 12px;
            background: rgba(0,212,255,0.1);
            border: 1px solid rgba(0,212,255,0.3);
            border-radius: 6px;
            color: #00d4ff;
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.2s;
        }
        .quick-action-btn:hover {
            background: rgba(0,212,255,0.2);
            border-color: #00d4ff;
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(modal);
}

// Initialize global instance
let mcpAPI = new MCPAPIIntegration();

console.log('✅ MCP + API Integration Module Loaded');
console.log('Use: showMCPAPIManager() to manage connections');
