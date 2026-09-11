# Evaluation extract.v1 / claude-opus-5

- Prompt: `extract.v1`
- Model: `claude-opus-5` at effort `high`
- Started: 2026-09-11T16:00:31.043Z
- Parts: 22
- Cost: $87.24 over 355 turns

## Totals

| Measure | Value |
| --- | --- |
| Recall | 90.6% |
| Precision | 90.6% |
| Citations exact | 59.3% |
| Citations one page out | 13.2% |

**5 part(s) wanted something the cache did not have:** LMR33630ADDAR, TLV62569DBVR, TPS54560BDDAR, TPS563200DDCR, TPS62130RGTR. Their scores measure the cache, not the prompt.

## Parts

| Part | Result | Recall | Precision | Citations | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| AP62200WU-7 | extracted | 96.3% | 96.3% | 50.0% | 20 | $4.27 |
| AP62201WU-7 | extracted | 96.3% | 96.3% | 50.0% | 12 | $4.13 |
| AP63203WU-7 | extracted | 96.4% | 96.4% | 70.4% | 18 | $3.67 |
| AP63205WU-7 | extracted | 96.4% | 96.4% | 74.1% | 19 | $4.29 |
| AP63357DV-7 | extracted | 85.2% | 85.2% | 65.2% | 18 | $4.64 |
| IR3899MTRPBF | extracted | 74.1% | 74.1% | 60.0% | 19 | $5.73 |
| LM2596S-3.3/NOPB | extracted | 92.3% | 92.3% | 87.5% | 15 | $2.72 |
| LM5116MH/NOPB | extracted | 87.5% | 87.5% | 42.9% | 15 | $4.15 |
| LM5164DDAR | extracted | 92.3% | 92.3% | 62.5% | 18 | $4.43 |
| LM5164QDDARQ1 | extracted | 92.6% | 92.6% | 60.0% | 20 | $4.09 |
| LM76002RNPR | extracted | 78.6% | 78.6% | 27.3% | 13 | $3.09 |
| LM76003RNPR | extracted | 81.5% | 81.5% | 31.8% | 11 | $2.75 |
| LMR33630ADDAR | extracted | 93.1% | 93.1% | 51.9% | 22 | $3.61 |
| MCP16331T-E/CH | extracted | 85.2% | 85.2% | 8.7% | 15 | $3.14 |
| TLV62569DBVR | extracted | 92.9% | 92.9% | 76.9% | 20 | $4.48 |
| TPS54331DDAR | extracted | 92.3% | 92.3% | 79.2% | 13 | $3.13 |
| TPS54331DR | extracted | 88.5% | 88.5% | 73.9% | 18 | $3.24 |
| TPS54560BDDAR | extracted | 92.6% | 92.6% | 56.0% | 17 | $4.34 |
| TPS54620RHLR | extracted | 88.9% | 88.9% | 50.0% | 12 | $4.17 |
| TPS562200DDCR | extracted | 96.3% | 96.3% | 76.9% | 11 | $5.55 |
| TPS563200DDCR | extracted | 96.3% | 96.3% | 76.9% | 15 | $3.34 |
| TPS62130RGTR | extracted | 96.4% | 96.4% | 59.3% | 14 | $4.25 |

## Parameters

| Parameter | Correct | Stated |
| --- | --- | --- |
| vinMin | 21 | 22 |
| vinMax | 22 | 22 |
| vinAbsMax | 22 | 22 |
| voutMin | 22 | 22 |
| voutMax | 12 | 17 |
| voutFixed | 3 | 3 |
| ioutMax | 21 | 21 |
| switchingFrequency | 14 | 22 |
| feedbackReference | 21 | 21 |
| feedbackAccuracy | 16 | 22 |
| quiescentCurrent | 18 | 21 |
| shutdownCurrent | 19 | 22 |
| topology | 22 | 22 |
| integration | 22 | 22 |
| softStart | 19 | 22 |
| enablePin | 22 | 22 |
| powerGoodPin | 22 | 22 |
| lightLoadMode | 17 | 22 |
| externalSync | 22 | 22 |
| operatingTempMin | 22 | 22 |
| operatingTempMax | 22 | 22 |
| temperatureReference | 21 | 22 |
| package | 22 | 22 |
| thermalPad | 21 | 22 |
| minOnTime | 12 | 17 |
| maxDutyCycle | 5 | 14 |
| efficiencyPeak | 3 | 4 |
| rdsOnHigh | 19 | 20 |
| rdsOnLow | 13 | 16 |
| aecQ100 | 21 | 22 |

