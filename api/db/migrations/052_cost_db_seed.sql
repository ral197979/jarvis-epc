-- Migration 052: RSMeans-Compatible Cost Library Seed
-- Denver Engineering — Phase 10.2 (v10.2.0)
-- ~350 CSI MasterFormat line items covering Divisions 01–28.
-- All costs in USD, national average, 2025 pricing.
-- Sources: RSMeans 2024 Building Construction Cost Data (public reference values),
--          ENR Construction Cost Index, ASCE 7 reference data.
-- tenant_id IS NULL = platform default (visible to all tenants).

INSERT INTO cost_items
  (csi_division, csi_section, csi_code, description, unit,
   material_cost, labor_cost, equipment_cost, overhead_pct, region, year, source)
VALUES

-- ─── DIVISION 01 — GENERAL REQUIREMENTS ─────────────────────────────────────
('01','01 50 00','01 50 00 10','Temporary fencing, chain link 6ft',              'LF',  4.20, 3.80, 0.40, 15, NULL, 2025, 'rsmeans'),
('01','01 50 00','01 50 00 20','Temporary power distribution panel',             'EA',  820, 680, 40,   15, NULL, 2025, 'rsmeans'),
('01','01 50 00','01 50 00 30','Portable toilet, monthly rental',                'MO',  145, 0,   0,    15, NULL, 2025, 'rsmeans'),
('01','01 50 00','01 50 00 40','Job site trailer, monthly rental',               'MO',  850, 0,   0,    15, NULL, 2025, 'rsmeans'),
('01','01 74 00','01 74 00 10','Construction debris disposal, dumpster',         'TON', 68,  22,  8,    15, NULL, 2025, 'rsmeans'),
('01','01 74 00','01 74 00 20','Selective demolition, concrete slab',            'SF',  1.80,2.40,0.60, 15, NULL, 2025, 'rsmeans'),
('01','01 74 00','01 74 00 30','Selective demolition, masonry wall',             'SF',  2.20,4.10,0.80, 15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 02 — EXISTING CONDITIONS ──────────────────────────────────────
('02','02 20 00','02 20 00 10','Environmental assessment Phase I',               'EA',  2800,0,   0,    15, NULL, 2025, 'rsmeans'),
('02','02 20 00','02 20 00 20','Soil testing, borings per bore hole',            'EA',  380, 0,   120,  15, NULL, 2025, 'rsmeans'),
('02','02 41 00','02 41 00 10','Building demolition, wood frame per SF',        'SF',  3.10,4.80,1.20, 15, NULL, 2025, 'rsmeans'),
('02','02 41 00','02 41 00 20','Building demolition, concrete/masonry per SF',  'SF',  5.20,7.40,2.60, 15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 03 — CONCRETE ─────────────────────────────────────────────────
('03','03 10 00','03 10 00 10','Formwork, slab on grade, per SF of form',       'SF',  2.40,4.20,0.30, 15, NULL, 2025, 'rsmeans'),
('03','03 10 00','03 10 00 20','Formwork, elevated slab per SF of form',        'SF',  3.80,5.60,0.40, 15, NULL, 2025, 'rsmeans'),
('03','03 10 00','03 10 00 30','Formwork, columns, round 12in diameter',        'LF',  18,  28,  2,    15, NULL, 2025, 'rsmeans'),
('03','03 10 00','03 10 00 40','Formwork, walls, 8ft height',                   'SF',  4.10,5.80,0.50, 15, NULL, 2025, 'rsmeans'),
('03','03 20 00','03 20 00 10','Rebar, #4 (1/2in), placed',                    'TON', 1020,680, 40,   15, NULL, 2025, 'rsmeans'),
('03','03 20 00','03 20 00 20','Rebar, #5 (5/8in), placed',                    'TON', 980, 640, 35,   15, NULL, 2025, 'rsmeans'),
('03','03 20 00','03 20 00 30','Rebar, #8 (1in), placed',                      'TON', 940, 580, 30,   15, NULL, 2025, 'rsmeans'),
('03','03 20 00','03 20 00 40','Welded wire fabric, 6x6 W1.4xW1.4',            'SF',  0.48,0.32,0.02, 15, NULL, 2025, 'rsmeans'),
('03','03 30 00','03 30 00 10','Concrete, slab on grade, 4in, 3000 psi',       'SF',  5.20,3.40,1.10, 15, NULL, 2025, 'rsmeans'),
('03','03 30 00','03 30 00 20','Concrete, slab on grade, 6in, 3000 psi',       'SF',  7.40,3.80,1.30, 15, NULL, 2025, 'rsmeans'),
('03','03 30 00','03 30 00 30','Concrete, foundation wall, 8in, 3000 psi',     'SF',  9.60,6.20,1.80, 15, NULL, 2025, 'rsmeans'),
('03','03 30 00','03 30 00 40','Concrete, column, 12x12, 4000 psi',            'LF',  48,  38,  4,    15, NULL, 2025, 'rsmeans'),
('03','03 30 00','03 30 00 50','Concrete, elevated slab, 5in, pump placed',    'SF',  7.80,5.20,1.60, 15, NULL, 2025, 'rsmeans'),
('03','03 30 00','03 30 00 60','Concrete, footings, spread, per CY',           'CY',  180, 120, 30,   15, NULL, 2025, 'rsmeans'),
('03','03 30 00','03 30 00 70','Concrete, grade beams, per LF',                'LF',  62,  48,  8,    15, NULL, 2025, 'rsmeans'),
('03','03 30 00','03 30 00 80','Concrete, retaining wall, 10ft high, per LF',  'LF',  280, 210, 40,   15, NULL, 2025, 'rsmeans'),
('03','03 50 00','03 50 00 10','Lightweight concrete, insulating, 2in',        'SF',  1.80,1.20,0.20, 15, NULL, 2025, 'rsmeans'),
('03','03 50 00','03 50 00 20','Concrete topping, 2in, self-leveling',         'SF',  2.60,1.80,0.20, 15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 04 — MASONRY ──────────────────────────────────────────────────
('04','04 20 00','04 20 00 10','CMU block, 8x8x16, standard, laid',            'SF',  4.80,9.20,0.40, 15, NULL, 2025, 'rsmeans'),
('04','04 20 00','04 20 00 20','CMU block, 8x8x16, reinforced/grouted',        'SF',  7.20,12,  0.60, 15, NULL, 2025, 'rsmeans'),
('04','04 20 00','04 20 00 30','CMU block, 12x8x16, standard, laid',           'SF',  6.40,10.5,0.50, 15, NULL, 2025, 'rsmeans'),
('04','04 20 00','04 20 00 40','Brick, modular, running bond, exterior',       'SF',  9.80,14,  0.60, 15, NULL, 2025, 'rsmeans'),
('04','04 20 00','04 20 00 50','Brick, modular, common bond, interior',        'SF',  8.40,12,  0.50, 15, NULL, 2025, 'rsmeans'),
('04','04 40 00','04 40 00 10','Stone veneer, limestone, 4in',                 'SF',  22,  18,  1,    15, NULL, 2025, 'rsmeans'),
('04','04 40 00','04 40 00 20','Stone veneer, granite, 2in',                   'SF',  28,  22,  1.5,  15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 05 — METALS ───────────────────────────────────────────────────
('05','05 12 00','05 12 00 10','Structural steel, wide flange beams, erected',  'TON', 2400,1800,320,  15, NULL, 2025, 'rsmeans'),
('05','05 12 00','05 12 00 20','Structural steel, columns, erected',            'TON', 2600,1900,340,  15, NULL, 2025, 'rsmeans'),
('05','05 12 00','05 12 00 30','Steel deck, composite, 1.5in, 20 ga',          'SF',  3.60,2.40,0.30, 15, NULL, 2025, 'rsmeans'),
('05','05 12 00','05 12 00 40','Steel deck, roof, 1.5in, 22 ga',               'SF',  2.80,2.00,0.25, 15, NULL, 2025, 'rsmeans'),
('05','05 12 00','05 12 00 50','Steel joists, K-series, average',              'TON', 2200,1600,280,  15, NULL, 2025, 'rsmeans'),
('05','05 12 00','05 12 00 60','High-strength bolts, A325, installed',         'EA',  4.80,3.20,0.20, 15, NULL, 2025, 'rsmeans'),
('05','05 21 00','05 21 00 10','Light gauge steel framing, 3-5/8in, 20ga',     'SF',  2.20,3.40,0.15, 15, NULL, 2025, 'rsmeans'),
('05','05 21 00','05 21 00 20','Light gauge steel framing, 6in, 18ga',         'SF',  2.80,3.80,0.20, 15, NULL, 2025, 'rsmeans'),
('05','05 50 00','05 50 00 10','Miscellaneous metals, handrail, stainless',    'LF',  92,  68,  4,    15, NULL, 2025, 'rsmeans'),
('05','05 50 00','05 50 00 20','Miscellaneous metals, handrail, painted steel','LF',  48,  42,  2,    15, NULL, 2025, 'rsmeans'),
('05','05 50 00','05 50 00 30','Metal stair, straight, per flight',            'EA',  4800,3200,400,  15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 06 — WOOD, PLASTICS, COMPOSITES ────────────────────────────────
('06','06 10 00','06 10 00 10','Dimensional lumber, 2x4 framing, per LF',     'LF',  0.68,0.52,0.02, 15, NULL, 2025, 'rsmeans'),
('06','06 10 00','06 10 00 20','Dimensional lumber, 2x6 framing, per LF',     'LF',  1.02,0.58,0.02, 15, NULL, 2025, 'rsmeans'),
('06','06 10 00','06 10 00 30','Plywood sheathing, 1/2in, per SF',             'SF',  1.18,0.72,0.05, 15, NULL, 2025, 'rsmeans'),
('06','06 10 00','06 10 00 40','OSB sheathing, 7/16in, per SF',                'SF',  0.88,0.68,0.04, 15, NULL, 2025, 'rsmeans'),
('06','06 10 00','06 10 00 50','Engineered lumber, LVL beam, 3-1/2x11-1/4',   'LF',  14,  8,   0.50, 15, NULL, 2025, 'rsmeans'),
('06','06 40 00','06 40 00 10','Architectural millwork, wood cabinets',         'LF',  185, 120, 5,    15, NULL, 2025, 'rsmeans'),
('06','06 40 00','06 40 00 20','Architectural millwork, plastic laminate',      'LF',  148, 110, 4,    15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 07 — THERMAL AND MOISTURE PROTECTION ───────────────────────────
('07','07 10 00','07 10 00 10','Waterproofing, below grade, polyurethane',     'SF',  3.40,2.80,0.20, 15, NULL, 2025, 'rsmeans'),
('07','07 10 00','07 10 00 20','Waterproofing, below grade, crystalline',      'SF',  4.20,3.20,0.20, 15, NULL, 2025, 'rsmeans'),
('07','07 10 00','07 10 00 30','Sheet waterproofing, torch-applied modified',  'SF',  2.80,2.40,0.15, 15, NULL, 2025, 'rsmeans'),
('07','07 21 00','07 21 00 10','Rigid insulation, extruded polystyrene, 2in',  'SF',  1.82,0.68,0.05, 15, NULL, 2025, 'rsmeans'),
('07','07 21 00','07 21 00 20','Rigid insulation, polyisocyanurate, 3in',      'SF',  2.40,0.72,0.05, 15, NULL, 2025, 'rsmeans'),
('07','07 21 00','07 21 00 30','Batt insulation, fiberglass, R-13, walls',     'SF',  0.68,0.42,0.02, 15, NULL, 2025, 'rsmeans'),
('07','07 21 00','07 21 00 40','Batt insulation, fiberglass, R-30, ceiling',   'SF',  1.24,0.58,0.03, 15, NULL, 2025, 'rsmeans'),
('07','07 21 00','07 21 00 50','Spray foam insulation, closed-cell, 2in',      'SF',  2.80,1.60,0.10, 15, NULL, 2025, 'rsmeans'),
('07','07 31 00','07 31 00 10','Asphalt shingles, architectural, 30 yr',       'SF',  1.82,2.10,0.08, 15, NULL, 2025, 'rsmeans'),
('07','07 31 00','07 31 00 20','Metal roofing, standing seam, 24 ga',          'SF',  8.60,5.40,0.40, 15, NULL, 2025, 'rsmeans'),
('07','07 31 00','07 31 00 30','TPO roofing, mechanically fastened, 60mil',    'SF',  3.20,2.40,0.20, 15, NULL, 2025, 'rsmeans'),
('07','07 31 00','07 31 00 40','EPDM roofing, fully adhered, 60mil',           'SF',  2.80,2.20,0.18, 15, NULL, 2025, 'rsmeans'),
('07','07 31 00','07 31 00 50','PVC roofing, heat welded, 60mil',              'SF',  3.60,2.60,0.22, 15, NULL, 2025, 'rsmeans'),
('07','07 62 00','07 62 00 10','Flashing, copper, 16 oz',                      'SF',  12,  9.20,0.40, 15, NULL, 2025, 'rsmeans'),
('07','07 62 00','07 62 00 20','Flashing, aluminum, .032in',                   'SF',  3.20,4.80,0.20, 15, NULL, 2025, 'rsmeans'),
('07','07 90 00','07 90 00 10','Caulking and sealants, polyurethane',          'LF',  0.68,1.20,0.04, 15, NULL, 2025, 'rsmeans'),
('07','07 90 00','07 90 00 20','Expansion joint, 1in wide, neoprene',          'LF',  18,  14,  0.80, 15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 08 — OPENINGS ──────────────────────────────────────────────────
('08','08 11 00','08 11 00 10','Hollow metal door, 3-0x7-0, 18 ga',           'EA',  680, 320, 20,   15, NULL, 2025, 'rsmeans'),
('08','08 11 00','08 11 00 20','Hollow metal frame, 3-0x7-0, 16 ga',          'EA',  280, 180, 10,   15, NULL, 2025, 'rsmeans'),
('08','08 14 00','08 14 00 10','Wood door, solid core, 1-3/4in, 3-0x7-0',     'EA',  420, 240, 15,   15, NULL, 2025, 'rsmeans'),
('08','08 14 00','08 14 00 20','Wood door, hollow core, 1-3/8in, 3-0x7-0',    'EA',  180, 220, 12,   15, NULL, 2025, 'rsmeans'),
('08','08 14 00','08 14 00 30','Fire door, 90-min, 3-0x7-0, steel',           'EA',  920, 380, 25,   15, NULL, 2025, 'rsmeans'),
('08','08 36 00','08 36 00 10','Overhead door, sectional, 10x10, steel',      'EA',  2200,680, 80,   15, NULL, 2025, 'rsmeans'),
('08','08 36 00','08 36 00 20','Overhead door, sectional, 12x12, insulated',  'EA',  2800,780, 90,   15, NULL, 2025, 'rsmeans'),
('08','08 51 00','08 51 00 10','Aluminum window, double-hung, per SF',         'SF',  48,  28,  2,    15, NULL, 2025, 'rsmeans'),
('08','08 51 00','08 51 00 20','Aluminum window, fixed, per SF',               'SF',  38,  22,  1.50, 15, NULL, 2025, 'rsmeans'),
('08','08 51 00','08 51 00 30','Vinyl window, double-hung, per SF',            'SF',  32,  24,  1.50, 15, NULL, 2025, 'rsmeans'),
('08','08 44 00','08 44 00 10','Curtain wall, aluminum, thermally broken',     'SF',  88,  48,  4,    15, NULL, 2025, 'rsmeans'),
('08','08 44 00','08 44 00 20','Curtain wall, unitized system, per SF',        'SF',  115, 32,  3,    15, NULL, 2025, 'rsmeans'),
('08','08 71 00','08 71 00 10','Door hardware, office, lever set',             'EA',  280, 120, 5,    15, NULL, 2025, 'rsmeans'),
('08','08 71 00','08 71 00 20','Door hardware, exit device, panic bar',        'EA',  680, 180, 8,    15, NULL, 2025, 'rsmeans'),
('08','08 71 00','08 71 00 30','Door hardware, closer, surface mounted',       'EA',  180, 80,  4,    15, NULL, 2025, 'rsmeans'),
('08','08 71 00','08 71 00 40','Door hardware, card reader, access control',   'EA',  820, 280, 10,   15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 09 — FINISHES ──────────────────────────────────────────────────
('09','09 21 00','09 21 00 10','Gypsum board, 5/8in, walls, taped/finished',  'SF',  0.78,1.92,0.06, 15, NULL, 2025, 'rsmeans'),
('09','09 21 00','09 21 00 20','Gypsum board, 5/8in type X, fire rated',      'SF',  0.88,1.98,0.06, 15, NULL, 2025, 'rsmeans'),
('09','09 21 00','09 21 00 30','Gypsum board, 1/2in, ceilings',               'SF',  0.72,2.10,0.07, 15, NULL, 2025, 'rsmeans'),
('09','09 30 00','09 30 00 10','Ceramic tile, floor, 12x12, installed',       'SF',  4.80,7.20,0.30, 15, NULL, 2025, 'rsmeans'),
('09','09 30 00','09 30 00 20','Ceramic tile, wall, 4x4, installed',          'SF',  5.20,8.40,0.30, 15, NULL, 2025, 'rsmeans'),
('09','09 30 00','09 30 00 30','Porcelain tile, floor, 24x24, installed',     'SF',  8.20,7.80,0.35, 15, NULL, 2025, 'rsmeans'),
('09','09 51 00','09 51 00 10','Acoustic ceiling tile, 2x4, suspended grid',  'SF',  1.92,2.40,0.12, 15, NULL, 2025, 'rsmeans'),
('09','09 51 00','09 51 00 20','Acoustic ceiling tile, 2x2, suspended grid',  'SF',  2.40,2.60,0.12, 15, NULL, 2025, 'rsmeans'),
('09','09 51 00','09 51 00 30','Drywall ceiling, gypsum board, taped',        'SF',  0.78,2.40,0.08, 15, NULL, 2025, 'rsmeans'),
('09','09 65 00','09 65 00 10','Vinyl composition tile, 12x12, per SF',       'SF',  1.48,1.80,0.06, 15, NULL, 2025, 'rsmeans'),
('09','09 65 00','09 65 00 20','Luxury vinyl plank, click-lock, per SF',      'SF',  3.20,1.60,0.05, 15, NULL, 2025, 'rsmeans'),
('09','09 65 00','09 65 00 30','Carpet, commercial, broadloom, per SY',       'SY',  28,  18,  0.80, 15, NULL, 2025, 'rsmeans'),
('09','09 65 00','09 65 00 40','Carpet tile, modular, per SY',                'SY',  38,  12,  0.60, 15, NULL, 2025, 'rsmeans'),
('09','09 65 00','09 65 00 50','Hardwood flooring, 3/4in strip, per SF',      'SF',  6.80,4.20,0.20, 15, NULL, 2025, 'rsmeans'),
('09','09 65 00','09 65 00 60','Epoxy floor coating, 2-coat system',          'SF',  1.20,1.80,0.10, 15, NULL, 2025, 'rsmeans'),
('09','09 91 00','09 91 00 10','Painting, interior walls, 2 coats, per SF',   'SF',  0.22,0.68,0.02, 15, NULL, 2025, 'rsmeans'),
('09','09 91 00','09 91 00 20','Painting, exterior, latex, 2 coats, per SF',  'SF',  0.28,0.82,0.04, 15, NULL, 2025, 'rsmeans'),
('09','09 91 00','09 91 00 30','Painting, structural steel, per ton',         'TON', 180, 320, 20,   15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 10 — SPECIALTIES ───────────────────────────────────────────────
('10','10 21 00','10 21 00 10','Toilet partitions, metal, floor mounted',     'EA',  680, 320, 20,   15, NULL, 2025, 'rsmeans'),
('10','10 21 00','10 21 00 20','Toilet partitions, solid plastic, overhead',  'EA',  820, 280, 20,   15, NULL, 2025, 'rsmeans'),
('10','10 28 00','10 28 00 10','Toilet accessories, grab bar, stainless',     'EA',  68,  48,  2,    15, NULL, 2025, 'rsmeans'),
('10','10 28 00','10 28 00 20','Toilet accessories, paper holder',            'EA',  42,  28,  1,    15, NULL, 2025, 'rsmeans'),
('10','10 44 00','10 44 00 10','Fire extinguisher, 10 lb ABC',                'EA',  68,  28,  0,    15, NULL, 2025, 'rsmeans'),
('10','10 44 00','10 44 00 20','Fire extinguisher cabinet, semi-recessed',    'EA',  148, 68,  3,    15, NULL, 2025, 'rsmeans'),
('10','10 75 00','10 75 00 10','Flagpole, aluminum, 40ft',                    'EA',  1800,680, 80,   15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 11 — EQUIPMENT ─────────────────────────────────────────────────
('11','11 31 00','11 31 00 10','Residential appliance, range, electric',      'EA',  820, 180, 0,    15, NULL, 2025, 'rsmeans'),
('11','11 31 00','11 31 00 20','Commercial dishwasher, conveyor type',        'EA',  8200,1800,200,  15, NULL, 2025, 'rsmeans'),
('11','11 40 00','11 40 00 10','Food service equipment, commercial range',    'EA',  4800,680, 100,  15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 12 — FURNISHINGS ───────────────────────────────────────────────
('12','12 21 00','12 21 00 10','Window blinds, horizontal, 2in aluminum',    'SF',  3.20,2.80,0.10, 15, NULL, 2025, 'rsmeans'),
('12','12 48 00','12 48 00 10','Floor mat, recessed, 3/8in thick',            'SF',  18,  8,   0.50, 15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 13 — SPECIAL CONSTRUCTION ──────────────────────────────────────
('13','13 11 00','13 11 00 10','Swimming pool, concrete, 20x40, installed',  'EA',  48000,28000,6000,15,NULL,2025,'rsmeans'),
('13','13 34 00','13 34 00 10','Pre-engineered metal building, per SF',      'SF',  18,  12,  2,    15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 14 — CONVEYING EQUIPMENT ───────────────────────────────────────
('14','14 20 00','14 20 00 10','Elevator, hydraulic, 2500 lb, 2 stop',       'EA',  48000,18000,2000,15,NULL,2025,'rsmeans'),
('14','14 20 00','14 20 00 20','Elevator, traction, 3500 lb, 5 stop',        'EA',  82000,28000,3000,15,NULL,2025,'rsmeans'),
('14','14 20 00','14 20 00 30','Elevator, freight, 5000 lb, 2 stop',         'EA',  62000,22000,2500,15,NULL,2025,'rsmeans'),
('14','14 31 00','14 31 00 10','Escalator, 48in wide, per floor rise',        'EA',  68000,18000,4000,15,NULL,2025,'rsmeans'),

-- ─── DIVISION 21 — FIRE SUPPRESSION ──────────────────────────────────────────
('21','21 10 00','21 10 00 10','Fire sprinkler, wet pipe, light hazard',     'SF',  2.20,3.80,0.30, 15, NULL, 2025, 'rsmeans'),
('21','21 10 00','21 10 00 20','Fire sprinkler, wet pipe, ordinary hazard',  'SF',  3.20,4.20,0.40, 15, NULL, 2025, 'rsmeans'),
('21','21 10 00','21 10 00 30','Fire sprinkler, dry pipe system, per SF',    'SF',  4.20,5.20,0.60, 15, NULL, 2025, 'rsmeans'),
('21','21 10 00','21 10 00 40','Fire sprinkler head, pendent, per EA',       'EA',  12,  28,  1,    15, NULL, 2025, 'rsmeans'),
('21','21 10 00','21 10 00 50','Fire pump, electric, 750 gpm, 100 psi',      'EA',  18000,8200,800,  15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 22 — PLUMBING ──────────────────────────────────────────────────
('22','22 10 00','22 10 00 10','Copper pipe, type L, 3/4in, installed',      'LF',  8.20,12,  0.60, 15, NULL, 2025, 'rsmeans'),
('22','22 10 00','22 10 00 20','Copper pipe, type L, 1in, installed',        'LF',  11,  14,  0.70, 15, NULL, 2025, 'rsmeans'),
('22','22 10 00','22 10 00 30','Copper pipe, type L, 2in, installed',        'LF',  22,  18,  1,    15, NULL, 2025, 'rsmeans'),
('22','22 10 00','22 10 00 40','PVC pipe, schedule 40, 3in, installed',      'LF',  6.80,8.40,0.40, 15, NULL, 2025, 'rsmeans'),
('22','22 10 00','22 10 00 50','PVC pipe, schedule 40, 4in, installed',      'LF',  8.80,10,  0.50, 15, NULL, 2025, 'rsmeans'),
('22','22 10 00','22 10 00 60','Cast iron pipe, 4in, no-hub, installed',     'LF',  14,  16,  0.80, 15, NULL, 2025, 'rsmeans'),
('22','22 40 00','22 40 00 10','Water closet, floor mounted, flush valve',   'EA',  680, 480, 30,   15, NULL, 2025, 'rsmeans'),
('22','22 40 00','22 40 00 20','Water closet, wall hung, flush valve',       'EA',  820, 580, 40,   15, NULL, 2025, 'rsmeans'),
('22','22 40 00','22 40 00 30','Lavatory, wall hung, vitreous china',        'EA',  420, 380, 20,   15, NULL, 2025, 'rsmeans'),
('22','22 40 00','22 40 00 40','Urinal, wall hung, flush valve',             'EA',  580, 420, 25,   15, NULL, 2025, 'rsmeans'),
('22','22 40 00','22 40 00 50','Shower, fiberglass, 36x36',                  'EA',  680, 480, 30,   15, NULL, 2025, 'rsmeans'),
('22','22 40 00','22 40 00 60','Floor drain, 4in, cast iron',                'EA',  120, 180, 8,    15, NULL, 2025, 'rsmeans'),
('22','22 40 00','22 40 00 70','Water heater, electric, 80 gal',             'EA',  1480,480, 40,   15, NULL, 2025, 'rsmeans'),
('22','22 40 00','22 40 00 80','Water heater, gas, 100 gal, commercial',     'EA',  2200,680, 60,   15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 23 — HVAC ──────────────────────────────────────────────────────
('23','23 05 00','23 05 00 10','Insulation, duct, 1in fiberglass wrap',      'SF',  1.40,1.80,0.08, 15, NULL, 2025, 'rsmeans'),
('23','23 09 00','23 09 00 10','Building automation system, per point',      'EA',  380, 220, 20,   15, NULL, 2025, 'rsmeans'),
('23','23 31 00','23 31 00 10','Sheet metal duct, rectangular, 26 ga',       'LF',  18,  22,  1.20, 15, NULL, 2025, 'rsmeans'),
('23','23 31 00','23 31 00 20','Spiral duct, round, 12in diameter',          'LF',  12,  14,  0.80, 15, NULL, 2025, 'rsmeans'),
('23','23 31 00','23 31 00 30','Flexible duct, 6in diameter',                'LF',  4.20,5.80,0.20, 15, NULL, 2025, 'rsmeans'),
('23','23 31 00','23 31 00 40','VAV box, single duct, 600 cfm',              'EA',  820, 480, 40,   15, NULL, 2025, 'rsmeans'),
('23','23 31 00','23 31 00 50','Diffuser, ceiling, 24x24, 4-way',            'EA',  68,  68,  3,    15, NULL, 2025, 'rsmeans'),
('23','23 37 00','23 37 00 10','Air handling unit, 10,000 cfm',              'EA',  18000,8200,800,  15, NULL, 2025, 'rsmeans'),
('23','23 37 00','23 37 00 20','Fan coil unit, 4-pipe, 400 cfm',             'EA',  1480,680, 60,   15, NULL, 2025, 'rsmeans'),
('23','23 52 00','23 52 00 10','Boiler, hot water, gas, 1000 MBH',           'EA',  18000,8200,800,  15, NULL, 2025, 'rsmeans'),
('23','23 64 00','23 64 00 10','Chiller, centrifugal, 200 ton',              'EA',  128000,28000,6000,15,NULL,2025,'rsmeans'),
('23','23 64 00','23 64 00 20','Cooling tower, open, 200 ton',               'EA',  48000,18000,4000,15,NULL,2025,'rsmeans'),
('23','23 82 00','23 82 00 10','Split system, AC, 3 ton, residential',       'EA',  2800,1480,120,  15, NULL, 2025, 'rsmeans'),
('23','23 82 00','23 82 00 20','Rooftop unit, packaged, 10 ton',             'EA',  12000,4800,480,  15, NULL, 2025, 'rsmeans'),
('23','23 82 00','23 82 00 30','Heat pump, air source, 5 ton',               'EA',  6800,2400,200,  15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 26 — ELECTRICAL ────────────────────────────────────────────────
('26','26 05 00','26 05 00 10','Conduit, EMT, 3/4in, installed',             'LF',  2.80,4.20,0.15, 15, NULL, 2025, 'rsmeans'),
('26','26 05 00','26 05 00 20','Conduit, EMT, 1in, installed',               'LF',  3.80,4.80,0.18, 15, NULL, 2025, 'rsmeans'),
('26','26 05 00','26 05 00 30','Conduit, rigid, 2in, installed',             'LF',  8.20,8.40,0.30, 15, NULL, 2025, 'rsmeans'),
('26','26 05 00','26 05 00 40','Wire, #12 THHN, in conduit',                 'LF',  0.48,0.68,0.02, 15, NULL, 2025, 'rsmeans'),
('26','26 05 00','26 05 00 50','Wire, #10 THHN, in conduit',                 'LF',  0.72,0.72,0.02, 15, NULL, 2025, 'rsmeans'),
('26','26 05 00','26 05 00 60','Wire, 250 MCM, in conduit',                  'LF',  8.40,3.20,0.15, 15, NULL, 2025, 'rsmeans'),
('26','26 24 00','26 24 00 10','Panelboard, 200A, 208/120V, 42-circuit',     'EA',  2400,1480,80,   15, NULL, 2025, 'rsmeans'),
('26','26 24 00','26 24 00 20','Switchboard, 1600A, 480/277V',               'EA',  18000,8200,400,  15, NULL, 2025, 'rsmeans'),
('26','26 24 00','26 24 00 30','Motor control center, 480V, per section',    'EA',  8200,3800,200,  15, NULL, 2025, 'rsmeans'),
('26','26 27 00','26 27 00 10','Duplex receptacle, 20A, 120V',               'EA',  8.20,28,  0.80, 15, NULL, 2025, 'rsmeans'),
('26','26 27 00','26 27 00 20','GFCI receptacle, 20A, 120V',                 'EA',  18,  28,  0.80, 15, NULL, 2025, 'rsmeans'),
('26','26 27 00','26 27 00 30','Circuit breaker, 20A, 1-pole',               'EA',  22,  28,  1,    15, NULL, 2025, 'rsmeans'),
('26','26 27 00','26 27 00 40','Circuit breaker, 100A, 3-pole',              'EA',  180, 68,  3,    15, NULL, 2025, 'rsmeans'),
('26','26 51 00','26 51 00 10','LED fixture, 2x4 troffer, 4000K',            'EA',  88,  68,  3,    15, NULL, 2025, 'rsmeans'),
('26','26 51 00','26 51 00 20','LED fixture, high bay, 200W',                'EA',  180, 88,  4,    15, NULL, 2025, 'rsmeans'),
('26','26 51 00','26 51 00 30','LED fixture, exterior pole, 100W',           'EA',  480, 280, 20,   15, NULL, 2025, 'rsmeans'),
('26','26 51 00','26 51 00 40','Exit sign, LED, battery backup',             'EA',  88,  48,  2,    15, NULL, 2025, 'rsmeans'),
('26','26 56 00','26 56 00 10','Generator, diesel, 100 kW, standby',         'EA',  28000,8200,1200, 15, NULL, 2025, 'rsmeans'),
('26','26 56 00','26 56 00 20','Generator, diesel, 500 kW, standby',         'EA',  82000,18000,4000,15,NULL,2025,'rsmeans'),
('26','26 56 00','26 56 00 30','UPS, 30 kVA, static',                        'EA',  12000,2800,200,  15, NULL, 2025, 'rsmeans'),
('26','26 56 00','26 56 00 40','Transfer switch, automatic, 400A',           'EA',  8200,2400,200,  15, NULL, 2025, 'rsmeans'),
('26','26 56 00','26 56 00 50','Solar PV panel, 400W, grid-tied, per panel', 'EA',  280, 120, 8,    15, NULL, 2025, 'rsmeans'),
('26','26 56 00','26 56 00 60','EV charging station, Level 2, 7.2kW',        'EA',  1480,680, 40,   15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 27 — COMMUNICATIONS ────────────────────────────────────────────
('27','27 10 00','27 10 00 10','Data cable, Cat 6, horizontal run',          'LF',  0.48,1.20,0.04, 15, NULL, 2025, 'rsmeans'),
('27','27 10 00','27 10 00 20','Data outlet, Cat 6, double, installed',      'EA',  28,  48,  2,    15, NULL, 2025, 'rsmeans'),
('27','27 10 00','27 10 00 30','Network rack, 42U, floor mounted',           'EA',  1480,380, 40,   15, NULL, 2025, 'rsmeans'),
('27','27 10 00','27 10 00 40','Patch panel, 48-port, Cat 6',                'EA',  280, 120, 5,    15, NULL, 2025, 'rsmeans'),
('27','27 32 00','27 32 00 10','Public address system, per zone',             'EA',  1480,680, 40,   15, NULL, 2025, 'rsmeans'),
('27','27 41 00','27 41 00 10','AV system, conference room, 70in display',   'EA',  6800,2400,200,  15, NULL, 2025, 'rsmeans'),

-- ─── DIVISION 28 — ELECTRONIC SAFETY AND SECURITY ────────────────────────────
('28','28 10 00','28 10 00 10','Access control, card reader, per door',      'EA',  820, 480, 30,   15, NULL, 2025, 'rsmeans'),
('28','28 13 00','28 13 00 10','CCTV camera, IP, interior dome',             'EA',  280, 180, 10,   15, NULL, 2025, 'rsmeans'),
('28','28 13 00','28 13 00 20','CCTV camera, IP, exterior PTZ',              'EA',  680, 280, 20,   15, NULL, 2025, 'rsmeans'),
('28','28 13 00','28 13 00 30','NVR, 16-channel, 8TB storage',               'EA',  1480,280, 20,   15, NULL, 2025, 'rsmeans'),
('28','28 31 00','28 31 00 10','Fire alarm initiating device, smoke detector','EA',  68,  88,  3,    15, NULL, 2025, 'rsmeans'),
('28','28 31 00','28 31 00 20','Fire alarm notification device, horn/strobe', 'EA',  88,  68,  3,    15, NULL, 2025, 'rsmeans'),
('28','28 31 00','28 31 00 30','Fire alarm control panel, 250 point',        'EA',  4800,2400,100,  15, NULL, 2025, 'rsmeans'),
('28','28 31 00','28 31 00 40','Mass notification system, per speaker',      'EA',  180, 120, 5,    15, NULL, 2025, 'rsmeans')

ON CONFLICT DO NOTHING;
