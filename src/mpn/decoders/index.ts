import type { Decoder } from '../grammar.js';
import type { DecodedMpn, ManufacturerKey } from '../types.js';
import { analogDevices } from './analog-devices.js';
import { diodesIncorporated } from './diodes-incorporated.js';
import { microchip } from './microchip.js';
import { monolithicPowerSystems } from './monolithic-power-systems.js';
import { onsemi } from './onsemi.js';
import { richtek } from './richtek.js';
import { stmicroelectronics } from './stmicroelectronics.js';
import { texasInstruments } from './texas-instruments.js';

export * from './analog-devices.js';
export * from './diodes-incorporated.js';
export * from './microchip.js';
export * from './monolithic-power-systems.js';
export * from './onsemi.js';
export * from './richtek.js';
export * from './stmicroelectronics.js';
export * from './texas-instruments.js';

/**
 * Every decoder, by manufacturer key.
 *
 * Keyed rather than listed so that adding a manufacturer to `ManufacturerKey`
 * without writing its decoder is a compile error, and so that looking one up
 * by key never has to handle a missing entry.
 */
export const DECODERS: Readonly<Record<ManufacturerKey, Decoder>> = Object.freeze({
  'texas-instruments': texasInstruments,
  'analog-devices': analogDevices,
  'monolithic-power-systems': monolithicPowerSystems,
  'diodes-incorporated': diodesIncorporated,
  onsemi,
  richtek,
  microchip,
  stmicroelectronics,
});

export const DECODER_LIST: readonly Decoder[] = Object.freeze(Object.values(DECODERS));

/** The decoder for a manufacturer as a distributor spells it, or null. */
export function decoderFor(manufacturerName: string): Decoder | null {
  return DECODER_LIST.find((decoder) => decoder.claims(manufacturerName)) ?? null;
}

export function decoderByKey(key: ManufacturerKey): Decoder {
  return DECODERS[key];
}

/**
 * Decodes a part number using the decoder for its manufacturer.
 *
 * The manufacturer is required, because the same suffix means different
 * things to different manufacturers and a part number alone does not say who
 * made it. An unknown manufacturer, or a part number the decoder cannot read
 * in full, returns null.
 */
export function decodeMpn(mpn: string, manufacturerName: string): DecodedMpn | null {
  return decoderFor(manufacturerName)?.decode(mpn) ?? null;
}
