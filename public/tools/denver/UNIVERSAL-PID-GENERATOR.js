// ============================================================================
// UNIVERSAL P&ID AUTO-GENERATION ENGINE v2.0
// Integrates into any engineering platform to generate P&IDs from project data
// ============================================================================

class UniversalPIDGenerator {
    constructor(canvasId = 'pidCanvas') {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            // Create canvas if doesn't exist
            this.canvas = document.createElement('canvas');
            this.canvas.id = canvasId;
            this.canvas.width = 1600;
            this.canvas.height = 1000;
        }
        this.ctx = this.canvas.getContext('2d');
        
        this.config = {
            margin: 80,
            equipSpacing: 180,
            lineWidth: 3,
            fontSize: 12,
            tagFontSize: 14,
            colors: {
                equipment: '#00d4ff',
                pipe: '#00ffc8',
                valve: '#ff9f43',
                instrument: '#a855f7',
                text: '#ffffff',
                grid: 'rgba(0,212,255,0.1)'
            }
        };
        
        this.objects = [];
        this.tagCounters = {
            P: 1,  // Pumps
            T: 1,  // Tanks
            V: 1,  // Valves
            E: 1,  // Equipment
            FI: 1, // Flow Instruments
            PI: 1, // Pressure Instruments
            LI: 1, // Level Instruments
            TI: 1  // Temperature Instruments
        };
    }
    
    // ========================================================================
    // MAIN GENERATION DISPATCHER
    // ========================================================================
    generate(projectData, calculatedResults, systemType) {
        console.log('🤖 P&ID Auto-Generator Starting...');
        console.log('System Type:', systemType);
        console.log('Project Data:', projectData);
        console.log('Calculated Results:', calculatedResults);
        
        // Clear canvas
        this.clearCanvas();
        
        // Draw grid
        this.drawGrid();
        
        // Generate based on system type
        switch(systemType.toLowerCase()) {
            case 'wwtp':
            case 'wastewater':
                return this.generateWWTPPID(projectData, calculatedResults);
                
            case 'water':
            case 'watertreatment':
                return this.generateWaterPID(projectData, calculatedResults);
                
            case 'hvac':
            case 'chiller':
            case 'cooling':
                return this.generateHVACPID(projectData, calculatedResults);
                
            case 'stormwater':
            case 'drainage':
                return this.generateStormwaterPID(projectData, calculatedResults);
                
            case 'pump':
            case 'pumpstation':
                return this.generatePumpStationPID(projectData, calculatedResults);
                
            default:
                return this.generateGenericPID(projectData, calculatedResults);
        }
    }
    
    // ========================================================================
    // WWTP P&ID GENERATION
    // ========================================================================
    generateWWTPPID(data, results) {
        console.log('Generating WWTP P&ID...');
        
        let x = this.config.margin;
        let y = 400;
        const spacing = this.config.equipSpacing;
        
        // Title block
        this.drawTitleBlock(
            data.projectName || 'Wastewater Treatment Plant',
            'PID-001',
            'Process Flow Diagram'
        );
        
        // 1. INFLUENT STRUCTURE
        const influent = this.addEquipment({
            type: 'tank',
            tag: this.getTag('T'),
            name: 'Influent\nStructure',
            x: x,
            y: y,
            width: 80,
            height: 100,
            specs: [
                `Flow: ${data.flow || results.designFlow || '1.0'} MGD`,
                `BOD: ${data.influent?.bod || results.influentBOD || '250'} mg/L`,
                `TSS: ${data.influent?.tss || results.influentTSS || '280'} mg/L`
            ]
        });
        
        // Flow meter on influent
        this.addInstrument({
            type: 'flow',
            tag: this.getTag('FI'),
            name: 'Influent Flow',
            x: x + 40,
            y: y - 80,
            connectedTo: influent.tag
        });
        
        x += spacing;
        
        // 2. PRIMARY CLARIFIER (if exists)
        if (results.hasPrimary || data.primaryClarifier) {
            const primary = this.addEquipment({
                type: 'clarifier',
                tag: 'CL-001',
                name: 'Primary\nClarifier',
                x: x,
                y: y,
                width: 100,
                height: 100,
                specs: [
                    `Diameter: ${results.primaryDiameter || '40'} ft`,
                    `Depth: ${results.primaryDepth || '10'} ft`,
                    `SOR: ${results.primarySOR || '600'} gpd/sf`
                ]
            });
            
            // Connect influent to primary
            this.drawPipe(influent.x + influent.width, y + 50, primary.x, y + 50);
            
            // Add valve
            this.addValve({
                tag: this.getTag('V'),
                x: (influent.x + influent.width + primary.x) / 2,
                y: y + 50
            });
            
            x += spacing;
        }
        
        // 3. AERATION BASIN (main biological reactor)
        const aeration = this.addEquipment({
            type: 'reactor',
            tag: 'R-001',
            name: 'Aeration\nBasin',
            x: x,
            y: y,
            width: 120,
            height: 120,
            specs: [
                `Volume: ${results.tankVolume || results.aerationVolume || '1000'} MG`,
                `MLSS: ${results.mlss || data.mlss || '3000'} mg/L`,
                `SRT: ${results.srt || data.srt || '10'} days`,
                `HRT: ${results.hrt || '8'} hours`
            ]
        });
        
        // DO sensor
        this.addInstrument({
            type: 'analyzer',
            tag: 'AI-001',
            name: 'DO Analyzer',
            x: x + 60,
            y: y + 140,
            connectedTo: aeration.tag
        });
        
        // Connect to aeration
        if (results.hasPrimary) {
            this.drawPipe(x - spacing, y + 50, aeration.x, y + 60);
        } else {
            this.drawPipe(influent.x + influent.width, y + 50, aeration.x, y + 60);
        }
        
        x += spacing + 40;
        
        // 4. SECONDARY CLARIFIER
        const secondary = this.addEquipment({
            type: 'clarifier',
            tag: 'CL-002',
            name: 'Secondary\nClarifier',
            x: x,
            y: y,
            width: 100,
            height: 100,
            specs: [
                `Diameter: ${results.secondaryDiameter || '60'} ft`,
                `Depth: ${results.secondaryDepth || '12'} ft`,
                `SOR: ${results.secondarySOR || '500'} gpd/sf`
            ]
        });
        
        // TSS analyzer on clarifier effluent
        this.addInstrument({
            type: 'analyzer',
            tag: 'AI-002',
            name: 'TSS Analyzer',
            x: x + 50,
            y: y - 80,
            connectedTo: secondary.tag
        });
        
        // Connect aeration to secondary
        this.drawPipe(aeration.x + aeration.width, y + 60, secondary.x, y + 50);
        
        x += spacing;
        
        // 5. EFFLUENT STRUCTURE
        const effluent = this.addEquipment({
            type: 'tank',
            tag: this.getTag('T'),
            name: 'Effluent\nStructure',
            x: x,
            y: y,
            width: 80,
            height: 100,
            specs: [
                `BOD: ${results.effluentBOD || '10'} mg/L`,
                `TSS: ${results.effluentTSS || '10'} mg/L`,
                `Flow: ${data.flow || '1.0'} MGD`
            ]
        });
        
        // Effluent flow meter
        this.addInstrument({
            type: 'flow',
            tag: this.getTag('FI'),
            name: 'Effluent Flow',
            x: x + 40,
            y: y - 80,
            connectedTo: effluent.tag
        });
        
        // Connect secondary to effluent
        this.drawPipe(secondary.x + secondary.width, y + 50, effluent.x, y + 50);
        
        // 6. RAS (Return Activated Sludge) PUMP
        const rasPump = this.addEquipment({
            type: 'pump',
            tag: this.getTag('P'),
            name: 'RAS Pump',
            x: secondary.x + 50,
            y: y + 180,
            width: 50,
            height: 50,
            specs: [
                `Flow: ${results.rasFlow || data.rasFlow || '0.5'} MGD`,
                `Rate: ${results.rasRate || '50'}%`
            ]
        });
        
        // RAS flow meter
        this.addInstrument({
            type: 'flow',
            tag: this.getTag('FI'),
            name: 'RAS Flow',
            x: rasPump.x + 25,
            y: rasPump.y + 70,
            connectedTo: rasPump.tag
        });
        
        // RAS piping: clarifier -> pump -> aeration
        this.drawPipe(secondary.x + 50, secondary.y + secondary.height, 
                     secondary.x + 50, rasPump.y + 25);
        this.drawPipe(rasPump.x - 30, rasPump.y + 25, 
                     rasPump.x, rasPump.y + 25);
        this.drawPipe(rasPump.x + rasPump.width, rasPump.y + 25, 
                     aeration.x + 60, rasPump.y + 25);
        this.drawPipe(aeration.x + 60, rasPump.y + 25, 
                     aeration.x + 60, aeration.y + aeration.height);
        
        // 7. WAS (Waste Activated Sludge) LINE
        const wasX = rasPump.x - 80;
        const wasY = rasPump.y + 25;
        
        this.addValve({
            tag: 'V-WAS',
            name: 'WAS Control',
            x: wasX,
            y: wasY
        });
        
        this.drawPipe(wasX - 40, wasY, wasX, wasY);
        this.addText('To Sludge\nHandling', wasX - 80, wasY);
        
        // Add WAS flow indicator
        this.addInstrument({
            type: 'flow',
            tag: this.getTag('FI'),
            name: 'WAS Flow',
            x: wasX,
            y: wasY - 50,
            measurement: `${results.wasFlow || '0.1'} MGD`
        });
        
        console.log('✅ WWTP P&ID Generated');
        return this.exportPID();
    }
    
    // ========================================================================
    // HVAC P&ID GENERATION
    // ========================================================================
    generateHVACPID(data, results) {
        console.log('Generating HVAC P&ID...');
        
        let x = this.config.margin;
        let y = 400;
        const spacing = this.config.equipSpacing;
        
        this.drawTitleBlock(
            data.projectName || 'HVAC System',
            'PID-HVAC-001',
            'Chilled Water System'
        );
        
        // 1. CHILLER
        const chiller = this.addEquipment({
            type: 'chiller',
            tag: 'CH-001',
            name: 'Water-Cooled\nChiller',
            x: x,
            y: y - 80,
            width: 120,
            height: 160,
            specs: [
                `Capacity: ${results.coolingLoad || data.coolingLoad || '500'} tons`,
                `CHW: 44°F supply / 54°F return`,
                `CW: 85°F / 95°F`,
                `Power: ${results.chillerPower || '250'} kW`
            ]
        });
        
        // Chiller controls
        this.addInstrument({
            type: 'controller',
            tag: 'TIC-001',
            name: 'CHW Temp Control',
            x: x + 60,
            y: y - 120,
            connectedTo: chiller.tag
        });
        
        x += spacing + 40;
        
        // 2. CHW PUMP
        const chwPump = this.addEquipment({
            type: 'pump',
            tag: this.getTag('P'),
            name: 'CHW Pump',
            x: x,
            y: y,
            width: 60,
            height: 60,
            specs: [
                `Flow: ${results.chwFlow || '1200'} GPM`,
                `Head: ${results.chwHead || '80'} ft`,
                `Power: ${results.pumpPower || '25'} HP`
            ]
        });
        
        // CHW supply pipe from chiller
        this.drawPipe(chiller.x + chiller.width, y + 20, chwPump.x, y + 30, 'CHW Supply\n44°F');
        
        // CHW flow meter
        this.addInstrument({
            type: 'flow',
            tag: this.getTag('FI'),
            name: 'CHW Flow',
            x: (chiller.x + chiller.width + chwPump.x) / 2,
            y: y - 20,
            measurement: `${results.chwFlow || '1200'} GPM`
        });
        
        // Pressure gauges
        this.addInstrument({
            type: 'pressure',
            tag: this.getTag('PI'),
            name: 'Discharge',
            x: chwPump.x + chwPump.width + 20,
            y: y + 30
        });
        
        x += spacing;
        
        // 3. AHUs (Air Handling Units) - show as load
        const ahu = this.addEquipment({
            type: 'heatex',
            tag: 'AHU-01',
            name: 'Air Handling\nUnits',
            x: x,
            y: y,
            width: 100,
            height: 100,
            specs: [
                `Cooling Coils`,
                `Airflow: ${results.airflow || '20000'} CFM`,
                `Load: ${results.coolingLoad || '500'} tons`
            ]
        });
        
        // CHW to AHUs
        this.drawPipe(chwPump.x + chwPump.width, y + 30, ahu.x, y + 40);
        
        // Balancing valve
        this.addValve({
            tag: 'V-BAL-001',
            name: 'Balance',
            x: (chwPump.x + chwPump.width + ahu.x) / 2,
            y: y + 30
        });
        
        x += spacing;
        
        // 4. CHW RETURN
        const returnY = y + 160;
        
        // Return pipe from AHUs back to chiller
        this.drawPipe(ahu.x + ahu.width / 2, ahu.y + ahu.height, 
                     ahu.x + ahu.width / 2, returnY, 'CHW Return\n54°F');
        this.drawPipe(ahu.x + ahu.width / 2, returnY, 
                     chiller.x + 60, returnY);
        this.drawPipe(chiller.x + 60, returnY, 
                     chiller.x + 60, chiller.y + chiller.height);
        
        // Return temp sensor
        this.addInstrument({
            type: 'temperature',
            tag: this.getTag('TI'),
            name: 'Return Temp',
            x: ahu.x + ahu.width / 2 + 30,
            y: returnY - 30,
            measurement: '54°F'
        });
        
        // 5. COOLING TOWER (simplified)
        const tower = this.addEquipment({
            type: 'tower',
            tag: 'CT-001',
            name: 'Cooling\nTower',
            x: chiller.x + 160,
            y: y - 200,
            width: 100,
            height: 120,
            specs: [
                `Capacity: ${results.towerCapacity || '600'} tons`,
                `CW Flow: ${results.cwFlow || '1800'} GPM`,
                `85°F inlet / 95°F outlet`
            ]
        });
        
        // Condenser water pump
        const cwPump = this.addEquipment({
            type: 'pump',
            tag: this.getTag('P'),
            name: 'CW Pump',
            x: tower.x + 40,
            y: y - 40,
            width: 60,
            height: 60,
            specs: [
                `Flow: ${results.cwFlow || '1800'} GPM`,
                `Head: ${results.cwHead || '60'} ft`
            ]
        });
        
        // CW supply to chiller
        this.drawPipe(cwPump.x + cwPump.width, y - 10, 
                     chiller.x + chiller.width, y - 10);
        
        // CW return to tower
        this.drawPipe(chiller.x + chiller.width, y + 60, 
                     tower.x + 50, y + 60);
        this.drawPipe(tower.x + 50, y + 60, 
                     tower.x + 50, tower.y + tower.height);
        
        // Tower supply to pump
        this.drawPipe(tower.x + 50, tower.y + tower.height, 
                     tower.x + 50, cwPump.y + 30);
        this.drawPipe(tower.x + 50, cwPump.y + 30, 
                     cwPump.x, cwPump.y + 30);
        
        console.log('✅ HVAC P&ID Generated');
        return this.exportPID();
    }
    
    // ========================================================================
    // WATER TREATMENT P&ID GENERATION
    // ========================================================================
    generateWaterPID(data, results) {
        console.log('Generating Water Treatment P&ID...');
        
        let x = this.config.margin;
        let y = 400;
        const spacing = this.config.equipSpacing;
        
        this.drawTitleBlock(
            data.projectName || 'Water Treatment Plant',
            'PID-WTP-001',
            'Treatment Process Flow'
        );
        
        // 1. RAW WATER INTAKE
        const intake = this.addEquipment({
            type: 'tank',
            tag: this.getTag('T'),
            name: 'Raw Water\nIntake',
            x: x,
            y: y,
            width: 80,
            height: 100,
            specs: [
                `Flow: ${data.flow || results.designFlow || '5'} MGD`,
                `Turbidity: ${data.turbidity || '15'} NTU`,
                `pH: ${data.pH || '7.2'}`
            ]
        });
        
        // Raw water quality
        this.addInstrument({
            type: 'analyzer',
            tag: 'QI-001',
            name: 'Raw Water Quality',
            x: x + 40,
            y: y - 60
        });
        
        x += spacing;
        
        // 2. COAGULATION / RAPID MIX
        const coag = this.addEquipment({
            type: 'reactor',
            tag: 'MX-001',
            name: 'Rapid Mix\nCoagulation',
            x: x,
            y: y,
            width: 90,
            height: 90,
            specs: [
                `Alum: ${results.alumDose || data.alumDose || '25'} mg/L`,
                `Mixing: ${results.mixingPower || '100'} HP`,
                `Detention: 2 min`
            ]
        });
        
        // Alum feed point
        this.addChemicalFeed('Alum', x + 45, y - 40, results.alumDose || '25');
        
        // Connect intake to coag
        this.drawPipe(intake.x + intake.width, y + 50, coag.x, y + 45);
        
        x += spacing;
        
        // 3. FLOCCULATION
        const floc = this.addEquipment({
            type: 'reactor',
            tag: 'FL-001',
            name: 'Flocculation\nBasin',
            x: x,
            y: y,
            width: 100,
            height: 100,
            specs: [
                `Detention: ${results.flocTime || '30'} min`,
                `GT: ${results.gt || '50000'}`,
                `Polymer: ${results.polymerDose || '0.5'} mg/L`
            ]
        });
        
        // Polymer feed
        if (results.polymerDose > 0) {
            this.addChemicalFeed('Polymer', x + 50, y - 40, results.polymerDose);
        }
        
        // Connect coag to floc
        this.drawPipe(coag.x + coag.width, y + 45, floc.x, y + 50);
        
        x += spacing;
        
        // 4. SEDIMENTATION / CLARIFIER
        const sed = this.addEquipment({
            type: 'clarifier',
            tag: 'CL-001',
            name: 'Sedimentation\nBasin',
            x: x,
            y: y,
            width: 110,
            height: 110,
            specs: [
                `OFR: ${results.ofr || '1000'} gpd/sf`,
                `Depth: ${results.sedDepth || '12'} ft`,
                `Turbidity Out: <2 NTU`
            ]
        });
        
        // Turbidity monitor
        this.addInstrument({
            type: 'analyzer',
            tag: 'AI-002',
            name: 'Turbidity',
            x: x + 55,
            y: y - 60,
            measurement: '<2 NTU'
        });
        
        // Connect floc to sed
        this.drawPipe(floc.x + floc.width, y + 50, sed.x, y + 55);
        
        x += spacing;
        
        // 5. FILTRATION
        const filter = this.addEquipment({
            type: 'filter',
            tag: 'F-001',
            name: 'Sand Filters',
            x: x,
            y: y,
            width: 100,
            height: 120,
            specs: [
                `Rate: ${results.filterRate || '3'} gpm/sf`,
                `Media: Sand/Anthracite`,
                `Backwash: Auto`
            ]
        });
        
        // Connect sed to filter
        this.drawPipe(sed.x + sed.width, y + 55, filter.x, y + 60);
        
        // Filter pump
        const filterPump = this.addEquipment({
            type: 'pump',
            tag: this.getTag('P'),
            name: 'Filter Pump',
            x: (sed.x + sed.width + filter.x) / 2 - 25,
            y: y + 120,
            width: 50,
            height: 50,
            specs: [`Flow: ${data.flow || '5'} MGD`]
        });
        
        x += spacing;
        
        // 6. DISINFECTION / CLEARWELL
        const clearwell = this.addEquipment({
            type: 'tank',
            tag: this.getTag('T'),
            name: 'Clearwell\nChlorination',
            x: x,
            y: y,
            width: 100,
            height: 120,
            specs: [
                `Volume: ${results.clearwellVolume || '1.0'} MG`,
                `Cl2: ${results.chlorineDose || data.chlorineDose || '2'} mg/L`,
                `Contact: ${results.contactTime || '30'} min`,
                `Residual: 0.5 mg/L`
            ]
        });
        
        // Chlorine feed
        this.addChemicalFeed('Cl2', x + 50, y - 40, results.chlorineDose || '2');
        
        // Chlorine residual monitor
        this.addInstrument({
            type: 'analyzer',
            tag: 'AI-003',
            name: 'Cl2 Residual',
            x: x + 50,
            y: y + 140,
            measurement: '0.5 mg/L'
        });
        
        // Connect filter to clearwell
        this.drawPipe(filter.x + filter.width, y + 60, clearwell.x, y + 60);
        
        x += spacing;
        
        // 7. FINISHED WATER
        const finished = this.addEquipment({
            type: 'tank',
            tag: this.getTag('T'),
            name: 'Finished\nWater',
            x: x,
            y: y,
            width: 80,
            height: 100,
            specs: [
                `Flow: ${data.flow || '5'} MGD`,
                `Turbidity: <0.3 NTU`,
                `pH: ${results.finalpH || '7.5'}`
            ]
        });
        
        // Final quality monitor
        this.addInstrument({
            type: 'analyzer',
            tag: 'QI-002',
            name: 'Finished Quality',
            x: x + 40,
            y: y - 60
        });
        
        // Connect clearwell to finished
        this.drawPipe(clearwell.x + clearwell.width, y + 60, finished.x, y + 50);
        
        console.log('✅ Water Treatment P&ID Generated');
        return this.exportPID();
    }
    
    // ========================================================================
    // STORMWATER P&ID GENERATION
    // ========================================================================
    generateStormwaterPID(data, results) {
        console.log('Generating Stormwater P&ID...');
        
        let x = this.config.margin;
        let y = 400;
        const spacing = this.config.equipSpacing;
        
        this.drawTitleBlock(
            data.projectName || 'Stormwater Management',
            'PID-SW-001',
            'Drainage & Detention System'
        );
        
        // 1. DRAINAGE AREA / INLET
        const inlet = this.addEquipment({
            type: 'inlet',
            tag: 'IN-001',
            name: 'Storm Inlet\nDrainage Area',
            x: x,
            y: y,
            width: 90,
            height: 90,
            specs: [
                `Area: ${data.area || results.drainageArea || '10'} acres`,
                `C: ${results.runoffCoeff || data.runoffCoeff || '0.65'}`,
                `Q: ${results.peakFlow || '15'} cfs`
            ]
        });
        
        x += spacing;
        
        // 2. INLET STRUCTURE
        const inletStruct = this.addEquipment({
            type: 'manhole',
            tag: 'MH-001',
            name: 'Inlet\nStructure',
            x: x,
            y: y,
            width: 70,
            height: 70,
            specs: [
                `Type: Curb Inlet`,
                `Grate Area: ${results.grateArea || '4'} sf`
            ]
        });
        
        // Flow meter
        this.addInstrument({
            type: 'flow',
            tag: this.getTag('FI'),
            name: 'Inlet Flow',
            x: x + 35,
            y: y - 60,
            measurement: `${results.peakFlow || '15'} cfs`
        });
        
        // Connect drainage to inlet
        this.drawPipe(inlet.x + inlet.width, y + 45, inletStruct.x, y + 35);
        
        x += spacing;
        
        // 3. STORM SEWER
        const pipeLength = 120;
        this.drawPipe(inletStruct.x + inletStruct.width, y + 35, 
                     inletStruct.x + inletStruct.width + pipeLength, y + 35);
        this.addText(`${results.pipeSize || '24'}" Storm Sewer\nSlope: ${results.slope || '0.5'}%`, 
                    inletStruct.x + inletStruct.width + pipeLength/2, y);
        
        x += pipeLength;
        
        // 4. DETENTION BASIN
        const detention = this.addEquipment({
            type: 'basin',
            tag: 'DET-001',
            name: 'Detention\nBasin',
            x: x,
            y: y - 40,
            width: 140,
            height: 140,
            specs: [
                `Volume: ${results.detentionVolume || '50000'} cf`,
                `Depth: ${results.pondingDepth || '6'} ft`,
                `Area: ${results.basinArea || '8000'} sf`,
                `Outlet: ${results.outletSize || '12'}" orifice`
            ]
        });
        
        // Water level sensor
        this.addInstrument({
            type: 'level',
            tag: this.getTag('LI'),
            name: 'Water Level',
            x: x + 70,
            y: y - 80,
            connectedTo: detention.tag
        });
        
        // Inflow pipe
        this.drawPipe(x - pipeLength + inletStruct.width, y + 35, 
                     detention.x, y + 30);
        
        x += spacing + 40;
        
        // 5. OUTLET STRUCTURE
        const outlet = this.addEquipment({
            type: 'manhole',
            tag: 'MH-002',
            name: 'Outlet\nStructure',
            x: x,
            y: y,
            width: 70,
            height: 90,
            specs: [
                `Orifice: ${results.outletSize || '12'}"`,
                `Control: ${results.outletType || 'Orifice Plate'}`,
                `Q out: ${results.outflowRate || '5'} cfs`
            ]
        });
        
        // Outflow meter
        this.addInstrument({
            type: 'flow',
            tag: this.getTag('FI'),
            name: 'Outlet Flow',
            x: x + 35,
            y: y - 60,
            measurement: `${results.outflowRate || '5'} cfs`
        });
        
        // Connect detention to outlet
        this.drawPipe(detention.x + detention.width, y + 30, outlet.x, y + 45);
        
        x += spacing;
        
        // 6. DISCHARGE TO STREAM/SEWER
        const discharge = this.addEquipment({
            type: 'outlet',
            tag: 'OUT-001',
            name: 'Discharge\nto Stream',
            x: x,
            y: y,
            width: 80,
            height: 80,
            specs: [
                `Receiving: ${data.receivingWater || 'Local Creek'}`,
                `Q: ${results.outflowRate || '5'} cfs`
            ]
        });
        
        // Connect outlet to discharge
        this.drawPipe(outlet.x + outlet.width, y + 45, discharge.x, y + 40);
        
        // Optional: Emergency Overflow
        const overflow = detention.y - 60;
        this.addValve({
            tag: 'EMG-001',
            name: 'Emergency\nOverflow',
            x: detention.x + 70,
            y: overflow
        });
        this.drawPipe(detention.x + 70, overflow, detention.x + 70, detention.y);
        
        console.log('✅ Stormwater P&ID Generated');
        return this.exportPID();
    }
    
    // ========================================================================
    // PUMP STATION P&ID GENERATION
    // ========================================================================
    generatePumpStationPID(data, results) {
        console.log('Generating Pump Station P&ID...');
        
        let x = this.config.margin;
        let y = 400;
        const spacing = this.config.equipSpacing;
        
        this.drawTitleBlock(
            data.projectName || 'Pump Station',
            'PID-PS-001',
            'Pumping System'
        );
        
        // 1. WET WELL
        const wetwell = this.addEquipment({
            type: 'tank',
            tag: this.getTag('T'),
            name: 'Wet Well',
            x: x,
            y: y,
            width: 100,
            height: 120,
            specs: [
                `Capacity: ${results.wetwellVolume || '5000'} gal`,
                `Inflow: ${data.flowRate || results.designFlow || '500'} GPM`,
                `Levels: HH/H/L/LL`
            ]
        });
        
        // Level sensors
        this.addInstrument({
            type: 'level',
            tag: 'LSH-001',
            name: 'Level High',
            x: x + 110,
            y: y + 20
        });
        
        this.addInstrument({
            type: 'level',
            tag: 'LSL-001',
            name: 'Level Low',
            x: x + 110,
            y: y + 80
        });
        
        x += spacing;
        
        // 2. LEAD PUMP
        const pump1 = this.addEquipment({
            type: 'pump',
            tag: this.getTag('P'),
            name: 'Lead Pump',
            x: x,
            y: y + 30,
            width: 60,
            height: 60,
            specs: [
                `Flow: ${data.flowRate || results.pumpFlow || '500'} GPM`,
                `Head: ${data.tdh || results.tdh || '80'} ft`,
                `Power: ${results.pumpPower || '15'} HP`
            ]
        });
        
        // Pump suction valve
        this.addValve({
            tag: 'V-S1',
            name: 'Suction',
            x: (wetwell.x + wetwell.width + pump1.x) / 2,
            y: pump1.y + 30
        });
        
        // Connect wetwell to pump
        this.drawPipe(wetwell.x + wetwell.width, pump1.y + 30, pump1.x, pump1.y + 30);
        
        // Pump discharge valve
        const dischargeX = pump1.x + pump1.width + 40;
        this.addValve({
            tag: 'V-D1',
            name: 'Discharge',
            x: dischargeX,
            y: pump1.y + 30
        });
        
        // Check valve
        this.addValve({
            type: 'check',
            tag: 'CV-1',
            x: pump1.x + pump1.width + 20,
            y: pump1.y + 30
        });
        
        // Pressure gauge
        this.addInstrument({
            type: 'pressure',
            tag: this.getTag('PI'),
            name: 'Discharge\nPressure',
            x: dischargeX,
            y: pump1.y - 30,
            measurement: `${results.dischargePressure || '35'} psi`
        });
        
        // 3. LAG PUMP (if duty+standby)
        if (results.numPumps > 1 || data.redundancy) {
            const pump2 = this.addEquipment({
                type: 'pump',
                tag: this.getTag('P'),
                name: 'Lag Pump',
                x: x,
                y: y + 120,
                width: 60,
                height: 60,
                specs: [
                    `Flow: ${data.flowRate || '500'} GPM`,
                    `Head: ${data.tdh || '80'} ft`,
                    `(Standby)`
                ]
            });
            
            // Pump 2 suction
            this.addValve({
                tag: 'V-S2',
                x: (wetwell.x + wetwell.width + pump2.x) / 2,
                y: pump2.y + 30
            });
            
            this.drawPipe(wetwell.x + wetwell.width, pump2.y + 30, pump2.x, pump2.y + 30);
            
            // Pump 2 discharge
            this.addValve({
                tag: 'V-D2',
                x: pump2.x + pump2.width + 40,
                y: pump2.y + 30
            });
            
            this.addValve({
                type: 'check',
                tag: 'CV-2',
                x: pump2.x + pump2.width + 20,
                y: pump2.y + 30
            });
            
            // Connect pump 2 to header
            this.drawPipe(pump2.x + pump2.width, pump2.y + 30, 
                         dischargeX + 40, pump2.y + 30);
            this.drawPipe(dischargeX + 40, pump2.y + 30, 
                         dischargeX + 40, pump1.y + 30);
        }
        
        x = dischargeX + 60;
        
        // 4. DISCHARGE HEADER
        const headerLength = 100;
        this.drawPipe(dischargeX + 40, pump1.y + 30, 
                     x + headerLength, pump1.y + 30);
        this.addText(`${results.pipeSize || '6'}" Force Main`, 
                    x + headerLength/2, pump1.y);
        
        // Flow meter on discharge
        this.addInstrument({
            type: 'flow',
            tag: this.getTag('FI'),
            name: 'Total Flow',
            x: x + headerLength/2,
            y: pump1.y - 20,
            measurement: `${data.flowRate || '500'} GPM`
        });
        
        x += headerLength + spacing;
        
        // 5. DISCHARGE POINT
        const discharge = this.addEquipment({
            type: 'outlet',
            tag: 'OUT-001',
            name: 'To Collection\nSystem',
            x: x,
            y: y + 30,
            width: 80,
            height: 80,
            specs: [
                `Elevation: ${results.dischargeElevation || '150'} ft`,
                `Static Head: ${results.staticHead || '50'} ft`
            ]
        });
        
        this.drawPipe(x - headerLength - spacing + headerLength, pump1.y + 30, 
                     discharge.x, y + 70);
        
        console.log('✅ Pump Station P&ID Generated');
        return this.exportPID();
    }
    
    // ========================================================================
    // GENERIC P&ID GENERATION
    // ========================================================================
    generateGenericPID(data, results) {
        console.log('Generating Generic P&ID...');
        
        this.drawTitleBlock(
            data.projectName || 'Process System',
            'PID-GEN-001',
            'Process Flow Diagram'
        );
        
        let x = this.config.margin;
        let y = 400;
        
        // Create simple linear flow based on available data
        const equipment = [];
        
        // Try to extract equipment from data
        if (data.equipment) {
            Object.keys(data.equipment).forEach((key, i) => {
                equipment.push({
                    type: 'equipment',
                    tag: `E-${String(i+1).padStart(3,'0')}`,
                    name: key,
                    x: x + i * this.config.equipSpacing,
                    y: y,
                    specs: [JSON.stringify(data.equipment[key])]
                });
            });
        }
        
        // Add generic process units
        if (equipment.length === 0) {
            equipment.push({
                type: 'tank',
                tag: 'T-001',
                name: 'Feed Tank',
                x: x,
                y: y
            });
            
            equipment.push({
                type: 'pump',
                tag: 'P-001',
                name: 'Transfer Pump',
                x: x + this.config.equipSpacing,
                y: y
            });
            
            equipment.push({
                type: 'vessel',
                tag: 'V-001',
                name: 'Process Vessel',
                x: x + this.config.equipSpacing * 2,
                y: y
            });
        }
        
        // Draw equipment
        equipment.forEach(equip => {
            this.addEquipment(equip);
        });
        
        // Connect with pipes
        for (let i = 0; i < equipment.length - 1; i++) {
            this.drawPipe(
                equipment[i].x + (equipment[i].width || 60),
                equipment[i].y + 30,
                equipment[i+1].x,
                equipment[i+1].y + 30
            );
        }
        
        console.log('✅ Generic P&ID Generated');
        return this.exportPID();
    }
    
    // ========================================================================
    // DRAWING PRIMITIVES
    // ========================================================================
    clearCanvas() {
        this.ctx.fillStyle = '#0a0e14';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    drawGrid() {
        const gridSize = 20;
        this.ctx.strokeStyle = this.config.colors.grid;
        this.ctx.lineWidth = 0.5;
        
        for (let x = 0; x < this.canvas.width; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        
        for (let y = 0; y < this.canvas.height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }
    
    drawTitleBlock(title, drawingNo, description) {
        const x = this.canvas.width - 400;
        const y = 30;
        
        this.ctx.strokeStyle = this.config.colors.equipment;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x, y, 380, 120);
        
        this.ctx.fillStyle = this.config.colors.text;
        this.ctx.font = 'bold 20px Outfit';
        this.ctx.fillText(title, x + 10, y + 30);
        
        this.ctx.font = '14px Outfit';
        this.ctx.fillText(`Drawing No: ${drawingNo}`, x + 10, y + 55);
        this.ctx.fillText(description, x + 10, y + 75);
        this.ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, x + 10, y + 95);
        this.ctx.fillText('AI Generated P&ID', x + 10, y + 115);
    }
    
    addEquipment(config) {
        const {type, tag, name, x, y, width = 80, height = 80, specs = []} = config;
        
        this.ctx.save();
        this.ctx.strokeStyle = this.config.colors.equipment;
        this.ctx.fillStyle = this.config.colors.equipment;
        this.ctx.lineWidth = this.config.lineWidth;
        
        // Draw equipment symbol based on type
        switch(type) {
            case 'pump':
                this.drawPump(x, y, width, height);
                break;
            case 'tank':
                this.drawTank(x, y, width, height);
                break;
            case 'clarifier':
                this.drawClarifier(x, y, width, height);
                break;
            case 'reactor':
            case 'basin':
                this.drawReactor(x, y, width, height);
                break;
            case 'vessel':
                this.drawVessel(x, y, width, height);
                break;
            case 'chiller':
                this.drawChiller(x, y, width, height);
                break;
            case 'heatex':
                this.drawHeatExchanger(x, y, width, height);
                break;
            case 'filter':
                this.drawFilter(x, y, width, height);
                break;
            case 'inlet':
            case 'manhole':
            case 'outlet':
                this.drawStructure(x, y, width, height);
                break;
            case 'tower':
                this.drawCoolingTower(x, y, width, height);
                break;
            default:
                this.ctx.strokeRect(x, y, width, height);
        }
        
        // Draw tag
        this.ctx.fillStyle = '#00ffc8';
        this.ctx.font = `bold ${this.config.tagFontSize}px JetBrains Mono`;
        this.ctx.fillText(tag, x, y - 10);
        
        // Draw name
        this.ctx.fillStyle = this.config.colors.text;
        this.ctx.font = `${this.config.fontSize}px Outfit`;
        const lines = name.split('\n');
        lines.forEach((line, i) => {
            this.ctx.fillText(line, x + width/2 - this.ctx.measureText(line).width/2, 
                            y + height/2 + i * 15);
        });
        
        // Draw specs below equipment
        if (specs.length > 0) {
            this.ctx.font = '10px JetBrains Mono';
            this.ctx.fillStyle = this.config.colors.text;
            specs.forEach((spec, i) => {
                this.ctx.fillText(spec, x, y + height + 20 + i * 12);
            });
        }
        
        this.ctx.restore();
        
        const obj = {type, tag, name, x, y, width, height, specs};
        this.objects.push(obj);
        return obj;
    }
    
    drawPump(x, y, w, h) {
        const cx = x + w/2;
        const cy = y + h/2;
        const r = Math.min(w, h) / 2;
        
        // Circle
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.ctx.stroke();
        
        // Center line
        this.ctx.beginPath();
        this.ctx.moveTo(cx - r/2, cy);
        this.ctx.lineTo(cx + r/2, cy);
        this.ctx.stroke();
    }
    
    drawTank(x, y, w, h) {
        // Rectangle
        this.ctx.strokeRect(x, y, w, h);
        
        // Roof
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x + w/2, y - 20);
        this.ctx.lineTo(x + w, y);
        this.ctx.stroke();
    }
    
    drawClarifier(x, y, w, h) {
        const cx = x + w/2;
        const cy = y + h/2;
        
        // Circle
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, w/2, 0, Math.PI * 2);
        this.ctx.stroke();
        
        // Center feed
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, w/6, 0, Math.PI * 2);
        this.ctx.stroke();
    }
    
    drawReactor(x, y, w, h) {
        // Rectangle with rounded corners
        const r = 10;
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + w - r, y);
        this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        this.ctx.lineTo(x + w, y + h - r);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.ctx.lineTo(x + r, y + h);
        this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y, x + r, y);
        this.ctx.stroke();
    }
    
    drawVessel(x, y, w, h) {
        const cx = x + w/2;
        const cy = y + h/2;
        
        // Ellipse
        this.ctx.beginPath();
        this.ctx.ellipse(cx, cy, w/2, h/2, 0, 0, Math.PI * 2);
        this.ctx.stroke();
    }
    
    drawChiller(x, y, w, h) {
        // Rectangle
        this.ctx.strokeRect(x, y, w, h);
        
        // Tubes (evaporator/condenser)
        const tubeY1 = y + h/3;
        const tubeY2 = y + 2*h/3;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x, tubeY1);
        this.ctx.lineTo(x + w, tubeY1);
        this.ctx.moveTo(x, tubeY2);
        this.ctx.lineTo(x + w, tubeY2);
        this.ctx.stroke();
    }
    
    drawHeatExchanger(x, y, w, h) {
        // Rectangle
        this.ctx.strokeRect(x, y, w, h);
        
        // X pattern
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x + w, y + h);
        this.ctx.moveTo(x + w, y);
        this.ctx.lineTo(x, y + h);
        this.ctx.stroke();
    }
    
    drawFilter(x, y, w, h) {
        // Rectangle
        this.ctx.strokeRect(x, y, w, h);
        
        // Media layers
        const layer1 = y + h/3;
        const layer2 = y + 2*h/3;
        
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(x, layer1);
        this.ctx.lineTo(x + w, layer1);
        this.ctx.moveTo(x, layer2);
        this.ctx.lineTo(x + w, layer2);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }
    
    drawStructure(x, y, w, h) {
        // Simple rectangle for structures
        this.ctx.strokeRect(x, y, w, h);
        
        // Diagonal line
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x + w, y + h);
        this.ctx.stroke();
    }
    
    drawCoolingTower(x, y, w, h) {
        // Trapezoid shape
        this.ctx.beginPath();
        this.ctx.moveTo(x + w/4, y);
        this.ctx.lineTo(x + 3*w/4, y);
        this.ctx.lineTo(x + w, y + h);
        this.ctx.lineTo(x, y + h);
        this.ctx.closePath();
        this.ctx.stroke();
        
        // Fill pattern
        this.ctx.fillStyle = 'rgba(0,212,255,0.1)';
        this.ctx.fill();
    }
    
    drawPipe(x1, y1, x2, y2, label = null) {
        this.ctx.strokeStyle = this.config.colors.pipe;
        this.ctx.lineWidth = this.config.lineWidth;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
        
        // Arrow at end
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowLen = 10;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x2, y2);
        this.ctx.lineTo(
            x2 - arrowLen * Math.cos(angle - Math.PI/6),
            y2 - arrowLen * Math.sin(angle - Math.PI/6)
        );
        this.ctx.moveTo(x2, y2);
        this.ctx.lineTo(
            x2 - arrowLen * Math.cos(angle + Math.PI/6),
            y2 - arrowLen * Math.sin(angle + Math.PI/6)
        );
        this.ctx.stroke();
        
        // Label
        if (label) {
            this.ctx.fillStyle = this.config.colors.text;
            this.ctx.font = '10px Outfit';
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const lines = label.split('\n');
            lines.forEach((line, i) => {
                this.ctx.fillText(line, midX, midY - 20 + i * 12);
            });
        }
    }
    
    addValve(config) {
        const {tag, name, x, y, type = 'gate'} = config;
        
        const size = 20;
        
        this.ctx.strokeStyle = this.config.colors.valve;
        this.ctx.lineWidth = this.config.lineWidth;
        
        // Diamond shape
        this.ctx.beginPath();
        this.ctx.moveTo(x, y - size/2);
        this.ctx.lineTo(x + size/2, y);
        this.ctx.lineTo(x, y + size/2);
        this.ctx.lineTo(x - size/2, y);
        this.ctx.closePath();
        this.ctx.stroke();
        
        // Tag
        this.ctx.fillStyle = this.config.colors.valve;
        this.ctx.font = 'bold 10px JetBrains Mono';
        this.ctx.fillText(tag, x - 15, y - size);
        
        if (name) {
            this.ctx.font = '9px Outfit';
            this.ctx.fillText(name, x - 20, y + size + 12);
        }
    }
    
    addInstrument(config) {
        const {type, tag, name, x, y, measurement, connectedTo} = config;
        
        const r = 18;
        
        this.ctx.strokeStyle = this.config.colors.instrument;
        this.ctx.lineWidth = this.config.lineWidth;
        
        // Circle
        this.ctx.beginPath();
        this.ctx.arc(x, y, r, 0, Math.PI * 2);
        this.ctx.stroke();
        
        // Letter
        let letter = type.charAt(0).toUpperCase();
        if (type === 'flow') letter = 'F';
        else if (type === 'pressure') letter = 'P';
        else if (type === 'level') letter = 'L';
        else if (type === 'temperature') letter = 'T';
        else if (type === 'analyzer') letter = 'A';
        else if (type === 'controller') letter = 'C';
        
        this.ctx.fillStyle = this.config.colors.instrument;
        this.ctx.font = 'bold 14px Outfit';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(letter, x, y);
        
        // Tag
        this.ctx.textAlign = 'left';
        this.ctx.font = 'bold 10px JetBrains Mono';
        this.ctx.fillText(tag, x + r + 5, y - 10);
        
        // Name
        if (name) {
            this.ctx.font = '9px Outfit';
            const lines = name.split('\n');
            lines.forEach((line, i) => {
                this.ctx.fillText(line, x + r + 5, y + 5 + i * 12);
            });
        }
        
        // Measurement
        if (measurement) {
            this.ctx.fillText(measurement, x + r + 5, y + 20);
        }
    }
    
    addChemicalFeed(chemical, x, y, dose) {
        // Arrow pointing down
        this.ctx.strokeStyle = '#ff9f43';
        this.ctx.fillStyle = '#ff9f43';
        this.ctx.lineWidth = 2;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x, y + 30);
        this.ctx.stroke();
        
        // Arrow head
        this.ctx.beginPath();
        this.ctx.moveTo(x, y + 30);
        this.ctx.lineTo(x - 5, y + 20);
        this.ctx.lineTo(x + 5, y + 20);
        this.ctx.closePath();
        this.ctx.fill();
        
        // Label
        this.ctx.font = 'bold 11px Outfit';
        this.ctx.fillText(`${chemical}`, x - 20, y - 5);
        this.ctx.font = '9px Outfit';
        this.ctx.fillText(`${dose} mg/L`, x - 20, y + 10);
    }
    
    addText(text, x, y) {
        this.ctx.fillStyle = this.config.colors.text;
        this.ctx.font = '11px Outfit';
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            this.ctx.fillText(line, x, y + i * 14);
        });
    }
    
    getTag(prefix) {
        const counter = this.tagCounters[prefix] || 1;
        this.tagCounters[prefix] = counter + 1;
        return `${prefix}-${String(counter).padStart(3, '0')}`;
    }
    
    // ========================================================================
    // EXPORT FUNCTIONS
    // ========================================================================
    exportPID() {
        console.log('✅ P&ID Generation Complete');
        console.log(`Generated ${this.objects.length} objects`);
        
        return {
            canvas: this.canvas,
            objects: this.objects,
            png: this.canvas.toDataURL('image/png'),
            svg: this.generateSVG()
        };
    }
    
    generateSVG() {
        // Simple SVG export (basic implementation)
        let svg = `<svg width="${this.canvas.width}" height="${this.canvas.height}" xmlns="http://www.w3.org/2000/svg">`;
        svg += `<rect width="100%" height="100%" fill="#0a0e14"/>`;
        // Add objects...
        svg += '</svg>';
        return svg;
    }
    
    downloadPNG(filename = 'PID-Drawing.png') {
        const link = document.createElement('a');
        link.download = filename;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }
    
    downloadPDF(filename = 'PID-Drawing.pdf') {
        const {jsPDF} = window.jspdf;
        const pdf = new jsPDF('landscape', 'mm', 'a3');
        
        const imgData = this.canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 10, 10, 400, 250);
        
        pdf.save(filename);
    }
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================
/*
// Initialize generator
const pidGen = new UniversalPIDGenerator('myCanvas');

// Generate WWTP P&ID
const wwtp = pidGen.generate(
    {
        projectName: 'Springfield WWTP',
        flow: 5.0,
        influent: { bod: 250, tss: 280 },
        mlss: 3000,
        srt: 10
    },
    {
        tankVolume: 1.5,
        hrt: 8,
        rasFlow: 2.5,
        rasRate: 50,
        effluentBOD: 8,
        effluentTSS: 10
    },
    'wwtp'
);

// Download
pidGen.downloadPNG();
pidGen.downloadPDF();
*/

console.log('✅ Universal P&ID Generator Loaded');
console.log('Use: new UniversalPIDGenerator() to create P&IDs from any platform');
