import { describe, expect, it } from 'vitest';

import type { DecodedMpn } from '../types.js';
import { analogDevices } from './analog-devices.js';
import { diodesIncorporated } from './diodes-incorporated.js';
import { microchip } from './microchip.js';
import { monolithicPowerSystems } from './monolithic-power-systems.js';
import { onsemi } from './onsemi.js';
import { richtek } from './richtek.js';
import { stmicroelectronics } from './stmicroelectronics.js';
import { texasInstruments } from './texas-instruments.js';

/** The fields a case asserts; anything it does not name is not checked here. */
type Expected = Partial<
  Pick<DecodedMpn, 'family' | 'basePart' | 'packaging' | 'leadFinish' | 'automotive' | 'extras'>
> & {
  readonly package?: string | null;
  readonly grade?: string | null;
  readonly range?: { minC: number; maxC: number; reference: 'TJ' | 'TA' | null } | null;
};

function check(decoded: DecodedMpn | null, expected: Expected): void {
  expect(decoded).not.toBeNull();
  if (decoded === null) {
    return;
  }
  if (expected.family !== undefined) {
    expect(decoded.family).toBe(expected.family);
  }
  if (expected.basePart !== undefined) {
    expect(decoded.basePart).toBe(expected.basePart);
  }
  if (expected.package !== undefined) {
    expect(decoded.package?.code ?? null).toBe(expected.package);
  }
  if (expected.grade !== undefined) {
    expect(decoded.temperatureGrade?.code ?? null).toBe(expected.grade);
  }
  if (expected.range !== undefined) {
    expect(decoded.temperatureGrade?.range ?? null).toEqual(expected.range);
  }
  if (expected.packaging !== undefined) {
    expect(decoded.packaging).toBe(expected.packaging);
  }
  if (expected.leadFinish !== undefined) {
    expect(decoded.leadFinish).toBe(expected.leadFinish);
  }
  if (expected.automotive !== undefined) {
    expect(decoded.automotive).toBe(expected.automotive);
  }
  if (expected.extras !== undefined) {
    expect(decoded.extras).toEqual(expected.extras);
  }
}

describe('texasInstruments', () => {
  it('reads the package and reel codes', () => {
    check(texasInstruments.decode('TPS54331DR'), {
      family: 'TPS54331',
      basePart: 'TPS54331',
      package: 'D',
      packaging: 'reel',
      automotive: false,
    });
    check(texasInstruments.decode('TPS54331DDAR'), { package: 'DDA', packaging: 'reel' });
    check(texasInstruments.decode('TPS54340DDA'), { package: 'DDA', packaging: 'tube' });
    check(texasInstruments.decode('TPS62175DQCT'), { package: 'DQC', packaging: 'reel' });
  });

  it('does not mistake a longer package code for a shorter one', () => {
    // D is SOIC and DDA is SO PowerPAD: reading DDAR as D + DAR would put the
    // part in the wrong package and leave a reel code that means nothing.
    expect(texasInstruments.decode('TPS54331DDAR')?.package?.description).toBe('SO PowerPAD');
    expect(texasInstruments.decode('TPS54331DR')?.package?.description).toBe('SOIC');
  });

  it('keeps the version letter in the base part', () => {
    // LMR33620A and LMR33620B are different regulators, not two reels of one.
    check(texasInstruments.decode('LMR33620ADDAR'), {
      family: 'LMR33620',
      basePart: 'LMR33620-A',
    });
    check(texasInstruments.decode('LMR33620BDDAR'), { basePart: 'LMR33620-B' });
  });

  it('reads both automotive markers', () => {
    check(texasInstruments.decode('TPS54360BQDDARQ1'), {
      family: 'TPS54360',
      basePart: 'TPS54360-B',
      package: 'DDA',
      packaging: 'reel',
      automotive: true,
    });
    check(texasInstruments.decode('TPS5430QDDARQ1'), {
      basePart: 'TPS5430',
      package: 'DDA',
      automotive: true,
    });
  });

  it('keeps the option codes around the automotive marker in the base part', () => {
    check(texasInstruments.decode('LMR33620CQ5RNXTQ1'), {
      basePart: 'LMR33620-C-5',
      package: 'RNX',
      automotive: true,
    });
    check(texasInstruments.decode('LMR33620APAQRNXRQ1'), {
      basePart: 'LMR33620-APA',
      package: 'RNX',
      automotive: true,
    });
  });

  it('reads a device number that carries a letter of its own', () => {
    check(texasInstruments.decode('TPS62A01DRLR'), {
      family: 'TPS62A01',
      basePart: 'TPS62A01',
      package: 'DRL',
    });
    check(texasInstruments.decode('TPS548A28RWWR'), { family: 'TPS548A28', package: 'RWW' });
  });

  it('returns null for evaluation modules and unreadable suffixes', () => {
    expect(texasInstruments.decode('LMR33630ADDAEVM')).toBeNull();
    expect(texasInstruments.decode('TPS54KC23RZRR')).toBeNull();
    expect(texasInstruments.decode('COM-18000')).toBeNull();
  });
});

