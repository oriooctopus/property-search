/** Shared tag metadata used by both Filters and ListingCard */

export const TAG_COLORS: Record<string, string> = {
  fulton: '#f97316',
  ltrain: '#a78bfa',
  manhattan: '#38bdf8',
  brooklyn: '#4ade80',
};

export const TAG_LABELS: Record<string, string> = {
  fulton: 'Fulton St',
  ltrain: 'L Train',
  manhattan: 'Manhattan',
  brooklyn: 'Brooklyn',
};

export const TAG_DESCRIPTIONS: Record<string, string> = {
  fulton: 'Listings within a 25-minute subway/bus ride of Fulton St station in Lower Manhattan',
  ltrain: 'Listings within a 10-minute walk of L train stops from Bedford Ave through DeKalb Ave',
  manhattan: 'Manhattan listings between Park Place (Tribeca) and 38th St (Midtown), covering Downtown, SoHo, the Village, Chelsea, and the Flatiron area',
  brooklyn: 'Brooklyn listings within a 35-minute subway ride of 14th St (any stop between 8th Ave and 1st Ave)',
};
