import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Badge } from '../components/Badge.js';
import { Checkbox, Select, TextField } from '../components/Fields.js';
import { Page } from '../components/Page.js';
import { money, parameterValue, percent } from '../lib/format.js';
import { useAsync } from '../lib/state.js';

/**
 * The question this project was built to answer.
 *
 * Every constraint is a requirement, so the form exposes all of them rather
 * than a convenient few; and the disclaimer the engine attaches comes through
 * unedited, because parametric similarity is not pin compatibility.
 */

interface Alternate {
  readonly part: { readonly mpn: string; readonly manufacturer: string; readonly status: string };
  readonly price: { readonly amount: number; readonly currency: string } | null;
  readonly saving: number | null;
  readonly differences: readonly {
    readonly key: string;
    readonly reference: unknown;
    readonly candidate: unknown;
    readonly same: boolean;
  }[];
  readonly pinCompatibility: string;
}

interface AlternateResult {
  readonly reference: { readonly mpn: string };
  readonly alternates: readonly Alternate[];
  readonly excluded: readonly { readonly mpn: string; readonly reason: string }[];
  readonly disclaimer: string;
}

export function Alternates(): ReactNode {
  const { api, source } = useApp();
  const [form, setForm] = useState({
    mpn: '',
    vin: '',
    iout: '',
    outputType: '',
    quantity: '100',
    includeUnverified: false,
  });
  const [asked, setAsked] = useState<typeof form | undefined>(undefined);

  const result = useAsync(`alternates:${source}:${JSON.stringify(asked)}`, () =>
    asked === undefined
      ? Promise.resolve(undefined)
      : api
          .alternates(
            {
              mpn: asked.mpn,
              ...(asked.vin === ''
                ? {}
                : {
                    vinRange: {
                      unit: 'V',
                      min: Number(asked.vin.split('-')[0]),
                      max: Number(asked.vin.split('-')[1]),
                    },
                  }),
              ...(asked.iout === '' ? {} : { ioutMin: { unit: 'A', value: Number(asked.iout) } }),
              ...(asked.outputType === '' ? {} : { outputType: asked.outputType }),
              quantity: Number(asked.quantity),
              currency: 'AUD',
              includeUnverified: asked.includeUnverified,
            },
            source,
          )
          .then((value) => (value as { result: AlternateResult }).result),
  );

  return (
    <Page title="Alternates" subtitle="Cheaper parts that still meet every constraint you state">
      <div className="filters">
        <TextField
          label="Part to replace"
          value={form.mpn}
          placeholder="TPS54331DR"
          onChange={(value) => {
            setForm({ ...form, mpn: value });
          }}
        />
        <TextField
          label="Input range it must cover"
          value={form.vin}
          placeholder="8-28"
          onChange={(value) => {
            setForm({ ...form, vin: value });
          }}
        />
        <TextField
          label="Output current, amps"
          value={form.iout}
          placeholder="2"
          onChange={(value) => {
            setForm({ ...form, iout: value });
          }}
        />
        <Select
          label="Output"
          value={form.outputType}
          options={[
            { value: '', label: 'Either' },
            { value: 'adjustable', label: 'Adjustable' },
            { value: 'fixed', label: 'Fixed' },
          ]}
          onChange={(value) => {
            setForm({ ...form, outputType: value });
          }}
        />
        <TextField
          label="Quantity"
          type="number"
          value={form.quantity}
          onChange={(value) => {
            setForm({ ...form, quantity: value });
          }}
        />
        <Checkbox
          label="Include parts nothing has verified"
          checked={form.includeUnverified}
          onChange={(checked) => {
            setForm({ ...form, includeUnverified: checked });
          }}
        />
        <button
          type="button"
          className="action"
          disabled={form.mpn.trim() === ''}
          onClick={() => {
            setAsked({ ...form });
          }}
        >
          Find alternates
        </button>
      </div>
      {asked === undefined ? (
        <p className="empty">Name a part and the constraints it has to meet.</p>
      ) : (
        <Async state={result.state} label="the answer">
          {(value) =>
            value === undefined ? null : (
              <>
                <p className="caption">
                  {value.alternates.length === 0
                    ? 'nothing stored meets those constraints.'
                    : `${String(value.alternates.length)} parts meet them.`}{' '}
                  {value.excluded.length === 0
                    ? ''
                    : `${String(value.excluded.length)} were left out: ${value.excluded
                        .map((one) => `${one.mpn} (${one.reason})`)
                        .join(', ')}.`}
                </p>
                {value.alternates.map((alternate) => (
                  <div className="panel" key={alternate.part.mpn} style={{ marginBottom: 12 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <h3 style={{ margin: 0 }}>{alternate.part.mpn}</h3>
                      <span className="row">
                        <Badge kind="partStatus" value={alternate.part.status} />
                        <strong>
                          {alternate.price === null
                            ? 'No price in this currency'
                            : money(alternate.price.amount, alternate.price.currency)}
                        </strong>
                        {alternate.saving === null ? null : (
                          <span className="caption">{percent(alternate.saving, 0)} cheaper</span>
                        )}
                      </span>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Parameter</th>
                          <th>{value.reference.mpn}</th>
                          <th>{alternate.part.mpn}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alternate.differences
                          .filter((difference) => !difference.same)
                          .map((difference) => (
                            <tr key={difference.key}>
                              <td>{difference.key}</td>
                              <td>{parameterValue(difference.reference)}</td>
                              <td>
                                <strong>{parameterValue(difference.candidate)}</strong>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                <div className="panel">
                  <p className="caption">{value.disclaimer}</p>
                </div>
              </>
            )
          }
        </Async>
      )}
    </Page>
  );
}