describe('analogDevices', () => {
  it('reads the Linear Technology scheme', () => {
    check(analogDevices.decode('LT8610EMSE#PBF'), {
      family: 'LT8610',
      basePart: 'LT8610',
      package: 'MSE',
      grade: 'E',
      range: { minC: -40, maxC: 125, reference: 'TJ' },
      packaging: 'tube',
      leadFinish: 'lead-free',
    });
    check(analogDevices.decode('LT8610EMSE#TRPBF'), { packaging: 'reel' });
  });

  it('reads variant letters and a fixed output voltage into the base part', () => {
    check(analogDevices.decode('LT8610ABEMSE-3.3#TRPBF'), {
      family: 'LT8610',
      basePart: 'LT8610-AB-3.3',
      grade: 'E',
      packaging: 'reel',
    });
    check(analogDevices.decode('LT8610ACHMSE-1#PBF'), {
      basePart: 'LT8610-AC-1',
      grade: 'H',
      range: { minC: -40, maxC: 150, reference: 'TJ' },
    });
  });

  it('reads every temperature grade it claims', () => {
    const grades: [string, number, number][] = [
      ['LT8610EMSE#PBF', -40, 125],
      ['LT8610IMSE#PBF', -40, 125],
      ['LT8610HMSE#PBF', -40, 150],
      ['LT8610AXMSE#PBF', -40, 175],
      ['LTC3630MPMSE#PBF', -55, 150],
    ];
    for (const [mpn, minC, maxC] of grades) {
      check(analogDevices.decode(mpn), { range: { minC, maxC, reference: 'TJ' } });
    }
  });

  it('records the wafer option without letting it change the part', () => {
    check(analogDevices.decode('LTC3630AIMSE#WTRPBF'), {
      basePart: 'LTC3630-A',
      packaging: 'reel',
      extras: ['adi-option:W'],
    });
  });

  it('reads the Maxim scheme', () => {
    check(analogDevices.decode('MAX17503ATP+T'), {
      family: 'MAX17503',
      basePart: 'MAX17503',
      package: 'TP',
      grade: 'A',
      packaging: 'reel',
      leadFinish: 'lead-free',
    });
    check(analogDevices.decode('MAX17503SATP+'), {
      basePart: 'MAX17503-S',
      packaging: 'tray',
    });
  });

  it('returns null for demo boards and evaluation kits', () => {
    expect(analogDevices.decode('DC2105A-A')).toBeNull();
    expect(analogDevices.decode('MAX17503EVKITA#')).toBeNull();
    expect(analogDevices.decode('MAXREFDES98#')).toBeNull();
  });
});