## Every value that was wrong

| Part | Parameter | Score | Golden | Extracted |
| --- | --- | --- | --- | --- |
| AP62200WU-7 | feedbackAccuracy | extra | `null` | `{"value":1,"unit":"percent"}` |
| AP62201WU-7 | feedbackAccuracy | extra | `null` | `{"value":1,"unit":"percent"}` |
| AP63203WU-7 | shutdownCurrent | extra | `null` | `{"value":0.000001,"unit":"A"}` |
| AP63205WU-7 | shutdownCurrent | extra | `null` | `{"value":0.000001,"unit":"A"}` |
| AP63357DV-7 | voutMax | extra | `null` | `{"value":31,"unit":"V"}` |
| AP63357DV-7 | switchingFrequency | wrong | `{"value":450000,"unit":"Hz"}` | `{"unit":"Hz","min":400000,"max":500000,"typ":450000}` |
| AP63357DV-7 | thermalPad | wrong | `true` | `false` |
| AP63357DV-7 | minOnTime | extra | `null` | `{"value":1e-7,"unit":"s"}` |
| IR3899MTRPBF | vinMin | wrong | `{"value":5,"unit":"V"}` | `{"value":1,"unit":"V"}` |
| IR3899MTRPBF | voutMax | extra | `null` | `{"value":18.06,"unit":"V"}` |
| IR3899MTRPBF | shutdownCurrent | extra | `null` | `{"value":0.0001,"unit":"A"}` |
| IR3899MTRPBF | softStart | wrong | `{"present":true,"time":null}` | `{"present":true,"time":{"value":0.0025,"unit":"s"}}` |
| IR3899MTRPBF | lightLoadMode | wrong | `"selectable"` | `"forced_pwm"` |
| IR3899MTRPBF | rdsOnHigh | extra | `null` | `{"value":0.0175,"unit":"Ohm"}` |
| IR3899MTRPBF | rdsOnLow | extra | `null` | `{"value":0.0085,"unit":"Ohm"}` |
| LM2596S-3.3/NOPB | feedbackAccuracy | wrong | `{"value":4,"unit":"percent"}` | `null` |
| LM2596S-3.3/NOPB | efficiencyPeak | extra | `null` | `{"value":73,"unit":"percent"}` |
| LM5116MH/NOPB | switchingFrequency | wrong | `{"unit":"Hz","max":1000000}` | `{"unit":"Hz","min":50000,"max":1000000}` |
| LM5116MH/NOPB | quiescentCurrent | wrong | `{"value":0.0012,"unit":"A"}` | `{"value":0.005,"unit":"A"}` |
| LM5116MH/NOPB | minOnTime | extra | `null` | `{"value":1e-7,"unit":"s"}` |
| LM5164DDAR | feedbackAccuracy | wrong | `{"value":1.5,"unit":"percent"}` | `null` |
| LM5164DDAR | lightLoadMode | wrong | `"pfm"` | `"psm"` |
| LM5164QDDARQ1 | voutMax | extra | `null` | `{"value":100,"unit":"V"}` |
| LM5164QDDARQ1 | lightLoadMode | wrong | `"pfm"` | `"psm"` |
| LM76002RNPR | voutMax | extra | `null` | `{"value":57,"unit":"V"}` |
| LM76002RNPR | switchingFrequency | wrong | `{"value":500000,"unit":"Hz"}` | `{"unit":"Hz","min":300000,"max":2200000,"typ":500000}` |
| LM76002RNPR | feedbackAccuracy | wrong | `{"value":1.5,"unit":"percent"}` | `null` |
| LM76002RNPR | quiescentCurrent | wrong | `{"value":0.000021,"unit":"A"}` | `{"value":9e-7,"unit":"A"}` |
| LM76002RNPR | maxDutyCycle | wrong | `{"value":95,"unit":"percent"}` | `null` |
| LM76002RNPR | rdsOnLow | extra | `null` | `{"value":0.045,"unit":"Ohm"}` |
| LM76003RNPR | switchingFrequency | wrong | `{"value":500000,"unit":"Hz"}` | `{"unit":"Hz","min":300000,"max":2200000,"typ":500000}` |
| LM76003RNPR | feedbackAccuracy | wrong | `{"value":1.5,"unit":"percent"}` | `null` |
| LM76003RNPR | quiescentCurrent | wrong | `{"value":0.000021,"unit":"A"}` | `{"value":9e-7,"unit":"A"}` |
| LM76003RNPR | maxDutyCycle | wrong | `{"value":95,"unit":"percent"}` | `null` |
| LM76003RNPR | rdsOnLow | extra | `null` | `{"value":0.045,"unit":"Ohm"}` |
| LMR33630ADDAR | switchingFrequency | wrong | `{"value":400000,"unit":"Hz"}` | `{"unit":"Hz","min":340000,"max":460000,"typ":400000}` |
| LMR33630ADDAR | maxDutyCycle | wrong | `{"value":95,"unit":"percent"}` | `{"value":98,"unit":"percent"}` |
| MCP16331T-E/CH | switchingFrequency | wrong | `{"value":500000,"unit":"Hz"}` | `{"unit":"Hz","min":425000,"max":550000,"typ":500000}` |
| MCP16331T-E/CH | softStart | wrong | `{"present":true,"time":null}` | `{"present":true,"time":{"value":0.0006,"unit":"s"}}` |
| MCP16331T-E/CH | temperatureReference | wrong | `"ambient"` | `"junction"` |
| MCP16331T-E/CH | aecQ100 | wrong | `true` | `false` |
| TLV62569DBVR | voutMax | extra | `null` | `{"value":5.5,"unit":"V"}` |
| TLV62569DBVR | softStart | wrong | `{"present":true,"time":null}` | `{"present":true,"time":{"value":0.0008,"unit":"s"}}` |
| TPS54331DDAR | switchingFrequency | wrong | `{"value":570000,"unit":"Hz"}` | `{"unit":"Hz","min":456000,"max":684000,"typ":570000}` |
| TPS54331DDAR | maxDutyCycle | wrong | `{"value":90,"unit":"percent"}` | `{"value":93,"unit":"percent"}` |
| TPS54331DR | switchingFrequency | wrong | `{"value":570000,"unit":"Hz"}` | `{"unit":"Hz","min":456000,"max":684000,"typ":570000}` |
| TPS54331DR | lightLoadMode | wrong | `"psm"` | `"pfm"` |
| TPS54331DR | maxDutyCycle | wrong | `{"value":90,"unit":"percent"}` | `{"value":93,"unit":"percent"}` |
| TPS54560BDDAR | minOnTime | extra | `null` | `{"value":1.35e-7,"unit":"s"}` |
| TPS54560BDDAR | maxDutyCycle | extra | `null` | `{"value":100,"unit":"percent"}` |
| TPS54620RHLR | lightLoadMode | wrong | `"selectable"` | `"none"` |
| TPS54620RHLR | minOnTime | wrong | `{"value":2e-8,"unit":"s"}` | `{"value":9.4e-8,"unit":"s"}` |
| TPS54620RHLR | maxDutyCycle | extra | `null` | `{"value":100,"unit":"percent"}` |
| TPS562200DDCR | maxDutyCycle | wrong | `{"value":65,"unit":"percent"}` | `null` |
| TPS563200DDCR | maxDutyCycle | wrong | `{"value":65,"unit":"percent"}` | `null` |
| TPS62130RGTR | minOnTime | extra | `null` | `{"value":8e-8,"unit":"s"}` |
