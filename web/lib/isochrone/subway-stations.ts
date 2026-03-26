/**
 * NYC subway station data.
 *
 * Stations that share a physical location (e.g. transfer complexes) are
 * grouped into a single entry with all lines served listed together.
 *
 * TODO: Generate the full ~472 station list from MTA GTFS stops.txt using
 * web/scripts/parse-gtfs-stops.ts. For now this contains 60+ major stations
 * covering the areas most relevant to the property search (Manhattan below
 * 100th St, north/west Brooklyn, and the L train corridor).
 */

import type { SubwayStation } from "./types";

const SUBWAY_STATIONS: SubwayStation[] = [
  // ---- Lower Manhattan / FiDi ----
  { stopId: "R27", name: "Whitehall St-South Ferry", lat: 40.7033, lon: -74.0134, lines: ["R", "W", "1"] },
  { stopId: "R25", name: "Broad St", lat: 40.7065, lon: -74.0113, lines: ["J", "Z"] },
  { stopId: "R24", name: "Fulton St", lat: 40.7092, lon: -74.0065, lines: ["2", "3", "4", "5", "A", "C", "J", "Z"] },
  { stopId: "R23", name: "Park Place", lat: 40.7131, lon: -74.0087, lines: ["2", "3"] },
  { stopId: "R22", name: "Chambers St", lat: 40.7142, lon: -74.0037, lines: ["1", "2", "3", "A", "C", "J", "Z"] },
  { stopId: "A36", name: "World Trade Center", lat: 40.7127, lon: -74.0099, lines: ["E"] },
  { stopId: "R21", name: "City Hall", lat: 40.7137, lon: -74.0030, lines: ["R", "W"] },
  { stopId: "A38", name: "Brooklyn Bridge-City Hall", lat: 40.7131, lon: -74.0000, lines: ["4", "5", "6"] },

  // ---- Chinatown / LES ----
  { stopId: "Q01", name: "Canal St", lat: 40.7191, lon: -74.0001, lines: ["6", "J", "N", "Q", "R", "W", "Z"] },
  { stopId: "F14", name: "East Broadway", lat: 40.7139, lon: -73.9904, lines: ["F"] },
  { stopId: "F15", name: "Delancey St-Essex St", lat: 40.7185, lon: -73.9883, lines: ["F", "J", "M", "Z"] },

  // ---- SoHo / NoHo / Nolita ----
  { stopId: "D21", name: "Spring St", lat: 40.7223, lon: -73.9974, lines: ["6"] },
  { stopId: "A33", name: "Spring St (ACE)", lat: 40.7262, lon: -74.0037, lines: ["A", "C", "E"] },
  { stopId: "D20", name: "Bleecker St-Lafayette St", lat: 40.7258, lon: -73.9946, lines: ["4", "6", "B", "D", "F", "M"] },
  { stopId: "R20", name: "Prince St", lat: 40.7243, lon: -73.9977, lines: ["N", "R", "W"] },
  { stopId: "D19", name: "Broadway-Lafayette St", lat: 40.7254, lon: -73.9962, lines: ["B", "D", "F", "M"] },

  // ---- West Village / Greenwich Village ----
  { stopId: "A32", name: "West 4th St-Washington Sq", lat: 40.7322, lon: -74.0003, lines: ["A", "B", "C", "D", "E", "F", "M"] },
  { stopId: "D18", name: "Astor Place", lat: 40.7301, lon: -73.9910, lines: ["4", "6"] },
  { stopId: "A31", name: "14th St (ACE)", lat: 40.7380, lon: -74.0003, lines: ["A", "C", "E"] },
  { stopId: "R19", name: "8th St-NYU", lat: 40.7306, lon: -73.9927, lines: ["N", "R", "W"] },
  { stopId: "635", name: "Christopher St-Sheridan Sq", lat: 40.7334, lon: -74.0027, lines: ["1"] },
  { stopId: "132", name: "Houston St", lat: 40.7282, lon: -74.0053, lines: ["1"] },

  // ---- Chelsea / Flatiron / Gramercy ----
  { stopId: "R17", name: "14th St-Union Sq", lat: 40.7359, lon: -73.9907, lines: ["4", "5", "6", "N", "Q", "R", "W", "L"] },
  { stopId: "130", name: "18th St", lat: 40.7412, lon: -73.9979, lines: ["1"] },
  { stopId: "R16", name: "23rd St (NRW)", lat: 40.7414, lon: -73.9895, lines: ["N", "R", "W"] },
  { stopId: "129", name: "23rd St (1)", lat: 40.7440, lon: -74.0003, lines: ["1"] },
  { stopId: "A28", name: "23rd St (ACE)", lat: 40.7459, lon: -74.0003, lines: ["A", "C", "E"] },
  { stopId: "R15", name: "28th St (NRW)", lat: 40.7454, lon: -73.9881, lines: ["N", "R", "W"] },
  { stopId: "128", name: "28th St (1)", lat: 40.7473, lon: -74.0015, lines: ["1"] },

  // ---- Midtown ----
  { stopId: "R14", name: "34th St-Herald Sq", lat: 40.7497, lon: -73.9880, lines: ["B", "D", "F", "M", "N", "Q", "R", "W"] },
  { stopId: "A27", name: "34th St-Penn Station", lat: 40.7506, lon: -73.9913, lines: ["1", "2", "3", "A", "C", "E"] },
  { stopId: "R13", name: "Times Sq-42nd St", lat: 40.7559, lon: -73.9871, lines: ["1", "2", "3", "7", "N", "Q", "R", "W", "S"] },
  { stopId: "A25", name: "42nd St-Port Authority", lat: 40.7575, lon: -73.9903, lines: ["A", "C", "E"] },
  { stopId: "R11", name: "49th St", lat: 40.7602, lon: -73.9843, lines: ["N", "R", "W"] },
  { stopId: "D15", name: "47-50th Sts-Rockefeller Ctr", lat: 40.7585, lon: -73.9813, lines: ["B", "D", "F", "M"] },
  { stopId: "610", name: "Grand Central-42nd St", lat: 40.7529, lon: -73.9770, lines: ["4", "5", "6", "7", "S"] },
  { stopId: "R12", name: "5th Ave-Bryant Park", lat: 40.7539, lon: -73.9819, lines: ["7", "B", "D", "F", "M"] },
  { stopId: "A24", name: "50th St (ACE)", lat: 40.7619, lon: -73.9860, lines: ["A", "C", "E"] },
  { stopId: "125", name: "50th St (1)", lat: 40.7617, lon: -73.9839, lines: ["1"] },
  { stopId: "D14", name: "57th St (NQRW)", lat: 40.7643, lon: -73.9775, lines: ["N", "Q", "R", "W"] },
  { stopId: "A21", name: "59th St-Columbus Circle", lat: 40.7681, lon: -73.9819, lines: ["1", "A", "B", "C", "D"] },
  { stopId: "R09", name: "Lexington Ave-59th St", lat: 40.7627, lon: -73.9668, lines: ["4", "5", "6", "N", "R", "W"] },

  // ---- Upper West Side / Uptown West ----
  { stopId: "122", name: "66th St-Lincoln Center", lat: 40.7735, lon: -73.9821, lines: ["1"] },
  { stopId: "121", name: "72nd St (1)", lat: 40.7785, lon: -73.9819, lines: ["1"] },
  { stopId: "A18", name: "72nd St (ABC)", lat: 40.7756, lon: -73.9762, lines: ["A", "B", "C"] },
  { stopId: "120", name: "79th St", lat: 40.7838, lon: -73.9799, lines: ["1"] },
  { stopId: "119", name: "86th St (1)", lat: 40.7890, lon: -73.9768, lines: ["1"] },
  { stopId: "A15", name: "86th St (ABC)", lat: 40.7853, lon: -73.9688, lines: ["A", "B", "C"] },
  { stopId: "118", name: "96th St (1)", lat: 40.7936, lon: -73.9723, lines: ["1"] },
  { stopId: "A14", name: "96th St (ABC)", lat: 40.7918, lon: -73.9649, lines: ["A", "B", "C"] },

  // ---- L Train Corridor (Manhattan → Brooklyn) ----
  { stopId: "L01", name: "8th Ave (L)", lat: 40.7396, lon: -74.0027, lines: ["L"] },
  { stopId: "L02", name: "6th Ave (L)", lat: 40.7376, lon: -73.9969, lines: ["L"] },
  { stopId: "L03", name: "3rd Ave (L)", lat: 40.7329, lon: -73.9862, lines: ["L"] },
  { stopId: "L05", name: "1st Ave (L)", lat: 40.7307, lon: -73.9817, lines: ["L"] },
  { stopId: "L06", name: "Bedford Ave", lat: 40.7171, lon: -73.9567, lines: ["L"] },
  { stopId: "L08", name: "Lorimer St (L)", lat: 40.7140, lon: -73.9502, lines: ["L"] },
  { stopId: "L10", name: "Graham Ave", lat: 40.7142, lon: -73.9440, lines: ["L"] },
  { stopId: "L11", name: "Grand St (L)", lat: 40.7116, lon: -73.9402, lines: ["L"] },
  { stopId: "L12", name: "Montrose Ave", lat: 40.7075, lon: -73.9398, lines: ["L"] },
  { stopId: "L13", name: "Morgan Ave", lat: 40.7062, lon: -73.9331, lines: ["L"] },
  { stopId: "L14", name: "Jefferson St", lat: 40.7066, lon: -73.9229, lines: ["L"] },
  { stopId: "L15", name: "DeKalb Ave (L)", lat: 40.7035, lon: -73.9183, lines: ["L"] },
  { stopId: "L16", name: "Myrtle-Wyckoff Aves", lat: 40.6994, lon: -73.9120, lines: ["L", "M"] },

  // ---- North Brooklyn (G, J/M/Z) ----
  { stopId: "G29", name: "Greenpoint Ave", lat: 40.7314, lon: -73.9542, lines: ["G"] },
  { stopId: "G28", name: "Nassau Ave", lat: 40.7244, lon: -73.9510, lines: ["G"] },
  { stopId: "G26", name: "Metropolitan Ave-Lorimer St", lat: 40.7140, lon: -73.9513, lines: ["G", "L"] },
  { stopId: "G24", name: "Flushing Ave (G)", lat: 40.7003, lon: -73.9504, lines: ["G"] },
  { stopId: "G22", name: "Clinton-Washington Aves (G)", lat: 40.6887, lon: -73.9660, lines: ["G"] },
  { stopId: "G20", name: "Fulton St (G)", lat: 40.6870, lon: -73.9752, lines: ["G"] },
  { stopId: "J27", name: "Marcy Ave", lat: 40.7083, lon: -73.9579, lines: ["J", "M", "Z"] },
  { stopId: "J28", name: "Hewes St", lat: 40.7068, lon: -73.9535, lines: ["J", "M"] },
  { stopId: "G30", name: "Broadway (G)", lat: 40.7061, lon: -73.9502, lines: ["G"] },

  // ---- Downtown Brooklyn / Boerum Hill / Fort Greene ----
  { stopId: "R30", name: "Jay St-MetroTech", lat: 40.6924, lon: -73.9870, lines: ["A", "C", "F", "R"] },
  { stopId: "D24", name: "Atlantic Ave-Barclays Ctr", lat: 40.6842, lon: -73.9779, lines: ["2", "3", "4", "5", "B", "D", "N", "Q", "R"] },
  { stopId: "G36", name: "Bergen St (FG)", lat: 40.6862, lon: -73.9756, lines: ["F", "G"] },
  { stopId: "R31", name: "DeKalb Ave (BQR)", lat: 40.6905, lon: -73.9818, lines: ["B", "Q", "R"] },
  { stopId: "235", name: "Hoyt St", lat: 40.6903, lon: -73.9850, lines: ["2", "3"] },
  { stopId: "A41", name: "Hoyt-Schermerhorn Sts", lat: 40.6885, lon: -73.9851, lines: ["A", "C", "G"] },

  // ---- Park Slope / Prospect Heights / Crown Heights ----
  { stopId: "D25", name: "7th Ave (BQ)", lat: 40.6772, lon: -73.9726, lines: ["B", "Q"] },
  { stopId: "F20", name: "7th Ave (FG)", lat: 40.6702, lon: -73.9803, lines: ["F", "G"] },
  { stopId: "F21", name: "15th St-Prospect Park", lat: 40.6603, lon: -73.9798, lines: ["F", "G"] },
  { stopId: "D26", name: "Prospect Park (BQS)", lat: 40.6616, lon: -73.9622, lines: ["B", "Q", "S"] },
  { stopId: "S04", name: "Franklin Ave-Medgar Evers", lat: 40.6707, lon: -73.9580, lines: ["2", "3", "4", "5", "S"] },
  { stopId: "A46", name: "Nostrand Ave (AC)", lat: 40.6800, lon: -73.9506, lines: ["A", "C"] },
  { stopId: "D28", name: "Crown Heights-Utica Ave", lat: 40.6689, lon: -73.9321, lines: ["3", "4"] },

  // ---- Bed-Stuy / Bushwick ----
  { stopId: "A44", name: "Utica Ave (AC)", lat: 40.6792, lon: -73.9308, lines: ["A", "C"] },
  { stopId: "J21", name: "Myrtle Ave (JMZ)", lat: 40.6972, lon: -73.9355, lines: ["J", "M", "Z"] },
  { stopId: "J20", name: "Flushing Ave (JM)", lat: 40.7004, lon: -73.9413, lines: ["J", "M"] },
  { stopId: "L17", name: "Halsey St (L)", lat: 40.6954, lon: -73.9044, lines: ["L"] },
  { stopId: "J19", name: "Kosciuszko St", lat: 40.6932, lon: -73.9287, lines: ["J"] },
  { stopId: "L19", name: "Bushwick Ave-Aberdeen St", lat: 40.6829, lon: -73.9053, lines: ["L"] },
];

export default SUBWAY_STATIONS;
