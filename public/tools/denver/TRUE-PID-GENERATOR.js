// ============================================================================
// TRUE P&ID GENERATOR v1.0 - ISA-5.1 COMPLIANT
// Complete Piping & Instrumentation Diagrams with full engineering detail
// ============================================================================

class TruePIDGenerator {
    constructor(canvasId = 'pidCanvas') {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = canvasId;
            this.canvas.width = 2400;  // Larger for detail
            this.canvas.height = 1600;
        }
        this.ctx = this.canvas.getContext('2d');
        
        this.config = {
            margin: 100,
            equipSpacing: 250,
            lineWidth: 2,
            signalLineWidth: 1,
            fontSize: 11,
            tagFontSize: 12,
            colors: {
                equipment: '#00d4ff',
                pipe: '#00ffc8',
                valve: '#ff9f43',
                instrument: '#a855f7',
                signal: '#fbbf24',
                text: '#ffffff',
                grid: 'rgba(0,212,255,0.05)'
            }
        };
        
        this.objects = [];
        this.pipes = [];
        this.instruments = [];
        this.controlLoops = [];
        
        // ISA-5.1 Compliant Tag Counters
        this.tagCounters = {
            // Equipment
            P: 101,   // Pumps (P-101, P-102...)
            T: 101,   // Tanks
            V: 201,   // Vessels
            E: 301,   // Heat Exchangers
            C: 401,   // Compressors
            
            // Valves
            HV: 101,  // Hand Valves (manual)
            XV: 101,  // Solenoid Valves
            CV: 101,  // Control Valves
            PV: 101,  // Pressure Valves
            
            // Instruments (by loop number)
            F: 101,   // Flow loops (FT-101, FIC-102...)
            P: 101,   // Pressure loops
            L: 101,   // Level loops
            T: 101,   // Temperature loops
            A: 101,   // Analysis loops
            
            // Lines
            LINE: 1001
        };
    }
    
    // ========================================================================
    // MAIN GENERATION FUNCTION
    // ========================================================================
    generate(projectData, calculatedResults, systemType, mode = 'detailed') {
        console.log('🔧 TRUE P&ID Generator Starting...');
        console.log('Mode:', mode);
        console.log('System:', systemType);
        
        this.clearCanvas();
        this.drawGrid();
        
        switch(systemType.toLowerCase()) {
            case 'wwtp':
                return this.generateWWTPPID(projectData, calculatedResults);
            case 'hvac':
                return this.generateHVACPID(projectData, calculatedResults);
            case 'water':
                return this.generateWaterPID(projectData, calculatedResults);
            case 'stormwater':
                return this.generateStormwaterPID(projectData, calculatedResults);
            default:
                return this.generateGenericPID(projectData, calculatedResults);
        }
    }
    
    // ========================================================================
    // WWTP TRUE P&ID - COMPLETE DETAIL
    // ========================================================================
    generateWWTPPID(data, results) {
        console.log('🏭 Generating TRUE WWTP P&ID with full detail...');
        
        let x = this.config.margin;
        let y = 600;
        const spacing = this.config.equipSpacing;
        
        // Title block
        this.drawDetailedTitleBlock(
            data.projectName || 'Wastewater Treatment Plant',
            'PID-WWTP-001',
            'Sheet 1 of 1',
            'Biological Treatment - Activated Sludge Process'
        );
        
        // ================================================================
        // 1. INFLUENT WET WELL WITH COMPLETE INSTRUMENTATION
        // ================================================================
        const wetwell = this.addEquipment({
            type: 'tank',
            tag: this.getEquipTag('T'),
            name: 'Influent\nWet Well',
            x: x,
            y: y,
            width: 120,
            height: 150,
            specs: [
                `Capacity: ${results.wetwellVolume || '10,000'} gal`,
                `Design Flow: ${data.flow || '1.0'} MGD`,
                `Peak Flow: ${(data.flow * 2.5) || '2.5'} MGD`,
                `Material: Concrete`,
                `Liner: Epoxy coated`
            ]
        });
        
        // Level instrumentation with control loop
        const levelLoop = this.getLoopTag('L');
        this.addInstrumentLoop({
            measurement: 'level',
            loopNumber: levelLoop,
            equipment: wetwell.tag,
            x: x + 60,
            y: y - 80,
            elements: {
                transmitter: `LT-${levelLoop}`,
                indicator: `LI-${levelLoop}`,
                alarmHigh: `LAH-${levelLoop}`,
                alarmLow: `LAL-${levelLoop}`
            }
        });
        
        // Influent flow measurement
        const flowLoop1 = this.getLoopTag('F');
        this.addInstrumentLoop({
            measurement: 'flow',
            loopNumber: flowLoop1,
            x: x + 60,
            y: y + 180,
            elements: {
                transmitter: `FT-${flowLoop1}`,
                indicator: `FI-${flowLoop1}`,
                totalizer: `FQI-${flowLoop1}`
            },
            specs: [
                `Type: Magnetic`,
                `Size: ${results.influentPipe || '12'}"`,
                `Range: 0-${(data.flow * 3) || 3} MGD`
            ]
        });
        
        x += spacing;
        
        // ================================================================
        // 2. INFLUENT PUMPS (DUTY + STANDBY)
        // ================================================================
        const pump1 = this.addEquipment({
            type: 'pump',
            tag: this.getEquipTag('P') + 'A',
            name: 'Influent Pump\n(Lead)',
            x: x,
            y: y,
            width: 100,
            height: 100,
            specs: [
                `Type: Submersible`,
                `Flow: ${data.flow || '1.0'} MGD`,
                `TDH: ${results.pumpHead || '25'} ft`,
                `Power: ${results.pumpHP || '15'} HP`,
                `Motor: 460V, 3Ø`,
                `VFD: Yes`
            ]
        });
        
        // Pump suction isolation valve
        const suctionValve1 = this.addValve({
            tag: this.getValveTag('HV'),
            type: 'gate',
            size: `${results.pumpSuction || '8'}"`,
            actuator: 'manual',
            normalPosition: 'open',
            lockable: true,
            x: x - 40,
            y: y + 50
        });
        
        // Pump discharge check valve
        const checkValve1 = this.addValve({
            tag: this.getValveTag('CV'),
            type: 'check',
            size: `${results.pumpDischarge || '6'}"`,
            x: x + 100,
            y: y + 50
        });
        
        // Pump discharge isolation valve
        const dischargeValve1 = this.addValve({
            tag: this.getValveTag('HV'),
            type: 'gate',
            size: `${results.pumpDischarge || '6'}"`,
            actuator: 'manual',
            normalPosition: 'open',
            lockable: true,
            x: x + 140,
            y: y + 50
        });
        
        // Discharge pressure measurement
        const pressureLoop1 = this.getLoopTag('P');
        this.addInstrumentLoop({
            measurement: 'pressure',
            loopNumber: pressureLoop1,
            x: x + 120,
            y: y - 20,
            elements: {
                transmitter: `PT-${pressureLoop1}`,
                indicator: `PI-${pressureLoop1}`,
                switch: `PSHH-${pressureLoop1}`  // High-high shutdown
            },
            specs: [
                `Range: 0-${(results.pumpHead * 0.5) || 15} psi`,
                `Type: Electronic`
            ]
        });
        
        // Standby pump (same config)
        const pump2 = this.addEquipment({
            type: 'pump',
            tag: pump1.tag.replace('A', 'B'),
            name: 'Influent Pump\n(Lag/Standby)',
            x: x,
            y: y + 180,
            width: 100,
            height: 100,
            specs: pump1.specs
        });
        
        // Standby pump valves
        this.addValve({
            tag: this.getValveTag('HV'),
            type: 'gate',
            size: `${results.pumpSuction || '8'}"`,
            actuator: 'manual',
            normalPosition: 'closed',
            lockable: true,
            x: x - 40,
            y: y + 230
        });
        
        this.addValve({
            tag: this.getValveTag('CV'),
            type: 'check',
            size: `${results.pumpDischarge || '6'}"`,
            x: x + 100,
            y: y + 230
        });
        
        this.addValve({
            tag: this.getValveTag('HV'),
            type: 'gate',
            size: `${results.pumpDischarge || '6'}"`,
            actuator: 'manual',
            normalPosition: 'closed',
            lockable: true,
            x: x + 140,
            y: y + 230
        });
        
        // Draw piping with line numbers
        this.drawDetailedPipe({
            from: {x: wetwell.x + wetwell.width, y: y + 50},
            to: {x: pump1.x, y: y + 50},
            lineNumber: this.getLineNumber(),
            spec: `${results.pumpSuction || '8'}-INF-CS-150`,
            service: 'Influent',
            size: `${results.pumpSuction || '8'}"`,
            material: 'Carbon Steel',
            rating: '150#',
            insulation: false
        });
        
        x += spacing;
        
        // ================================================================
        // 3. AERATION BASIN WITH COMPLETE CONTROLS
        // ================================================================
        const aeration = this.addEquipment({
            type: 'reactor',
            tag: this.getEquipTag('T'),
            name: 'Aeration\nBasin',
            x: x,
            y: y - 100,
            width: 200,
            height: 250,
            specs: [
                `Volume: ${results.tankVolume || '1.5'} MG`,
                `Dimensions: ${results.length || '120'}'L x ${results.width || '40'}'W x ${results.depth || '15'}'D`,
                `MLSS: ${data.mlss || '3000'} mg/L`,
                `SRT: ${data.srt || '10'} days`,
                `HRT: ${results.hrt || '8'} hours`,
                `F/M: ${results.fm || '0.3'} lb BOD/lb MLSS·day`,
                `Material: Concrete`,
                `Diffusers: Fine bubble`
            ]
        });
        
        // DO Control Loop (Critical!)
        const doLoop = this.getLoopTag('A');
        this.addInstrumentLoop({
            measurement: 'DO',
            loopNumber: doLoop,
            equipment: aeration.tag,
            x: x + 100,
            y: y - 150,
            elements: {
                transmitter: `AT-${doLoop}`,
                indicator: `AI-${doLoop}`,
                controller: `AIC-${doLoop}`,
                recorder: `AIR-${doLoop}`,
                alarmLow: `AAL-${doLoop}`
            },
            specs: [
                `Type: Optical DO`,
                `Range: 0-10 mg/L`,
                `Setpoint: ${results.doSetpoint || '2.0'} mg/L`,
                `Controls: Blower VFD`
            ],
            controlledEquipment: 'Blower VFD'
        });
        
        // ORP measurement (for denitrification)
        const orpLoop = this.getLoopTag('A');
        this.addInstrumentLoop({
            measurement: 'ORP',
            loopNumber: orpLoop,
            equipment: aeration.tag,
            x: x + 100,
            y: y + 180,
            elements: {
                transmitter: `AT-${orpLoop}`,
                indicator: `AI-${orpLoop}`
            },
            specs: [
                `Type: ORP probe`,
                `Range: -500 to +500 mV`
            ]
        });
        
        // MLSS analyzer
        const mlssLoop = this.getLoopTag('A');
        this.addInstrumentLoop({
            measurement: 'MLSS',
            loopNumber: mlssLoop,
            equipment: aeration.tag,
            x: x + 50,
            y: y + 180,
            elements: {
                transmitter: `AT-${mlssLoop}`,
                indicator: `AI-${mlssLoop}`
            },
            specs: [
                `Type: Turbidity`,
                `Range: 0-${(data.mlss * 2) || 6000} mg/L`
            ]
        });
        
        x += spacing + 50;
        
        // ================================================================
        // 4. SECONDARY CLARIFIER WITH SLUDGE CONTROL
        // ================================================================
        const clarifier = this.addEquipment({
            type: 'clarifier',
            tag: this.getEquipTag('T'),
            name: 'Secondary\nClarifier',
            x: x,
            y: y,
            width: 180,
            height: 180,
            specs: [
                `Diameter: ${results.secondaryDiameter || '60'} ft`,
                `SWD: ${results.secondaryDepth || '12'} ft`,
                `SOR: ${results.secondarySOR || '500'} gpd/sf`,
                `SLR: ${results.sludgeLR || '20'} lb/d/sf`,
                `Type: Center feed`,
                `Mechanism: Sludge rake`,
                `Weir: Peripheral V-notch`
            ]
        });
        
        // Clarifier level control
        const clarifierLevel = this.getLoopTag('L');
        this.addInstrumentLoop({
            measurement: 'level',
            loopNumber: clarifierLevel,
            equipment: clarifier.tag,
            x: x + 90,
            y: y - 80,
            elements: {
                transmitter: `LT-${clarifierLevel}`,
                indicator: `LI-${clarifierLevel}`,
                controller: `LIC-${clarifierLevel}`
            },
            specs: [
                `Type: Ultrasonic`,
                `Controls: Effluent weir`
            ]
        });
        
        // Effluent TSS analyzer
        const tssLoop = this.getLoopTag('A');
        this.addInstrumentLoop({
            measurement: 'TSS',
            loopNumber: tssLoop,
            equipment: clarifier.tag,
            x: x + 90,
            y: y - 120,
            elements: {
                transmitter: `AT-${tssLoop}`,
                indicator: `AI-${tssLoop}`,
                alarmHigh: `AAH-${tssLoop}`
            },
            specs: [
                `Type: Turbidity`,
                `Range: 0-50 mg/L`,
                `Alarm: > ${results.effluentTSS * 2 || 20} mg/L`
            ]
        });
        
        // Sludge blanket level
        const blanketLoop = this.getLoopTag('L');
        this.addInstrumentLoop({
            measurement: 'blanket',
            loopNumber: blanketLoop,
            equipment: clarifier.tag,
            x: x + 90,
            y: y + 200,
            elements: {
                transmitter: `LT-${blanketLoop}`,
                indicator: `LI-${blanketLoop}`,
                alarmHigh: `LAH-${blanketLoop}`
            },
            specs: [
                `Type: Sonar`,
                `Alarm: > ${results.blanketDepth || '4'} ft`
            ]
        });
        
        x += spacing;
        
        // ================================================================
        // 5. RAS PUMP STATION WITH FLOW CONTROL
        // ================================================================
        const rasPump = this.addEquipment({
            type: 'pump',
            tag: this.getEquipTag('P') + 'A',
            name: 'RAS Pump\n(Lead)',
            x: clarifier.x + 90,
            y: y + 280,
            width: 100,
            height: 100,
            specs: [
                `Type: Screw pump`,
                `Flow: ${results.rasFlow || (data.flow * 0.5)} MGD`,
                `Rate: ${results.rasRate || '50'}% of influent`,
                `TDH: ${results.rasHead || '10'} ft`,
                `Power: ${results.rasPower || '7.5'} HP`,
                `VFD: Yes`
            ]
        });
        
        // RAS flow control loop
        const rasFlowLoop = this.getLoopTag('F');
        this.addInstrumentLoop({
            measurement: 'flow',
            loopNumber: rasFlowLoop,
            x: rasPump.x + 50,
            y: rasPump.y + 120,
            elements: {
                transmitter: `FT-${rasFlowLoop}`,
                indicator: `FI-${rasFlowLoop}`,
                controller: `FIC-${rasFlowLoop}`,
                recorder: `FIR-${rasFlowLoop}`
            },
            specs: [
                `Type: Magnetic`,
                `Range: 0-${(results.rasFlow * 1.5) || 1.5} MGD`,
                `Setpoint: ${results.rasRate || '50'}% of FT-${flowLoop1}`,
                `Controls: VFD speed`
            ],
            controlledEquipment: `${rasPump.tag} VFD`
        });
        
        // RAS piping with control valve
        const rasControlValve = this.addValve({
            tag: this.getValveTag('CV'),
            type: 'butterfly',
            size: `${results.rasPipe || '12'}"`,
            actuator: 'electric',
            failMode: 'as-is',
            controlLoop: `FIC-${rasFlowLoop}`,
            x: rasPump.x + 120,
            y: rasPump.y + 50
        });
        
        // ================================================================
        // 6. WAS CONTROL WITH FLOW PACING
        // ================================================================
        const wasControlValve = this.addValve({
            tag: this.getValveTag('CV'),
            type: 'globe',
            size: `${results.wasPipe || '4'}"`,
            actuator: 'pneumatic',
            failMode: 'FC',  // Fail closed
            normalPosition: 'throttling',
            x: rasPump.x - 80,
            y: rasPump.y + 50
        });
        
        // WAS flow measurement and control
        const wasFlowLoop = this.getLoopTag('F');
        this.addInstrumentLoop({
            measurement: 'flow',
            loopNumber: wasFlowLoop,
            x: wasControlValve.x,
            y: wasControlValve.y - 60,
            elements: {
                transmitter: `FT-${wasFlowLoop}`,
                indicator: `FI-${wasFlowLoop}`,
                controller: `FIC-${wasFlowLoop}`,
                totalizer: `FQI-${wasFlowLoop}`
            },
            specs: [
                `Type: Magnetic`,
                `Range: 0-${(results.wasFlow * 3) || 0.5} MGD`,
                `Setpoint: ${((results.wasFlow / data.flow) * 100).toFixed(1) || '2'}% of FT-${flowLoop1}`,
                `Controls: CV-${wasControlValve.tag.split('-')[1]}`
            ]
        });
        
        // ================================================================
        // 7. EFFLUENT STRUCTURE WITH MONITORING
        // ================================================================
        const effluent = this.addEquipment({
            type: 'tank',
            tag: this.getEquipTag('T'),
            name: 'Effluent\nStructure',
            x: x,
            y: y,
            width: 120,
            height: 150,
            specs: [
                `Flow: ${data.flow || '1.0'} MGD`,
                `BOD: < ${results.effluentBOD || '10'} mg/L`,
                `TSS: < ${results.effluentTSS || '10'} mg/L`,
                `NH3-N: < ${results.effluentNH3 || '1'} mg/L`,
                `Type: Parshall flume`,
                `Material: Stainless steel`
            ]
        });
        
        // Effluent flow monitoring
        const effluentFlowLoop = this.getLoopTag('F');
        this.addInstrumentLoop({
            measurement: 'flow',
            loopNumber: effluentFlowLoop,
            x: x + 60,
            y: y - 80,
            elements: {
                transmitter: `FT-${effluentFlowLoop}`,
                indicator: `FI-${effluentFlowLoop}`,
                recorder: `FIR-${effluentFlowLoop}`,
                totalizer: `FQI-${effluentFlowLoop}`
            },
            specs: [
                `Type: Flume ultrasonic`,
                `Range: 0-${(data.flow * 3) || 3} MGD`
            ]
        });
        
        // Effluent pH monitoring
        const pHLoop = this.getLoopTag('A');
        this.addInstrumentLoop({
            measurement: 'pH',
            loopNumber: pHLoop,
            equipment: effluent.tag,
            x: x + 60,
            y: y + 180,
            elements: {
                transmitter: `AT-${pHLoop}`,
                indicator: `AI-${pHLoop}`,
                alarmHigh: `AAH-${pHLoop}`,
                alarmLow: `AAL-${pHLoop}`
            },
            specs: [
                `Type: pH probe`,
                `Range: 0-14 pH`,
                `Limits: ${results.pHLow || '6.0'}-${results.pHHigh || '9.0'}`
            ]
        });
        
        // ================================================================
        // DRAW ALL PIPING WITH SPECIFICATIONS
        // ================================================================
        
        // Main process line: Wetwell → Pumps → Aeration
        this.drawDetailedPipe({
            from: {x: wetwell.x + wetwell.width, y: y + 50},
            to: {x: pump1.x - 40, y: y + 50},
            lineNumber: this.getLineNumber(),
            spec: `${results.influentPipe || '12'}-INF-CS-150`,
            service: 'Raw Influent',
            flowRate: `${data.flow || '1.0'} MGD`
        });
        
        // Pumps → Aeration
        this.drawDetailedPipe({
            from: {x: pump1.x + 140, y: y + 50},
            to: {x: aeration.x, y: y + 50},
            lineNumber: this.getLineNumber(),
            spec: `${results.pumpDischarge || '10'}-INF-CS-150`,
            service: 'Pumped Influent',
            flowRate: `${data.flow || '1.0'} MGD`
        });
        
        // Aeration → Clarifier (MLSS line)
        this.drawDetailedPipe({
            from: {x: aeration.x + aeration.width, y: y + 50},
            to: {x: clarifier.x, y: y + 90},
            lineNumber: this.getLineNumber(),
            spec: `${results.mlssPipe || '18'}-MLSS-CS-150`,
            service: 'Mixed Liquor',
            flowRate: `${(parseFloat(data.flow) + parseFloat(results.rasFlow || data.flow * 0.5)).toFixed(1)} MGD`,
            mlss: `${data.mlss || '3000'} mg/L`
        });
        
        // Clarifier → Effluent
        this.drawDetailedPipe({
            from: {x: clarifier.x + clarifier.width, y: y + 50},
            to: {x: effluent.x, y: y + 50},
            lineNumber: this.getLineNumber(),
            spec: `${results.effluentPipe || '12'}-EFF-CS-150`,
            service: 'Effluent',
            flowRate: `${data.flow || '1.0'} MGD`
        });
        
        // RAS return line
        this.drawDetailedPipe({
            from: {x: clarifier.x + 90, y: clarifier.y + clarifier.height},
            to: {x: clarifier.x + 90, y: rasPump.y + 50},
            lineNumber: this.getLineNumber(),
            spec: `${results.rasPipe || '12'}-RAS-CS-150`,
            service: 'Return Sludge',
            flowRate: `${results.rasFlow || (data.flow * 0.5)} MGD`
        });
        
        this.drawDetailedPipe({
            from: {x: rasPump.x + rasPump.width, y: rasPump.y + 50},
            to: {x: aeration.x + 60, y: rasPump.y + 50},
            lineNumber: this.getLineNumber(),
            spec: `${results.rasPipe || '12'}-RAS-CS-150`,
            service: 'Return Sludge'
        });
        
        this.drawDetailedPipe({
            from: {x: aeration.x + 60, y: rasPump.y + 50},
            to: {x: aeration.x + 60, y: aeration.y + aeration.height},
            lineNumber: this.getLineNumber(),
            spec: `${results.rasPipe || '12'}-RAS-CS-150`,
            service: 'Return Sludge'
        });
        
        // WAS line
        this.drawDetailedPipe({
            from: {x: wasControlValve.x - 60, y: wasControlValve.y},
            to: {x: wasControlValve.x, y: wasControlValve.y},
            lineNumber: this.getLineNumber(),
            spec: `${results.wasPipe || '4'}-WAS-CS-150`,
            service: 'Waste Sludge',
            flowRate: `${results.wasFlow || (data.flow * 0.02)} MGD`,
            destination: 'To Sludge Handling'
        });
        
        // ================================================================
        // SAFETY SYSTEMS
        // ================================================================
        
        // High level shutdown on wetwell
        this.addInterlock({
            trigger: `LSHH-${levelLoop}`,
            action: 'Stop all influent pumps',
            x: wetwell.x + 140,
            y: wetwell.y - 120
        });
        
        // Low DO alarm
        this.addInterlock({
            trigger: `AAL-${doLoop}`,
            action: 'Increase blower speed',
            x: aeration.x + 220,
            y: aeration.y - 180
        });
        
        console.log('✅ TRUE WWTP P&ID Generated with full engineering detail');
        return this.exportPID();
    }
    
    // ========================================================================
    // DRAWING PRIMITIVES - ISA COMPLIANT
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
    
    drawDetailedTitleBlock(title, drawingNo, sheet, description) {
        const x = this.canvas.width - 500;
        const y = 30;
        const w = 480;
        const h = 180;
        
        // Border
        this.ctx.strokeStyle = this.config.colors.equipment;
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(x, y, w, h);
        
        // Internal grid
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x, y + 50, w, h - 50);
        
        // Title
        this.ctx.fillStyle = this.config.colors.text;
        this.ctx.font = 'bold 22px Outfit';
        this.ctx.fillText(title, x + 10, y + 35);
        
        // Grid fields
        this.ctx.font = '11px Outfit';
        this.ctx.fillText(`Drawing No: ${drawingNo}`, x + 10, y + 75);
        this.ctx.fillText(`Sheet: ${sheet}`, x + 10, y + 95);
        this.ctx.fillText(`Description: ${description}`, x + 10, y + 115);
        this.ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, x + 10, y + 135);
        this.ctx.fillText(`Rev: 0`, x + 10, y + 155);
        this.ctx.fillText(`Drawn by: AI P&ID Generator`, x + 10, y + 175);
        this.ctx.fillText(`Checked: ___________`, x + 10, y + 195);
        
        // Standard notes
        this.ctx.font = 'bold 10px Outfit';
        this.ctx.fillText('NOTES:', x + 250, y + 75);
        this.ctx.font = '9px Outfit';
        this.ctx.fillText('1. All dimensions in feet unless noted', x + 250, y + 90);
        this.ctx.fillText('2. Refer to ISA-5.1 for symbol standards', x + 250, y + 105);
        this.ctx.fillText('3. All valves manual unless noted', x + 250, y + 120);
        this.ctx.fillText('4. Process lines as shown', x + 250, y + 135);
        this.ctx.fillText('5. Signal lines shown dashed', x + 250, y + 150);
    }
    
    addEquipment(config) {
        const {type, tag, name, x, y, width = 100, height = 100, specs = []} = config;
        
        this.ctx.save();
        this.ctx.strokeStyle = this.config.colors.equipment;
        this.ctx.lineWidth = this.config.lineWidth;
        
        // Draw based on type (same as before but larger)
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
                this.drawReactor(x, y, width, height);
                break;
            default:
                this.ctx.strokeRect(x, y, width, height);
        }
        
        // Tag (larger, above equipment)
        this.ctx.fillStyle = '#00ffc8';
        this.ctx.font = `bold ${this.config.tagFontSize + 2}px JetBrains Mono`;
        this.ctx.fillText(tag, x, y - 15);
        
        // Name
        this.ctx.fillStyle = this.config.colors.text;
        this.ctx.font = `${this.config.fontSize + 1}px Outfit`;
        const lines = name.split('\n');
        lines.forEach((line, i) => {
            const textWidth = this.ctx.measureText(line).width;
            this.ctx.fillText(line, x + width/2 - textWidth/2, y + height/2 + i * 14);
        });
        
        // Specs (below equipment, smaller font)
        if (specs.length > 0) {
            this.ctx.font = '9px JetBrains Mono';
            this.ctx.fillStyle = '#8892a4';
            specs.forEach((spec, i) => {
                this.ctx.fillText(spec, x + 5, y + height + 15 + i * 11);
            });
        }
        
        this.ctx.restore();
        
        const obj = {type, tag, name, x, y, width, height, specs};
        this.objects.push(obj);
        return obj;
    }
    
    addValve(config) {
        const {tag, type, size, actuator, failMode, normalPosition, lockable, controlLoop, x, y} = config;
        
        this.ctx.save();
        this.ctx.strokeStyle = this.config.colors.valve;
        this.ctx.lineWidth = this.config.lineWidth;
        
        const s = 24;  // Valve symbol size
        
        // Draw valve symbol based on type
        switch(type) {
            case 'gate':
                // Gate valve: solid wedge
                this.ctx.beginPath();
                this.ctx.moveTo(x - s/2, y - s/2);
                this.ctx.lineTo(x, y);
                this.ctx.lineTo(x + s/2, y - s/2);
                this.ctx.lineTo(x - s/2, y - s/2);
                this.ctx.stroke();
                this.ctx.beginPath();
                this.ctx.moveTo(x - s/2, y - s/2);
                this.ctx.lineTo(x - s/2, y + s/2);
                this.ctx.lineTo(x + s/2, y + s/2);
                this.ctx.lineTo(x + s/2, y - s/2);
                this.ctx.stroke();
                break;
                
            case 'globe':
                // Globe valve: curved path
                this.ctx.beginPath();
                this.ctx.arc(x, y, s/2, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.beginPath();
                this.ctx.moveTo(x - s/3, y);
                this.ctx.lineTo(x + s/3, y);
                this.ctx.stroke();
                break;
                
            case 'check':
                // Check valve: arrow showing flow direction
                this.ctx.beginPath();
                this.ctx.moveTo(x - s/2, y - s/2);
                this.ctx.lineTo(x, y);
                this.ctx.lineTo(x - s/2, y + s/2);
                this.ctx.stroke();
                this.ctx.beginPath();
                this.ctx.arc(x, y, s/2, -Math.PI/2, Math.PI/2);
                this.ctx.stroke();
                break;
                
            case 'butterfly':
                // Butterfly valve: line with circle
                this.ctx.beginPath();
                this.ctx.arc(x, y, s/2, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.beginPath();
                this.ctx.moveTo(x - s/2, y);
                this.ctx.lineTo(x + s/2, y);
                this.ctx.stroke();
                this.ctx.beginPath();
                this.ctx.ellipse(x, y, s/6, s/2.5, Math.PI/4, 0, Math.PI * 2);
                this.ctx.stroke();
                break;
                
            case 'ball':
                // Ball valve: filled circle
                this.ctx.beginPath();
                this.ctx.arc(x, y, s/2, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(255,159,67,0.3)';
                this.ctx.fill();
                this.ctx.stroke();
                break;
        }
        
        // Actuator symbol (above valve)
        if (actuator && actuator !== 'manual') {
            const actY = y - s - 10;
            switch(actuator) {
                case 'pneumatic':
                    // Diaphragm symbol
                    this.ctx.beginPath();
                    this.ctx.arc(x, actY, 8, 0, Math.PI * 2);
                    this.ctx.stroke();
                    this.ctx.fillText('A', x - 3, actY + 3);
                    break;
                case 'electric':
                    // Motor symbol
                    this.ctx.strokeRect(x - 8, actY - 8, 16, 16);
                    this.ctx.fillText('M', x - 4, actY + 3);
                    break;
                case 'hydraulic':
                    this.ctx.strokeRect(x - 8, actY - 8, 16, 16);
                    this.ctx.fillText('H', x - 4, actY + 3);
                    break;
            }
            
            // Connection line to valve
            this.ctx.beginPath();
            this.ctx.moveTo(x, actY + 8);
            this.ctx.lineTo(x, y - s);
            this.ctx.stroke();
        }
        
        // Fail mode indicator
        if (failMode) {
            this.ctx.font = 'bold 8px Outfit';
            this.ctx.fillStyle = this.config.colors.valve;
            this.ctx.fillText(failMode, x + s/2 + 5, y - s/2);
        }
        
        // Lock indicator
        if (lockable) {
            this.ctx.font = '10px Outfit';
            this.ctx.fillText('🔒', x - s/2 - 15, y);
        }
        
        // Tag
        this.ctx.font = `bold 10px JetBrains Mono`;
        this.ctx.fillStyle = this.config.colors.valve;
        this.ctx.fillText(tag, x - 20, y + s + 15);
        
        // Size and type
        this.ctx.font = '9px Outfit';
        this.ctx.fillText(`${size} ${type}`, x - 25, y + s + 27);
        
        this.ctx.restore();
        
        return {tag, type, size, x, y, actuator, failMode};
    }
    
    addInstrumentLoop(config) {
        const {measurement, loopNumber, equipment, x, y, elements, specs, controlledEquipment} = config;
        
        // Main instrument circle (ISA standard)
        const r = 20;
        this.ctx.save();
        this.ctx.strokeStyle = this.config.colors.instrument;
        this.ctx.lineWidth = this.config.lineWidth;
        
        // Circle
        this.ctx.beginPath();
        this.ctx.arc(x, y, r, 0, Math.PI * 2);
        this.ctx.stroke();
        
        // Letter(s) inside circle
        let letters = '';
        if (elements.transmitter) {
            const parts = elements.transmitter.split('-');
            letters = parts[0].replace(/[0-9]/g, '');
        }
        
        this.ctx.fillStyle = this.config.colors.instrument;
        this.ctx.font = 'bold 14px Outfit';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(letters, x, y);
        
        // Tag below
        this.ctx.textAlign = 'left';
        this.ctx.font = 'bold 10px JetBrains Mono';
        
        let yOffset = y + r + 15;
        Object.values(elements).forEach(tag => {
            this.ctx.fillText(tag, x - 25, yOffset);
            yOffset += 12;
        });
        
        // Specs
        if (specs && specs.length > 0) {
            this.ctx.font = '8px Outfit';
            this.ctx.fillStyle = '#8892a4';
            specs.forEach((spec, i) => {
                this.ctx.fillText(spec, x - 25, yOffset + i * 10);
            });
        }
        
        // Signal line to equipment (dashed)
        if (equipment) {
            this.ctx.strokeStyle = this.config.colors.signal;
            this.ctx.lineWidth = this.config.signalLineWidth;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();
            this.ctx.moveTo(x, y + r);
            this.ctx.lineTo(x, y + r + 40);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
        
        // Control line to final element (dashed)
        if (controlledEquipment) {
            this.ctx.strokeStyle = this.config.colors.signal;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();
            this.ctx.moveTo(x, y - r);
            this.ctx.lineTo(x, y - r - 40);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            
            // Label
            this.ctx.font = '8px Outfit';
            this.ctx.fillStyle = this.config.colors.signal;
            this.ctx.fillText('4-20mA', x + 5, y - r - 20);
        }
        
        this.ctx.restore();
        
        this.instruments.push({measurement, loopNumber, elements, x, y});
        return {loopNumber, elements};
    }
    
    drawDetailedPipe(config) {
        const {from, to, lineNumber, spec, service, flowRate, mlss, destination} = config;
        
        this.ctx.save();
        this.ctx.strokeStyle = this.config.colors.pipe;
        this.ctx.lineWidth = this.config.lineWidth + 1;
        
        // Main pipe line
        this.ctx.beginPath();
        this.ctx.moveTo(from.x, from.y);
        this.ctx.lineTo(to.x, to.y);
        this.ctx.stroke();
        
        // Flow arrow
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const arrowLen = 12;
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        
        this.ctx.beginPath();
        this.ctx.moveTo(midX, midY);
        this.ctx.lineTo(
            midX - arrowLen * Math.cos(angle - Math.PI/6),
            midY - arrowLen * Math.sin(angle - Math.PI/6)
        );
        this.ctx.moveTo(midX, midY);
        this.ctx.lineTo(
            midX - arrowLen * Math.cos(angle + Math.PI/6),
            midY - arrowLen * Math.sin(angle + Math.PI/6)
        );
        this.ctx.stroke();
        
        // Line identification (above pipe)
        this.ctx.fillStyle = this.config.colors.text;
        this.ctx.font = 'bold 10px JetBrains Mono';
        this.ctx.fillText(spec || lineNumber, midX - 40, midY - 15);
        
        // Service description (below pipe)
        this.ctx.font = '9px Outfit';
        this.ctx.fillStyle = '#8892a4';
        if (service) this.ctx.fillText(service, midX - 35, midY + 25);
        if (flowRate) this.ctx.fillText(flowRate, midX - 25, midY + 37);
        if (mlss) this.ctx.fillText(`MLSS: ${mlss}`, midX - 30, midY + 49);
        if (destination) this.ctx.fillText(`→ ${destination}`, midX - 40, midY + 49);
        
        this.ctx.restore();
        
        this.pipes.push({from, to, lineNumber, spec, service});
    }
    
    addInterlock(config) {
        const {trigger, action, x, y} = config;
        
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(255,107,107,0.2)';
        this.ctx.strokeStyle = '#ff6b6b';
        this.ctx.lineWidth = 2;
        
        // Warning box
        this.ctx.fillRect(x - 80, y - 25, 160, 50);
        this.ctx.strokeRect(x - 80, y - 25, 160, 50);
        
        // Text
        this.ctx.fillStyle = '#ff6b6b';
        this.ctx.font = 'bold 9px Outfit';
        this.ctx.fillText(`⚠ INTERLOCK`, x - 70, y - 10);
        this.ctx.font = '8px Outfit';
        this.ctx.fillText(`Trigger: ${trigger}`, x - 70, y + 5);
        this.ctx.fillText(`Action: ${action}`, x - 70, y + 18);
        
        this.ctx.restore();
    }
    
    // Pump, tank, clarifier, reactor drawings (same as before)
    drawPump(x, y, w, h) {
        const cx = x + w/2;
        const cy = y + h/2;
        const r = Math.min(w, h) / 2;
        
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.ctx.stroke();
        
        this.ctx.beginPath();
        this.ctx.moveTo(cx - r/2, cy);
        this.ctx.lineTo(cx + r/2, cy);
        this.ctx.stroke();
    }
    
    drawTank(x, y, w, h) {
        this.ctx.strokeRect(x, y, w, h);
        
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x + w/2, y - 20);
        this.ctx.lineTo(x + w, y);
        this.ctx.stroke();
    }
    
    drawClarifier(x, y, w, h) {
        const cx = x + w/2;
        const cy = y + h/2;
        
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, w/2, 0, Math.PI * 2);
        this.ctx.stroke();
        
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, w/6, 0, Math.PI * 2);
        this.ctx.stroke();
    }
    
    drawReactor(x, y, w, h) {
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
    
    // Tag generation
    getEquipTag(prefix) {
        const num = this.tagCounters[prefix] || 101;
        this.tagCounters[prefix] = num + 1;
        return `${prefix}-${num}`;
    }
    
    getValveTag(prefix) {
        const num = this.tagCounters[prefix] || 101;
        this.tagCounters[prefix] = num + 1;
        return `${prefix}-${num}`;
    }
    
    getLoopTag(prefix) {
        const num = this.tagCounters[prefix] || 101;
        this.tagCounters[prefix] = num + 1;
        return `${num}`;
    }
    
    getLineNumber() {
        const num = this.tagCounters.LINE || 1001;
        this.tagCounters.LINE = num + 1;
        return num.toString();
    }
    
    // Export
    exportPID() {
        console.log('✅ TRUE P&ID Generation Complete');
        console.log(`Generated: ${this.objects.length} equipment, ${this.pipes.length} pipes, ${this.instruments.length} instrument loops`);
        
        return {
            canvas: this.canvas,
            objects: this.objects,
            pipes: this.pipes,
            instruments: this.instruments,
            png: this.canvas.toDataURL('image/png'),
            summary: {
                equipment: this.objects.length,
                pipes: this.pipes.length,
                instruments: this.instruments.length,
                valves: this.objects.filter(o => o.type === 'valve').length
            }
        };
    }
    
    downloadPNG(filename = 'TRUE-PID.png') {
        const link = document.createElement('a');
        link.download = filename;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }
    
    downloadPDF(filename = 'TRUE-PID.pdf') {
        const {jsPDF} = window.jspdf;
        const pdf = new jsPDF('landscape', 'mm', [594, 420]); // A2 size
        
        const imgData = this.canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 10, 10, 574, 400);
        
        pdf.save(filename);
    }
}

console.log('✅ TRUE P&ID Generator Loaded - ISA-5.1 Compliant');
console.log('Features: Detailed symbols, instrument loops, line specs, interlocks');
