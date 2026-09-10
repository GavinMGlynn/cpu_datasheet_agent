/** Sections of a datasheet the extraction agent needs to find. */
export const SECTION_PATTERNS = {
  orderingInformation:
    /ordering\s+(information|guide)|device\s+ordering|part\s+number\s+information/i,
  electricalCharacteristics: /electrical\s+characteristics|electrical\s+specifications/i,
  absoluteMaximumRatings: /absolute\s+maximum\s+ratings/i,
  recommendedOperatingConditions: /recommended\s+operating\s+conditions|operating\s+ratings/i,
  pinConfiguration:
    /pin\s+(configuration|assignment|description|function)|terminal\s+configuration/i,
  packageInformation: /package\s+(information|outline|dimensions)|mechanical\s+data/i,
} as const;

export type SectionName = keyof typeof SECTION_PATTERNS;

export const SECTION_NAMES = Object.keys(SECTION_PATTERNS) as readonly SectionName[];