describe('monolithicPowerSystems', () => {
  it('reads the package and the reel codes', () => {
    check(monolithicPowerSystems.decode('MP2315GJ-Z'), {
      family: 'MP2315',
      basePart: 'MP2315',
      package: 'GJ',
      packaging: 'reel',
      extras: [],
    });
    // -P is the 500-part reel and -Z the full one: both are reels.
    check(monolithicPowerSystems.decode('MP2315SGJ-P'), {
      basePart: 'MP2315-S',
      packaging: 'reel',
      extras: [],
    });
    check(monolithicPowerSystems.decode('MP1584EN-LF-Z'), {
      package: 'EN',
      leadFinish: 'lead-free',
    });
  });

  it('reads the automotive marker rather than swallowing it as an option', () => {
    check(monolithicPowerSystems.decode('MPQ4420GJ-AEC1-Z'), {
      family: 'MPQ4420',
      basePart: 'MPQ4420',
      package: 'GJ',
      automotive: true,
    });
    check(monolithicPowerSystems.decode('MPQ4323GDE-33-AEC1-P'), {
      basePart: 'MPQ4323-33',
      package: 'GDE',
      automotive: true,
    });
    check(monolithicPowerSystems.decode('MPQ4560DN-AEC1-LF-Z'), {
      package: 'DN',
      automotive: true,
      leadFinish: 'lead-free',
    });
  });

  it('states no packaging when the part number carries no reel code', () => {
    check(monolithicPowerSystems.decode('MPQ4470GL'), { packaging: 'unknown' });
  });
});

describe('diodesIncorporated', () => {
  it('reads the package and the reel size', () => {
    check(diodesIncorporated.decode('AP63203WU-7'), {
      family: 'AP63203',
      basePart: 'AP63203',
      package: 'WU',
      packaging: 'reel',
      automotive: false,
    });
    check(diodesIncorporated.decode('AP62150Z6-7'), { package: 'Z6' });
    check(diodesIncorporated.decode('AP62800SJ-7'), { package: 'SJ' });
  });

  it('reads Q as the automotive marker, not as a variant letter', () => {
    check(diodesIncorporated.decode('AP63300QWU-7'), {
      family: 'AP63300',
      basePart: 'AP63300',
      package: 'WU',
      automotive: true,
    });
    check(diodesIncorporated.decode('AP62200TWU-7'), {
      basePart: 'AP62200-T',
      package: 'WU',
      automotive: false,
    });
  });

  it('returns null for evaluation modules', () => {
    expect(diodesIncorporated.decode('AP63203WU-EVM')).toBeNull();
    expect(diodesIncorporated.decode('AP62CO5ZCW20-13')).toBeNull();
  });
});

describe('onsemi', () => {
  it('reads the package, reel and lead finish', () => {
    check(onsemi.decode('NCP3170ADR2G'), {
      family: 'NCP3170',
      basePart: 'NCP3170-A',
      package: 'D',
      packaging: 'reel',
      leadFinish: 'lead-free',
    });
    check(onsemi.decode('NCV890200PDR2G'), { package: 'PD', packaging: 'reel' });
    check(onsemi.decode('NCP1595CMNTWG'), { basePart: 'NCP1595-C', package: 'MN' });
  });

  it('reads the fixed output voltage into the base part', () => {
    check(onsemi.decode('NCV890430MW50TXG'), {
      family: 'NCV890430',
      basePart: 'NCV890430-50',
      package: 'MW',
    });
    check(onsemi.decode('NCP3335AMNADJR2G'), { basePart: 'NCP3335-A-ADJ', package: 'MN' });
    check(onsemi.decode('NCP3335ADM330R2G'), { basePart: 'NCP3335-A-330', package: 'DM' });
  });

  it('returns null for evaluation boards', () => {
    expect(onsemi.decode('NCV890203MWGEVB')).toBeNull();
    expect(onsemi.decode('NCP6335EMT30TBG')).toBeNull();
  });
});

describe('richtek', () => {
  it('reads the package and keeps the green-package code out of the base part', () => {
    check(richtek.decode('RT8279GSP'), {
      family: 'RT8279',
      basePart: 'RT8279',
      package: 'SP',
      extras: ['richtek-code:G'],
    });
    check(richtek.decode('RT6190GQW'), { package: 'QW' });
    check(richtek.decode('RT8259GJ6'), { package: 'J6' });
    check(richtek.decode('RT6208GE'), { package: 'E' });
  });

  it('keeps variant letters and a fixed output voltage in the base part', () => {
    check(richtek.decode('RT7297CHZSP'), {
      family: 'RT7297',
      basePart: 'RT7297-CH',
      extras: ['richtek-code:Z'],
    });
    check(richtek.decode('RT8010-33GQW'), { family: 'RT8010-33', basePart: 'RT8010-33' });
  });

  it('states no packaging, because Richtek does not encode one', () => {
    check(richtek.decode('RT8279GSP'), { packaging: 'unknown' });
  });
});

