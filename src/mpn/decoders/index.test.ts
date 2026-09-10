import { describe, expect, it } from 'vitest';

import { MANUFACTURER_KEYS } from '../types.js';
import { DECODERS, DECODER_LIST, decodeMpn, decoderByKey, decoderFor } from './index.js';

describe('the decoder registry', () => {
  it('holds one decoder per manufacturer, each answering to its own key', () => {
    expect(Object.keys(DECODERS).sort()).toEqual([...MANUFACTURER_KEYS].sort());
    for (const key of MANUFACTURER_KEYS) {
      expect(decoderByKey(key).manufacturer).toBe(key);
    }
    expect(DECODER_LIST).toHaveLength(MANUFACTURER_KEYS.length);
  });

  it('finds a decoder from the manufacturer names distributors use', () => {
    const names: [string, string][] = [
      ['Texas Instruments', 'texas-instruments'],
      ['Analog Devices Inc.', 'analog-devices'],
      ['Analog Devices Inc./Maxim Integrated', 'analog-devices'],
      ['Linear Technology/Analog Devices', 'analog-devices'],
      ['Monolithic Power Systems Inc.', 'monolithic-power-systems'],
      ['Diodes Incorporated', 'diodes-incorporated'],
      ['onsemi', 'onsemi'],
      ['ON Semiconductor', 'onsemi'],
      ['Richtek USA Inc.', 'richtek'],
      ['Microchip Technology', 'microchip'],
      ['Micrel Inc.', 'microchip'],
      ['STMicroelectronics', 'stmicroelectronics'],
    ];
    for (const [name, key] of names) {
      expect(decoderFor(name)?.manufacturer, name).toBe(key);
    }
  });

  it('claims no manufacturer it has no decoder for', () => {
    for (const name of ['Vishay Semiconductor Opto Division', 'TDK', 'SparkFun Electronics', '']) {
      expect(decoderFor(name), name).toBeNull();
    }
  });

  it('decodes through the manufacturer name', () => {
    expect(decodeMpn('TPS54331DR', 'Texas Instruments')?.basePart).toBe('TPS54331');
    expect(decodeMpn('TPS54331DR', 'Vishay')).toBeNull();
    expect(decodeMpn('NOT-A-PART', 'Texas Instruments')).toBeNull();
  });
});
