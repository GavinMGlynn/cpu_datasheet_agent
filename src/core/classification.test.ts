import { describe, expect, it } from 'vitest';

import { classification } from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import {
  CLASSIFICATION_AXES,
  Classification,
  FEATURES,
  IOUT_CLASSES,
  OUTPUT_TYPES,
  PACKAGE_FAMILIES,
  TEMPERATURE_GRADES,
  VIN_CLASSES,
} from './classification.js';

describe('Classification', () => {
  it('lists every axis of the union in CLASSIFICATION_AXES', () => {
    const axes = Classification.options.map((option) => option.shape.axis.value);
    expect(axes).toEqual([...CLASSIFICATION_AXES]);
  });

  it.each(VIN_CLASSES)('accepts vinClass %s', (value) => {
    expectAccepts(Classification, classification({ axis: 'vinClass', value }));
  });

  it.each(IOUT_CLASSES)('accepts ioutClass %s', (value) => {
    expectAccepts(
      Classification,
      classification({ axis: 'ioutClass', value, derivedFrom: ['ioutMax'] }),
    );
  });

  it.each(['synchronous', 'non_synchronous'])('accepts topology %s', (value) => {
    expectAccepts(
      Classification,
      classification({ axis: 'topology', value, derivedFrom: ['topology'] }),
    );
  });

  it.each(['integrated_fet', 'controller'])('accepts integration %s', (value) => {
    expectAccepts(
      Classification,
      classification({ axis: 'integration', value, derivedFrom: ['integration'] }),
    );
  });

  it.each(OUTPUT_TYPES)('accepts outputType %s', (value) => {
    expectAccepts(
      Classification,
      classification({ axis: 'outputType', value, derivedFrom: ['voutFixed'] }),
    );
  });

  it.each(PACKAGE_FAMILIES)('accepts packageFamily %s', (value) => {
    expectAccepts(
      Classification,
      classification({ axis: 'packageFamily', value, derivedFrom: ['package'] }),
    );
  });

  it.each(TEMPERATURE_GRADES)('accepts temperatureGrade %s', (value) => {
    expectAccepts(
      Classification,
      classification({
        axis: 'temperatureGrade',
        value,
        derivedFrom: ['operatingTempMin', 'operatingTempMax', 'aecQ100'],
      }),
    );
  });

  it('accepts a features set, including an empty one', () => {
    expectAccepts(
      Classification,
      classification({ axis: 'features', value: [...FEATURES], derivedFrom: ['enablePin'] }),
    );
    expectAccepts(
      Classification,
      classification({ axis: 'features', value: [], derivedFrom: ['enablePin'] }),
    );
  });

  it('rejects duplicate features', () => {
    expectRejects(
      Classification,
      classification({
        axis: 'features',
        value: ['enable', 'sync', 'enable'],
        derivedFrom: ['enablePin'],
      }),
      'value.2',
    );
  });

  it.each([
    ['a value from another axis', classification({ axis: 'vinClass', value: 'le_1a' })],
    ['an unknown axis', classification({ axis: 'colour', value: 'black' })],
    ['a missing axis', { value: 'le_42v', derivedFrom: ['vinMax'], rule: 'r' }],
    [
      'a features value that is not an array',
      classification({ axis: 'features', value: 'enable' }),
    ],
    ['an unknown feature', classification({ axis: 'features', value: ['bootstrap'] })],
    ['no derivedFrom', classification({ derivedFrom: [] })],
    ['an unknown parameter key in derivedFrom', classification({ derivedFrom: ['vin'] })],
    ['an empty rule', classification({ rule: '' })],
    ['an extra key', classification({ confidence: 'high' })],
  ])('rejects %s', (_label, value) => {
    expectRejects(Classification, value);
  });
});