describe('microchip', () => {
  it('reads the Microchip scheme', () => {
    check(microchip.decode('MCP16331T-E/CH'), {
      family: 'MCP16331',
      basePart: 'MCP16331',
      package: 'CH',
      grade: 'E',
      range: null,
      packaging: 'reel',
    });
    check(microchip.decode('MCP1603-120I/MC'), {
      basePart: 'MCP1603-120',
      package: 'MC',
      grade: 'I',
      packaging: 'unknown',
    });
    check(microchip.decode('MCP1603BT-ADJI/OS'), {
      basePart: 'MCP1603-B-ADJ',
      package: 'OS',
      packaging: 'reel',
    });
  });

  it('records a value-added option without changing the part', () => {
    check(microchip.decode('MCP16311-E/MSVAO'), {
      basePart: 'MCP16311',
      package: 'MS',
      extras: ['value-added-option:VAO'],
    });
  });

  it('reads the Micrel scheme', () => {
    check(microchip.decode('MIC23156-0YCS-TR'), {
      family: 'MIC23156',
      basePart: 'MIC23156-0',
      package: 'CS',
      grade: 'Y',
      range: null,
      packaging: 'reel',
    });
    check(microchip.decode('MIC280-1BM6'), {
      basePart: 'MIC280-1',
      package: 'M6',
      grade: 'B',
      packaging: 'unknown',
    });
    check(microchip.decode('MIC2310-1ZTS'), { package: 'TS', grade: 'Z' });
    check(microchip.decode('MIC2841AYMT-TR'), { basePart: 'MIC2841-A', package: 'MT' });
  });

  it('reads a MIC part written in the Microchip scheme', () => {
    check(microchip.decode('MIC2333T-E/MS'), {
      family: 'MIC2333',
      package: 'MS',
      grade: 'E',
      packaging: 'reel',
    });
  });

  it('returns null for a suffix it cannot read in full', () => {
    expect(microchip.decode('MIC280-7BM6TS')).toBeNull();
    expect(microchip.decode('ADM00519')).toBeNull();
  });
});

describe('stmicroelectronics', () => {
  it('reads the ST1S families, which do carry a package code', () => {
    check(stmicroelectronics.decode('ST1S10PHR'), {
      family: 'ST1S10',
      basePart: 'ST1S10',
      package: 'PH',
      packaging: 'reel',
    });
    check(stmicroelectronics.decode('ST1S10PUR'), { package: 'PU' });
    check(stmicroelectronics.decode('ST1PS01AJR'), { family: 'ST1PS01A', package: 'J' });
  });

  it('keeps L-series variant letters in the base part and reads only the reel', () => {
    // L7987 and L7987L are different regulators, so the letter cannot be a
    // suffix; ST states no package code for the series at all.
    check(stmicroelectronics.decode('L7987'), {
      family: 'L7987',
      basePart: 'L7987',
      package: null,
      packaging: 'tube',
    });
    check(stmicroelectronics.decode('L7987TR'), { basePart: 'L7987', packaging: 'reel' });
    check(stmicroelectronics.decode('L7987L'), { basePart: 'L7987L', packaging: 'tube' });
    check(stmicroelectronics.decode('L7987LTR'), { basePart: 'L7987L', packaging: 'reel' });
    check(stmicroelectronics.decode('L6986H3V3TR'), { basePart: 'L6986H3V3', packaging: 'reel' });
    check(stmicroelectronics.decode('L7986TATR'), { basePart: 'L7986TA', packaging: 'reel' });
  });

  it('returns null for evaluation boards', () => {
    expect(stmicroelectronics.decode('STEVAL-ISA044V6')).toBeNull();
    expect(stmicroelectronics.decode('ST1S10PURDEMOBO')).toBeNull();
  });
});
